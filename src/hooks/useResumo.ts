import { useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import { useQuery } from './useQuery'
import { competenciaISO, firstDayOfMonth } from '../lib/format'
import type { Conta, Investimento, Lancamento, Meta, Orcamento, Patrimonio, PlanoConta, WorkspaceConfig } from '../lib/types'
import { calcularScore } from '../lib/score'

/** Base de indicadores compartilhada por Status, Plano e Futuro (médias dos últimos 3 meses fechados + mês atual). */
export function useResumo(mesesMedia = 3) {
  const { workspace, profile } = useAuth()
  const ws = workspace!.id
  const config = (workspace!.config ?? {}) as WorkspaceConfig

  const q = useQuery(async () => {
    const hoje = new Date()
    const ini = new Date(hoje.getFullYear(), hoje.getMonth() - mesesMedia, 1).toISOString().slice(0, 10)
    const compAtual = competenciaISO(hoje.getFullYear(), hoje.getMonth() + 1)
    const [l, p, c, i, pa, m, o] = await Promise.all([
      supabase.from('lancamentos').select('id, data, competencia, valor, tipo, status, plano_conta_id').eq('workspace_id', ws).gte('data', ini).neq('status', 'pendente').neq('tipo', 'transferencia').limit(50000),
      supabase.from('plano_contas').select('*').eq('workspace_id', ws),
      supabase.from('contas').select('*').eq('workspace_id', ws).eq('ativa', true),
      supabase.from('investimentos').select('*').eq('workspace_id', ws),
      supabase.from('patrimonio').select('*').eq('workspace_id', ws),
      supabase.from('metas').select('*').eq('workspace_id', ws),
      supabase.from('orcamentos').select('*').eq('workspace_id', ws).eq('competencia', compAtual),
    ])
    if (l.error) throw l.error
    return { lanc: l.data as Lancamento[], planos: (p.data ?? []) as PlanoConta[], contas: (c.data ?? []) as Conta[], inv: (i.data ?? []) as Investimento[], pat: (pa.data ?? []) as Patrimonio[], metas: (m.data ?? []) as Meta[], orc: (o.data ?? []) as Orcamento[], compAtual }
  }, [ws, mesesMedia])

  const r = useMemo(() => {
    const d = q.data
    if (!d) return null
    const pl = Object.fromEntries(d.planos.map(p => [p.id, p]))
    const grupoDe = (p: PlanoConta) => (p.parent_id ? pl[p.parent_id] : p)
    const atual = firstDayOfMonth()
    // acumuladores (meses fechados → média; mês atual → separado)
    const med = { rec: 0, desp: 0, fixas: 0, variaveis: 0, dividas: 0, invest: 0, semCat: 0, n: 0 }
    const mesAtual = { rec: 0, desp: 0, porPlano: {} as Record<string, number> }
    const porPlanoMedia: Record<string, number> = {}
    const porGrupoMedia: Record<string, number> = {}
    const mesesSet = new Set<string>()
    for (const l of d.lanc) {
      const comp = l.competencia.slice(0, 10); const v = Number(l.valor)
      const p = l.plano_conta_id ? pl[l.plano_conta_id] : undefined
      const ehRec = p ? p.tipo === 'receita' : l.tipo === 'receita'
      const sinal = (l.tipo === 'receita') === ehRec ? 1 : -1
      const val = sinal * v
      if (comp === atual) {
        if (ehRec) mesAtual.rec += val; else mesAtual.desp += val
        if (p) mesAtual.porPlano[p.id] = (mesAtual.porPlano[p.id] ?? 0) + val
        continue
      }
      mesesSet.add(comp); med.n++
      if (!p) med.semCat++
      if (ehRec) { med.rec += val; continue }
      med.desp += val
      if (p) {
        porPlanoMedia[p.id] = (porPlanoMedia[p.id] ?? 0) + val
        const g = grupoDe(p); porGrupoMedia[g.id] = (porGrupoMedia[g.id] ?? 0) + val
        if (p.tipo === 'investimento') med.invest += val
        else if (p.codigo.startsWith('2.18')) med.dividas += val
        else if (p.natureza === 'fixa') med.fixas += val
        else med.variaveis += val
      } else med.variaveis += val
    }
    const nm = Math.max(1, mesesSet.size)
    const media = { rec: med.rec / nm, desp: med.desp / nm, fixas: med.fixas / nm, variaveis: med.variaveis / nm, dividas: med.dividas / nm, invest: med.invest / nm, meses: mesesSet.size }
    for (const k in porPlanoMedia) porPlanoMedia[k] /= nm
    for (const k in porGrupoMedia) porGrupoMedia[k] /= nm

    const saldoContas = d.contas.filter(c => c.tipo !== 'cartao_credito').reduce((a, c) => a + Number(c.saldo_atual), 0)
    const faturas = d.contas.filter(c => c.tipo === 'cartao_credito').reduce((a, c) => a + Number(c.saldo_atual), 0)
    const investTotal = d.inv.reduce((a, i) => a + Number(i.valor_atual), 0)
    const reservaInvest = d.inv.filter(i => i.objetivo === 'reserva' || /d\+?[01]\b|di[aá]ria|imediata/i.test(i.liquidez ?? '')).reduce((a, i) => a + Number(i.valor_atual), 0)
    const bens = d.pat.filter(p => p.tipo === 'ativo'); const dividasPat = d.pat.filter(p => p.tipo === 'passivo')
    const outrosAtivos = bens.reduce((a, p) => a + Number(p.valor), 0)
    const saldoDevedorBens = bens.reduce((a, p) => a + Number(p.saldo_devedor ?? 0), 0)
    const passivos = dividasPat.reduce((a, p) => a + Number(p.valor), 0) + saldoDevedorBens + Math.abs(faturas)
    const ativos = saldoContas + investTotal + outrosAtivos
    const geradores = bens.filter(p => p.gerador_renda).reduce((a, p) => a + Number(p.valor), 0) + investTotal
    const disponivel = saldoContas + reservaInvest
    const reservaMeses = media.desp ? disponivel / media.desp : 0

    // independência financeira
    const rendaDesejada = config.renda_desejada ?? Math.round(media.desp)
    const taxaReal = config.taxa_real ?? 4
    const necessarioIF = taxaReal > 0 ? ((rendaDesejada - (config.outras_rendas ?? 0)) * 12) / (taxaReal / 100) : 0
    const progressoIF = necessarioIF > 0 ? Math.min(100, investTotal / necessarioIF * 100) : 0

    // aderência ao plano do mês atual
    const orcDesp = d.orc.filter(o => pl[o.plano_conta_id]?.tipo !== 'receita' && Number(o.valor) > 0)
    const aderenciaPlano = orcDesp.length ? orcDesp.filter(o => (mesAtual.porPlano[o.plano_conta_id] ?? 0) <= Number(o.valor)).length / orcDesp.length * 100 : null

    const score = calcularScore({
      receitaMedia: media.rec, despesaMedia: media.desp, fixasMedia: media.fixas, dividasMedia: media.dividas, disponivel,
      investimentos: investTotal, ativosTotais: ativos, passivosTotais: passivos, ativosGeradores: geradores,
      semCategoriaPct: med.n ? med.semCat / med.n * 100 : 0, metasAtivas: d.metas.filter(m => m.ativo).length, aderenciaPlano, progressoIF, reservaMeses,
      classesInvest: new Set(d.inv.map(i => i.tipo)).size,
    })
    const idade = profile?.data_nascimento ? Math.floor((Date.now() - new Date(profile.data_nascimento).getTime()) / (365.25 * 24 * 3600 * 1000)) : null
    return { ...d, pl, media, mesAtual, porPlanoMedia, porGrupoMedia, saldoContas, faturas, investTotal, reservaInvest, outrosAtivos, saldoDevedorBens, passivos, ativos, geradores, disponivel, reservaMeses, necessarioIF, progressoIF, aderenciaPlano, score, config, idade }
  }, [q.data, config, profile])

  return { ...q, r }
}
