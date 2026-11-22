import { supabase } from './supabase'
import { fmtDate } from './format'
import type { Banco, Conta, Lancamento, PlanoConta, Projecao } from './types'

export const addDias = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x }
export const iso = (d: Date) => d.toISOString().slice(0, 10)
export const dataLocal = (s: string) => new Date(s + 'T12:00:00')

/* ───────────────────────── Fluxo realizado (extrato integrado) ───────────────────────── */

/** Sinal do lançamento na conta: entrada (+) ou saída (−). Transferências usam conta_id como origem e conta_destino_id como destino. */
const sinal = (l: Lancamento, contaId: string) => l.tipo === 'receita' ? 1 : l.tipo === 'despesa' ? -1 : (l.conta_destino_id === contaId ? 1 : -1)

export interface FluxoDados { contas: Conta[]; lanc: Lancamento[]; posteriores: Lancamento[] }
export interface LinhaFluxo { l: Lancamento; efeito: number; saldo: number; interna: boolean; conta: string }
export interface DiaFluxo { data: string; linhas: LinhaFluxo[]; saldoInicial: number; entradas: number; saidas: number; saldoFinal: number }

/** Carrega contas (exceto cartões) e lançamentos efetivados do período + posteriores (para recompor o saldo). */
export async function carregarFluxoRealizado(ws: string, ini: string, fim: string): Promise<FluxoDados> {
  const [c, l, pos] = await Promise.all([
    supabase.from('contas').select('*, bancos(nome, sigla)').eq('workspace_id', ws).eq('ativa', true).neq('tipo', 'cartao_credito').order('nome'),
    supabase.from('lancamentos').select('id, data, descricao, valor, tipo, status, conta_id, conta_destino_id, plano_conta_id, plano_contas(nome, codigo)').eq('workspace_id', ws).neq('status', 'pendente').gte('data', ini).lte('data', fim).order('data').order('id').limit(20000),
    supabase.from('lancamentos').select('id, data, valor, tipo, conta_id, conta_destino_id').eq('workspace_id', ws).neq('status', 'pendente').gt('data', fim).limit(20000),
  ])
  if (l.error) throw l.error
  return { contas: (c.data ?? []) as Conta[], lanc: (l.data ?? []) as unknown as Lancamento[], posteriores: (pos.data ?? []) as unknown as Lancamento[] }
}

export const siglaBanco = (c: Conta | undefined) => {
  const b = c?.bancos as Banco | null | undefined
  return b?.sigla || (b?.nome ? b.nome.split(/\s+/).filter(w => w.length > 2).map(w => w[0]).join('').toUpperCase().slice(0, 5) : null) || c?.nome || '—'
}

/**
 * Reconstrói o fluxo diário das contas a partir do saldo atual (informado pelo banco), descontando os movimentos
 * posteriores ao período. Transferências entre contas próprias (mesmo valor, contas diferentes, até 1 dia) são marcadas
 * como internas e, se `ocultarInternas`, não entram em Entradas/Saídas (o saldo consolidado não é afetado de qualquer modo).
 * `todosOsDias` inclui dias sem movimento (saldo carregado).
 */
export function calcularFluxoRealizado(d: FluxoDados, ini: string, fim: string, ocultarInternas = true, todosOsDias = false) {
  const contas = d.contas
  const ids = new Set(contas.map(c => c.id))
  const pertence = (l: Lancamento) => (l.conta_id && ids.has(l.conta_id)) || (l.tipo === 'transferencia' && l.conta_destino_id && ids.has(l.conta_destino_id))
  const contaDe = (l: Lancamento) => (l.tipo === 'transferencia' && l.conta_destino_id && ids.has(l.conta_destino_id) && !(l.conta_id && ids.has(l.conta_id))) ? l.conta_destino_id! : l.conta_id!
  const ambas = (l: Lancamento) => l.tipo === 'transferencia' && !!l.conta_id && !!l.conta_destino_id && ids.has(l.conta_id) && ids.has(l.conta_destino_id)
  const lanc = d.lanc.filter(pertence)
  const interna = new Set<string>()
  if (contas.length > 1) {
    const desp = lanc.filter(l => l.tipo === 'despesa'); const recs = lanc.filter(l => l.tipo === 'receita'); const usados = new Set<string>()
    for (const x of desp) {
      const par = recs.find(r => !usados.has(r.id) && r.conta_id !== x.conta_id && Math.abs(Number(r.valor) - Number(x.valor)) < 0.005 && Math.abs(dataLocal(r.data).getTime() - dataLocal(x.data).getTime()) <= 86400000)
      if (par) { usados.add(par.id); interna.add(x.id); interna.add(par.id) }
    }
    for (const l of lanc) if (ambas(l)) interna.add(l.id)
  }
  const efeito = (l: Lancamento) => ambas(l) ? 0 : sinal(l, contaDe(l)) * Number(l.valor)
  const saldoAtual = contas.reduce((a, c) => a + Number(c.saldo_atual), 0)
  const movPost = d.posteriores.filter(pertence).reduce((a, l) => a + efeito(l), 0)
  const saldoFinal = saldoAtual - movPost
  const saldoInicial = saldoFinal - lanc.reduce((a, l) => a + efeito(l), 0)
  let acc = saldoInicial
  const linhas: LinhaFluxo[] = lanc.map(l => { const e = efeito(l); acc += e; return { l, efeito: e, saldo: acc, interna: interna.has(l.id), conta: siglaBanco(contas.find(c => c.id === contaDe(l))) } })
  const porDia = new Map<string, LinhaFluxo[]>()
  for (const r of linhas) (porDia.get(r.l.data) ?? porDia.set(r.l.data, []).get(r.l.data)!).push(r)
  const dias: DiaFluxo[] = []
  let s = saldoInicial
  const datas = todosOsDias ? (() => { const out: string[] = []; for (let dt = dataLocal(ini); iso(dt) <= fim; dt = addDias(dt, 1)) out.push(iso(dt)); return out })() : [...porDia.keys()].sort()
  for (const data of datas) {
    const ls = porDia.get(data) ?? []
    let entradas = 0, saidas = 0
    for (const r of ls) { if (ocultarInternas && r.interna) continue; if (r.efeito > 0) entradas += r.efeito; else saidas += -r.efeito }
    const fimDia = ls.length ? ls[ls.length - 1].saldo : s
    dias.push({ data, linhas: ls, saldoInicial: s, entradas, saidas, saldoFinal: fimDia }); s = fimDia
  }
  const entradas = dias.reduce((a, x) => a + x.entradas, 0), saidas = dias.reduce((a, x) => a + x.saidas, 0)
  return { contas, dias, entradas, saidas, saldoInicial, saldoFinal, internas: interna.size, total: lanc.length }
}

/* ───────────────────────── Fluxo projetado (Agenda + Projeções) ───────────────────────── */

export interface AgendaEvento { id: string; data: string; titulo: string; valor: number; tipo: 'receita' | 'despesa' | 'transferencia'; plano_conta_id: string | null; recorrencia: 'unica' | 'mensal' | 'anual'; concluido: boolean; observacao: string | null }
export interface Ajuste { id: string; chave: string; valor: number | null; data: string | null; titulo: string | null; observacao: string | null; oculto: boolean }
export interface ItemProjetado { key: string; data: string; titulo: string; detalhe: string; valor: number; tipo: 'receita' | 'despesa' | 'transferencia'; origem: 'fatura' | 'manual' | 'projecao'; ev?: AgendaEvento; ajuste?: Ajuste; conta?: Conta; concluido?: boolean }
export interface AgendaDados { contas: Conta[]; eventos: AgendaEvento[]; planos: PlanoConta[]; ajustes: Ajuste[]; tx: { conta_id: string; data: string; valor: number; tipo: string }[]; projecoes: Projecao[] }

export async function carregarAgenda(ws: string, ini: Date, fim: Date, comProjecoes = false): Promise<AgendaDados> {
  const [c, e, p, aj, tx, pr] = await Promise.all([
    supabase.from('contas').select('*').eq('workspace_id', ws).eq('ativa', true),
    supabase.from('agenda_eventos').select('*').eq('workspace_id', ws).gte('data', iso(addDias(ini, -400))).lte('data', iso(fim)).order('data'),
    supabase.from('plano_contas').select('*').eq('workspace_id', ws).eq('ativo', true).order('codigo'),
    supabase.from('agenda_ajustes').select('*').eq('workspace_id', ws),
    supabase.from('lancamentos').select('conta_id, data, valor, tipo').eq('workspace_id', ws).gte('data', iso(addDias(ini, -70))).lte('data', iso(addDias(fim, 40))).neq('tipo', 'transferencia').limit(20000),
    comProjecoes ? supabase.from('projecoes').select('*').eq('workspace_id', ws).eq('status', 'prevista').gte('competencia', iso(new Date(ini.getFullYear(), ini.getMonth(), 1, 12))).lte('competencia', iso(fim)) : Promise.resolve({ data: [] as Projecao[], error: null }),
  ])
  if (e.error) throw e.error
  return { contas: c.data as Conta[], eventos: e.data as AgendaEvento[], planos: (p.data ?? []) as PlanoConta[], ajustes: (aj.data ?? []) as Ajuste[], tx: (tx.data ?? []) as AgendaDados['tx'], projecoes: (pr.data ?? []) as Projecao[] }
}

/** Itens projetados entre ini e fim: faturas de cartão por ciclo de fechamento, compromissos manuais (com recorrência) e, se carregadas, Projeções previstas. */
export function calcularItensProjetados(d: AgendaDados, hoje: Date, ini: Date, fim: Date): ItemProjetado[] {
  const out: ItemProjetado[] = []
  const dentro = (s: string) => s >= iso(ini) && s <= iso(fim)
  const mesesDiff = (a: Date, b: Date) => (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth())
  const ajusteDe = (chave: string) => d.ajustes.find(a => a.chave === chave)
  for (const c of d.contas.filter(x => x.tipo === 'cartao_credito')) {
    const venc = c.vencimento_fatura
    if (!venc) {
      const chave = `fatura:${c.id}:sem-data`; const aj = ajusteDe(chave); if (aj?.oculto) continue
      const data = aj?.data ?? iso(hoje); if (!dentro(data)) continue
      out.push({ key: chave, data, titulo: aj?.titulo ?? `Fatura ${c.nome}`, detalhe: aj?.observacao ?? 'informe o dia de vencimento em Contas para posicionar e calcular por ciclo', valor: aj?.valor ?? Math.abs(Number(c.saldo_atual)), tipo: 'despesa', origem: 'fatura', ajuste: aj, conta: c }); continue
    }
    const fech = c.fechamento_fatura ?? Math.max(1, venc - 7)
    const txConta = d.tx.filter(t => t.conta_id === c.id)
    for (let k = mesesDiff(hoje, ini) - 1; k <= mesesDiff(hoje, fim) + 1; k++) {
      const ultimoDia = (y: number, m: number) => new Date(y, m + 1, 0).getDate()
      const dtVenc = new Date(hoje.getFullYear(), hoje.getMonth() + k, Math.min(venc, ultimoDia(hoje.getFullYear(), hoje.getMonth() + k)), 12)
      const mesFech = fech < venc ? 0 : -1
      const dtFech = new Date(dtVenc.getFullYear(), dtVenc.getMonth() + mesFech, Math.min(fech, ultimoDia(dtVenc.getFullYear(), dtVenc.getMonth() + mesFech)), 12)
      const dtFechAnt = new Date(dtFech.getFullYear(), dtFech.getMonth() - 1, Math.min(fech, ultimoDia(dtFech.getFullYear(), dtFech.getMonth() - 1)), 12)
      const sVenc = iso(dtVenc); if (!dentro(sVenc)) continue
      const chave = `fatura:${c.id}:${sVenc}`; const aj = ajusteDe(chave); if (aj?.oculto) continue
      const ciclo = txConta.filter(t => t.data > iso(dtFechAnt) && t.data <= iso(dtFech))
      const calc = ciclo.reduce((a, t) => a + (t.tipo === 'despesa' ? Number(t.valor) : -Number(t.valor)), 0)
      const fechado = iso(dtFech) <= iso(hoje)
      const temDados = ciclo.length > 0
      const valor = aj?.valor ?? (temDados ? Math.max(0, calc) : (k <= 0 ? Math.abs(Number(c.saldo_atual)) : 0))
      const detalhe = aj?.observacao ?? (aj?.valor != null ? 'valor ajustado manualmente' : temDados ? `${ciclo.length} lançamentos de ${fmtDate(iso(addDias(dtFechAnt, 1)))} a ${fmtDate(iso(dtFech))}${fechado ? '' : ' · ciclo em aberto (parcial)'}` : k <= 0 ? 'sem lançamentos no ciclo — usando saldo informado pelo banco' : 'sem lançamentos previstos no ciclo')
      out.push({ key: chave, data: aj?.data ?? sVenc, titulo: aj?.titulo ?? `Fatura ${c.nome}`, detalhe, valor, tipo: 'despesa', origem: 'fatura', ajuste: aj, conta: c })
    }
  }
  const nomePlano = (id: string | null) => d.planos.find(p => p.id === id)?.nome
  for (const ev of d.eventos) {
    const base = dataLocal(ev.data)
    const datas: string[] = []
    if (ev.recorrencia === 'unica') datas.push(ev.data)
    else for (let k = 0; k <= 36; k++) { const dt = ev.recorrencia === 'mensal' ? new Date(base.getFullYear(), base.getMonth() + k, Math.min(base.getDate(), new Date(base.getFullYear(), base.getMonth() + k + 1, 0).getDate()), 12) : new Date(base.getFullYear() + k, base.getMonth(), base.getDate(), 12); const s = iso(dt); if (s > iso(fim)) break; datas.push(s) }
    for (const s of datas) if (dentro(s)) out.push({ key: `m-${ev.id}-${s}`, data: s, titulo: ev.titulo, detalhe: [nomePlano(ev.plano_conta_id), ev.recorrencia !== 'unica' ? (ev.recorrencia === 'mensal' ? 'mensal' : 'anual') : null, ev.observacao].filter(Boolean).join(' · '), valor: Number(ev.valor), tipo: ev.tipo, origem: 'manual', ev, concluido: ev.recorrencia === 'unica' && ev.concluido })
  }
  for (const p of d.projecoes) {
    if (p.tipo === 'transferencia') continue
    // sem data prevista: considera o último dia da competência (pior caso para caixa, dentro do mês)
    const comp = dataLocal(p.competencia)
    const data = p.data_prevista ?? iso(new Date(comp.getFullYear(), comp.getMonth() + 1, 0, 12))
    if (!dentro(data)) continue
    out.push({ key: `p-${p.id}`, data, titulo: p.descricao, detalhe: [nomePlano(p.plano_conta_id), 'projeção'].filter(Boolean).join(' · '), valor: Number(p.valor), tipo: p.tipo, origem: 'projecao' })
  }
  return out.sort((a, b) => a.data.localeCompare(b.data))
}
