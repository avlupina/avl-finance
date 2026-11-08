import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarClock, CreditCard, Target, ShieldCheck, Repeat, CalendarDays } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useQuery } from '../hooks/useQuery'
import { Badge, Empty, ErrorBox, Kpi, Loading, MoneyCell, PageHeader, Tabs } from '../components/ui'
import { brl, fmtDate, todayISO } from '../lib/format'
import type { Apolice, Conta, Lancamento, Meta, Projecao } from '../lib/types'

type Horizonte = '30' | '60' | '90'
interface Evento { data: string; titulo: string; detalhe: string; valor: number; tipo: 'receita' | 'despesa' | 'transferencia' | 'info'; origem: 'projecao' | 'fatura' | 'recorrente' | 'meta' | 'apolice'; to: string }
const ICON = { projecao: CalendarClock, fatura: CreditCard, recorrente: Repeat, meta: Target, apolice: ShieldCheck }
const ORIGEM_LABEL = { projecao: 'Projeção', fatura: 'Fatura de cartão', recorrente: 'Recorrente (histórico)', meta: 'Objetivo', apolice: 'Apólice' }

const addDias = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x }
const iso = (d: Date) => d.toISOString().slice(0, 10)

/** Agenda financeira: tudo que está programado para os próximos 30/60/90 dias, de várias fontes. */
export default function Agenda() {
  const { workspace } = useAuth()
  const ws = workspace!.id
  const [h, setH] = useState<Horizonte>('30')
  const hoje = new Date(todayISO() + 'T12:00:00')
  const fim = addDias(hoje, Number(h))

  const q = useQuery(async () => {
    const ini90 = iso(addDias(hoje, -95))
    const [pr, c, l, m, a] = await Promise.all([
      supabase.from('projecoes').select('*, plano_contas(nome)').eq('workspace_id', ws).eq('status', 'prevista').gte('competencia', iso(new Date(hoje.getFullYear(), hoje.getMonth(), 1))).lte('competencia', iso(new Date(fim.getFullYear(), fim.getMonth() + 1, 0))),
      supabase.from('contas').select('*').eq('workspace_id', ws).eq('ativa', true),
      supabase.from('lancamentos').select('data, descricao, valor, tipo, plano_conta_id, plano_contas(nome)').eq('workspace_id', ws).gte('data', ini90).lte('data', todayISO()).neq('status', 'pendente').limit(20000),
      supabase.from('metas').select('*').eq('workspace_id', ws).eq('ativo', true).not('data_alvo', 'is', null),
      supabase.from('apolices').select('*').eq('workspace_id', ws).eq('ativa', true).not('vigencia_fim', 'is', null),
    ])
    if (pr.error) throw pr.error
    return { proj: pr.data as (Projecao & { plano_contas?: { nome: string } | null })[], contas: c.data as Conta[], lanc: (l.data ?? []) as unknown as (Lancamento & { plano_contas?: { nome: string } | null })[], metas: (m.data ?? []) as Meta[], apolices: (a.data ?? []) as Apolice[] }
  }, [ws, h])

  const eventos = useMemo<Evento[]>(() => {
    const d = q.data; if (!d) return []
    const ev: Evento[] = []
    const dentro = (s: string) => s >= iso(hoje) && s <= iso(fim)
    // 1) projeções
    for (const p of d.proj) {
      const data = p.data_prevista ?? `${p.competencia.slice(0, 8)}${String(Math.min(28, hoje.getDate())).padStart(2, '0')}`
      if (dentro(data)) ev.push({ data, titulo: p.descricao, detalhe: p.plano_contas?.nome ?? 'Projeção', valor: Number(p.valor), tipo: p.tipo, origem: 'projecao', to: '/projecoes' })
    }
    // 2) faturas de cartão (vencimento mensal)
    for (const c of d.contas.filter(x => x.tipo === 'cartao_credito' && x.vencimento_fatura)) {
      for (let k = 0; k <= 3; k++) {
        const dt = new Date(hoje.getFullYear(), hoje.getMonth() + k, Math.min(c.vencimento_fatura!, new Date(hoje.getFullYear(), hoje.getMonth() + k + 1, 0).getDate()), 12)
        const s = iso(dt); if (!dentro(s)) continue
        ev.push({ data: s, titulo: `Fatura ${c.nome}`, detalhe: k === 0 || (k === 1 && hoje.getDate() > (c.fechamento_fatura ?? 31)) ? 'valor atual da fatura' : 'estimativa (fatura futura)', valor: Math.abs(Number(c.saldo_atual)), tipo: 'despesa', origem: 'fatura', to: '/contas' })
      }
    }
    // 3) recorrentes detectados no histórico (mesma descrição em ≥2 dos últimos 3 meses) → projeta próximo mês no mesmo dia
    const grupos: Record<string, { datas: string[]; valores: number[]; tipo: Lancamento['tipo']; cat?: string; desc: string }> = {}
    for (const l of d.lanc) {
      if (l.tipo === 'transferencia') continue
      const k = l.descricao.replace(/\d+/g, '').replace(/\s+/g, ' ').trim().toUpperCase().slice(0, 30)
      if (k.length < 4) continue
      grupos[k] ??= { datas: [], valores: [], tipo: l.tipo, cat: l.plano_contas?.nome, desc: l.descricao }
      grupos[k].datas.push(l.data); grupos[k].valores.push(Number(l.valor))
    }
    const descProj = new Set(d.proj.map(p => p.descricao.toUpperCase().slice(0, 30)))
    for (const g of Object.values(grupos)) {
      const meses = new Set(g.datas.map(x => x.slice(0, 7)))
      if (meses.size < 2 || g.valores.length > 6 * 3) continue            // precisa repetir em ≥2 meses; ignora compras muito frequentes (ex.: mercado)
      if (descProj.has(g.desc.toUpperCase().slice(0, 30))) continue          // já coberto por projeção
      const dias = g.datas.map(x => Number(x.slice(8, 10))); const dia = Math.round(dias.reduce((a, b) => a + b, 0) / dias.length)
      const valor = g.valores.reduce((a, b) => a + b, 0) / g.valores.length
      const ultimo = g.datas.sort().pop()!
      for (let k = 0; k <= 3; k++) {
        const dt = new Date(hoje.getFullYear(), hoje.getMonth() + k, Math.min(dia, 28), 12); const s = iso(dt)
        if (!dentro(s) || s.slice(0, 7) === ultimo.slice(0, 7)) continue      // não repete no mês em que já ocorreu
        ev.push({ data: s, titulo: g.desc, detalhe: `${g.cat ?? 'sem categoria'} · média de ${meses.size} meses`, valor, tipo: g.tipo, origem: 'recorrente', to: '/lancamentos' })
      }
    }
    // 4) metas com data alvo e 5) apólices vencendo
    for (const m of d.metas) if (dentro(m.data_alvo!)) ev.push({ data: m.data_alvo!, titulo: `Objetivo: ${m.nome}`, detalhe: `${brl(m.valor_atual)} de ${brl(m.valor_alvo)}`, valor: Math.max(0, Number(m.valor_alvo) - Number(m.valor_atual)), tipo: 'info', origem: 'meta', to: '/futuro' })
    for (const a of d.apolices) if (dentro(a.vigencia_fim!)) ev.push({ data: a.vigencia_fim!, titulo: `Renovação de apólice (${a.tipo})`, detalhe: a.seguradora ?? '', valor: Number(a.premio_mensal ?? 0), tipo: 'info', origem: 'apolice', to: '/protecao' })
    return ev.sort((a, b) => a.data.localeCompare(b.data))
  }, [q.data, h])

  const tot = eventos.reduce((a, e) => { if (e.tipo === 'despesa') a.d += e.valor; else if (e.tipo === 'receita') a.r += e.valor; return a }, { d: 0, r: 0 })
  const disponivel = (q.data?.contas ?? []).filter(c => c.tipo !== 'cartao_credito').reduce((a, c) => a + Number(c.saldo_atual), 0)
  const semanas = useMemo(() => {
    const m: Record<string, Evento[]> = {}
    for (const e of eventos) { const d = new Date(e.data + 'T12:00:00'); const diff = Math.floor((d.getTime() - hoje.getTime()) / 86400000); const k = diff < 7 ? 'Próximos 7 dias' : diff < 14 ? 'Em 1–2 semanas' : diff < 30 ? 'Em 2–4 semanas' : diff < 60 ? 'Em 1–2 meses' : 'Em 2–3 meses'; (m[k] ??= []).push(e) }
    return Object.entries(m)
  }, [eventos])

  return (
    <div>
      <PageHeader title="Agenda" actions={<Tabs tabs={[{ key: '30', label: '30 dias' }, { key: '60', label: '60 dias' }, { key: '90', label: '90 dias' }]} value={h} onChange={setH} />}>
        <p className="text-sm text-muted">Programação financeira de {fmtDate(iso(hoje))} a {fmtDate(iso(fim))}: projeções cadastradas, vencimentos de fatura, gastos recorrentes detectados no histórico, objetivos e renovações de apólice.</p>
      </PageHeader>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <Kpi label="Saídas programadas" value={brl(tot.d)} tone="neg" sub={`${eventos.filter(e => e.tipo === 'despesa').length} compromisso(s)`} />
        <Kpi label="Entradas previstas" value={brl(tot.r)} tone="pos" />
        <Kpi label="Disponível hoje" value={brl(disponivel)} tone="brand" sub="contas correntes e poupança" />
        <Kpi label="Saldo após compromissos" value={brl(disponivel + tot.r - tot.d)} tone={disponivel + tot.r - tot.d >= 0 ? 'pos' : 'neg'} sub={disponivel + tot.r - tot.d < 0 ? 'atenção: faltará caixa' : 'caixa suficiente'} />
      </div>

      {q.loading ? <Loading /> : q.error ? <ErrorBox msg={q.error} /> : !eventos.length ? (
        <Empty title="Nada programado no período" hint="Cadastre projeções (Movimentação → Projeções), informe o dia de vencimento dos cartões em Contas e defina datas nos seus objetivos para alimentar a agenda." action={<Link to="/projecoes" className="btn btn-primary">Ir para Projeções</Link>} />
      ) : (
        <div className="flex flex-col gap-4">
          {semanas.map(([titulo, lista]) => (
            <div key={titulo} className="card">
              <div className="px-4 py-3 border-b border-line flex items-center justify-between"><div className="font-black flex items-center gap-2"><CalendarDays size={16} className="text-brand" /> {titulo}</div><div className="text-sm num text-muted">saídas <b className="text-neg">{brl(lista.filter(e => e.tipo === 'despesa').reduce((a, e) => a + e.valor, 0))}</b></div></div>
              <table className="tbl">
                <tbody>{lista.map((e, i) => { const Icon = ICON[e.origem]; return (
                  <tr key={i}>
                    <td className="num whitespace-nowrap w-28">{fmtDate(e.data)}<div className="text-[11px] text-muted">{new Date(e.data + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'short' })}</div></td>
                    <td className="w-10"><div className="w-8 h-8 rounded-lg bg-surface flex items-center justify-center text-ink/70"><Icon size={16} /></div></td>
                    <td><div className="font-bold">{e.titulo}</div><div className="text-xs text-muted">{e.detalhe}</div></td>
                    <td><Badge tone={e.origem === 'fatura' ? 'red' : e.origem === 'projecao' ? 'blue' : e.origem === 'recorrente' ? 'amber' : 'gray'}>{ORIGEM_LABEL[e.origem]}</Badge></td>
                    <td className="text-right">{e.tipo === 'info' ? <span className="text-muted num text-sm">{e.valor ? brl(e.valor) : ''}</span> : <MoneyCell v={e.valor} tipo={e.tipo} />}</td>
                    <td className="text-right w-20"><Link to={e.to} className="text-xs font-bold text-brand">abrir</Link></td>
                  </tr>) })}</tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
