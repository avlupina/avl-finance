import { useMemo, useState } from 'react'
import { Download } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useQuery } from '../hooks/useQuery'
import { Badge, Empty, ErrorBox, Kpi, Loading, PageHeader, Tabs } from '../components/ui'
import { brl, downloadCSV, fmtDate, todayISO } from '../lib/format'
import type { Banco, Conta, Lancamento } from '../lib/types'

type Periodo = '7' | '15' | '30' | '60' | '90' | 'custom'
const addDias = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x }
const iso = (d: Date) => d.toISOString().slice(0, 10)
/** Sinal do lançamento na conta: entrada (+) ou saída (−). Transferências usam conta_id como origem (saída) e conta_destino_id como destino (entrada). */
const sinal = (l: Lancamento, contaId: string) => l.tipo === 'receita' ? 1 : l.tipo === 'despesa' ? -1 : (l.conta_destino_id === contaId ? 1 : -1)

/** Movimento Financeiro: extrato integrado das contas (somente lançamentos efetivados), com saldo diário e entradas/saídas do período. */
export default function Movimento() {
  const { workspace } = useAuth()
  const ws = workspace!.id
  const [p, setP] = useState<Periodo>('30')
  const [custom, setCustom] = useState(() => { const t = new Date(todayISO() + 'T12:00:00'); return { ini: iso(new Date(t.getFullYear(), t.getMonth(), 1, 12)), fim: iso(t) } })
  const [ocultarInternas, setOcultarInternas] = useState(true)
  const hoje = new Date(todayISO() + 'T12:00:00')
  const ini = p === 'custom' ? custom.ini : iso(addDias(hoje, -(Number(p) - 1)))
  const fim = p === 'custom' ? custom.fim : iso(hoje)

  const q = useQuery(async () => {
    const [c, l, pos] = await Promise.all([
      supabase.from('contas').select('*, bancos(nome, sigla)').eq('workspace_id', ws).eq('ativa', true).neq('tipo', 'cartao_credito').order('nome'),
      supabase.from('lancamentos').select('id, data, descricao, valor, tipo, status, conta_id, conta_destino_id, plano_conta_id, plano_contas(nome, codigo)').eq('workspace_id', ws).neq('status', 'pendente').gte('data', ini).lte('data', fim).order('data').order('id').limit(20000),
      // movimentos posteriores ao período: necessários para recompor o saldo do fim do período a partir do saldo atual
      supabase.from('lancamentos').select('id, data, valor, tipo, conta_id, conta_destino_id').eq('workspace_id', ws).neq('status', 'pendente').gt('data', fim).limit(20000),
    ])
    if (l.error) throw l.error
    return { contas: (c.data ?? []) as Conta[], lanc: (l.data ?? []) as unknown as Lancamento[], posteriores: (pos.data ?? []) as Lancamento[] }
  }, [ws, ini, fim])

  const m = useMemo(() => {
    const d = q.data; if (!d) return null
    const contas = d.contas
    const ids = new Set(contas.map(c => c.id))
    const sigla = (id: string | null) => { const c = d.contas.find(x => x.id === id); const b = c?.bancos as Banco | null | undefined; return b?.sigla || (b?.nome ? b.nome.split(/\s+/).filter(w => w.length > 2).map(w => w[0]).join('').toUpperCase().slice(0, 5) : null) || c?.nome || '—' }
    const pertence = (l: Lancamento) => (l.conta_id && ids.has(l.conta_id)) || (l.tipo === 'transferencia' && l.conta_destino_id && ids.has(l.conta_destino_id))
    const contaDe = (l: Lancamento) => (l.tipo === 'transferencia' && l.conta_destino_id && ids.has(l.conta_destino_id) && !(l.conta_id && ids.has(l.conta_id))) ? l.conta_destino_id! : l.conta_id!
    const lanc = d.lanc.filter(pertence)
    // Transferências internas (entre contas selecionadas): receita e despesa de mesmo valor, em contas diferentes, até 1 dia de diferença.
    const interna = new Set<string>()
    if (contas.length > 1) {
      const desp = lanc.filter(l => l.tipo === 'despesa')
      const recs = lanc.filter(l => l.tipo === 'receita')
      const usados = new Set<string>()
      for (const x of desp) {
        const par = recs.find(r => !usados.has(r.id) && r.conta_id !== x.conta_id && Math.abs(Number(r.valor) - Number(x.valor)) < 0.005 && Math.abs(new Date(r.data).getTime() - new Date(x.data).getTime()) <= 86400000)
        if (par) { usados.add(par.id); interna.add(x.id); interna.add(par.id) }
      }
      for (const l of lanc) if (l.tipo === 'transferencia' && l.conta_id && l.conta_destino_id && ids.has(l.conta_id) && ids.has(l.conta_destino_id)) interna.add(l.id)
    }
    // Saldo final do período = saldo atual − movimentos posteriores ao período (nas contas selecionadas).
    const saldoAtual = contas.reduce((a, c) => a + Number(c.saldo_atual), 0)
    const movPost = d.posteriores.filter(pertence).reduce((a, l) => {
      if (l.tipo === 'transferencia' && l.conta_id && l.conta_destino_id && ids.has(l.conta_id) && ids.has(l.conta_destino_id)) return a
      return a + sinal(l, contaDe(l)) * Number(l.valor)
    }, 0)
    const saldoFinal = saldoAtual - movPost
    const efeito = (l: Lancamento) => (l.tipo === 'transferencia' && l.conta_id && l.conta_destino_id && ids.has(l.conta_id) && ids.has(l.conta_destino_id)) ? 0 : sinal(l, contaDe(l)) * Number(l.valor)
    const movPeriodo = lanc.reduce((a, l) => a + efeito(l), 0)
    const saldoInicial = saldoFinal - movPeriodo
    // Linhas em ordem cronológica com saldo acumulado
    let acc = saldoInicial
    const linhas = lanc.map(l => { const e = efeito(l); acc += e; return { l, efeito: e, saldo: acc, interna: interna.has(l.id), conta: sigla(contaDe(l)) } })
    // Agrupar por dia
    const dias: { data: string; linhas: typeof linhas; entradas: number; saidas: number; saldo: number }[] = []
    for (const r of linhas) {
      let dia = dias[dias.length - 1]
      if (!dia || dia.data !== r.l.data) { dia = { data: r.l.data, linhas: [], entradas: 0, saidas: 0, saldo: r.saldo }; dias.push(dia) }
      dia.linhas.push(r); dia.saldo = r.saldo
      if (!(ocultarInternas && r.interna)) { if (r.efeito > 0) dia.entradas += r.efeito; else dia.saidas += -r.efeito }
    }
    const entradas = dias.reduce((a, x) => a + x.entradas, 0), saidas = dias.reduce((a, x) => a + x.saidas, 0)
    const internas = [...interna].length
    return { contas, dias, entradas, saidas, saldoInicial, saldoFinal, internas, total: lanc.length }
  }, [q.data, ocultarInternas, ini, fim])

  const exportar = () => {
    if (!m) return
    downloadCSV(`movimento_${ini}_${fim}.csv`, m.dias.flatMap(d => d.linhas.map(r => ({ data: r.l.data, conta: r.conta, descricao: r.l.descricao, categoria: r.l.plano_contas?.nome ?? '', tipo: r.interna ? 'transferência interna' : r.efeito > 0 ? 'entrada' : 'saída', valor: r.efeito, saldo: r.saldo }))))
  }

  return (
    <div>
      <PageHeader crumb="Visão" title="Movimento Financeiro" actions={<>
        <Tabs tabs={[{ key: '7', label: '7 dias' }, { key: '15', label: '15 dias' }, { key: '30', label: '30 dias' }, { key: '60', label: '60 dias' }, { key: '90', label: '90 dias' }, { key: 'custom', label: 'Período' }]} value={p} onChange={setP} />
        {p === 'custom' && <div className="flex items-center gap-2 text-sm">
          <input type="date" className="input w-auto py-1.5" value={custom.ini} max={custom.fim} onChange={e => setCustom(c => ({ ...c, ini: e.target.value || c.ini }))} />
          <span className="text-muted">a</span>
          <input type="date" className="input w-auto py-1.5" value={custom.fim} min={custom.ini} onChange={e => setCustom(c => ({ ...c, fim: e.target.value || c.fim }))} />
        </div>}
        <button className="btn btn-ghost" onClick={exportar} title="Exportar CSV"><Download size={16} /></button>
      </>} />

      {q.loading ? <Loading /> : q.error ? <ErrorBox msg={q.error} /> : !m ? null : (<>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
          <Kpi label="Saldo inicial" value={brl(m.saldoInicial)} tone="brand" sub={`em ${fmtDate(ini)}`} />
          <Kpi label="Entradas" value={brl(m.entradas)} tone="pos" />
          <Kpi label="Saídas" value={brl(m.saidas)} tone="neg" />
          <Kpi label="Saldo final" value={brl(m.saldoFinal)} tone={m.saldoFinal >= 0 ? 'pos' : 'neg'} sub={<>resultado do período <b className={m.entradas - m.saidas >= 0 ? 'text-pos' : 'text-neg'}>{brl(m.entradas - m.saidas)}</b></>} />
        </div>

        {m.internas > 0 && <label className="flex items-center gap-2 text-sm text-muted mb-3 cursor-pointer"><input type="checkbox" checked={ocultarInternas} onChange={e => setOcultarInternas(e.target.checked)} /> Desconsiderar transferências entre contas próprias nas Entradas/Saídas ({m.internas} lançamento(s) identificados)</label>}

        {!m.dias.length ? <Empty title="Sem movimentação no período" hint="Nenhum lançamento efetivado nas contas selecionadas entre as datas escolhidas." /> : (
          <div className="card overflow-hidden">
            <table className="tbl">
              <thead><tr><th>Data</th><th>Descrição</th><th>Conta</th><th>Categoria</th><th className="text-right">Entrada</th><th className="text-right">Saída</th><th className="text-right">Saldo</th></tr></thead>
              <tbody>
                {m.dias.map(d => (<FragmentDia key={d.data} d={d} ocultarInternas={ocultarInternas} />))}
                <tr className="bg-surface/60"><td colSpan={4} className="font-bold">Total do período</td><td className="text-right num font-bold text-pos">{brl(m.entradas)}</td><td className="text-right num font-bold text-neg">{brl(m.saidas)}</td><td className="text-right num font-bold">{brl(m.saldoFinal)}</td></tr>
              </tbody>
            </table>
          </div>
        )}
      </>)}
    </div>
  )
}

function FragmentDia({ d, ocultarInternas }: { d: { data: string; linhas: { l: Lancamento; efeito: number; saldo: number; interna: boolean; conta: string }[]; entradas: number; saidas: number; saldo: number }; ocultarInternas: boolean }) {
  const dow = new Date(d.data + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'short' })
  return (<>
    {d.linhas.map(r => (
      <tr key={r.l.id} className={ocultarInternas && r.interna ? 'opacity-50' : ''}>
        <td className="num whitespace-nowrap w-28">{fmtDate(d.data)}<div className="text-[11px] text-muted">{dow}</div></td>
        <td><div className="font-medium">{r.l.descricao}</div>{r.interna && <Badge tone="blue">Transf. interna</Badge>}</td>
        <td className="text-xs font-bold text-ink/70 whitespace-nowrap">{r.conta}</td>
        <td className="text-xs text-muted">{r.l.plano_contas?.nome ?? <span className="text-amber-600">sem categoria</span>}</td>
        <td className="text-right num text-pos">{r.efeito > 0 ? brl(r.efeito) : ''}</td>
        <td className="text-right num text-neg">{r.efeito < 0 ? brl(-r.efeito) : ''}</td>
        <td className="text-right num">{brl(r.saldo)}</td>
      </tr>
    ))}
  </>)
}
