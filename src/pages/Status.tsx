import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Filter, Wallet, TrendingUp, Landmark, AlertTriangle } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useQuery } from '../hooks/useQuery'
import { useResumo } from '../hooks/useResumo'
import { ErrorBox, Field, Kpi, Loading, PageHeader } from '../components/ui'
import { BarrasHorizontais, ReceitaDespesaChart, SERIES } from '../components/charts'
import { Gauge, Anel } from '../components/Gauge'
import { brl, firstDayOfMonth, fmtDate, fmtDateTime, mesLabel, pct, todayISO } from '../lib/format'
import type { Lancamento, PlanoConta } from '../lib/types'

export default function Status() {
  const { workspace } = useAuth()
  const ws = workspace!.id
  const resumo = useResumo()
  const [pilar, setPilar] = useState(0)
  const [ini, setIni] = useState(firstDayOfMonth())
  const [fim, setFim] = useState(todayISO())

  useEffect(() => { supabase.rpc('registrar_snapshot_patrimonio', { ws }).then(() => {}) }, [ws])

  const hist = useQuery(async () => {
    const mes6 = new Date(); mes6.setMonth(mes6.getMonth() - 5)
    const [r, c] = await Promise.all([
      supabase.from('v_resultado_mensal').select('*').eq('workspace_id', ws).gte('competencia', `${mes6.getFullYear()}-${String(mes6.getMonth() + 1).padStart(2, '0')}-01`).order('competencia'),
      supabase.from('contas').select('ultima_sincronizacao').eq('workspace_id', ws).eq('ativa', true),
    ])
    return { res: (r.data ?? []) as { competencia: string; receitas: number; despesas: number; resultado: number }[], sinc: (c.data ?? []).map(x => x.ultima_sincronizacao).filter(Boolean).sort().pop() as string | undefined }
  }, [ws])

  const periodo = useQuery(async () => {
    const [l, p] = await Promise.all([
      supabase.from('lancamentos').select('id, data, valor, tipo, status, plano_conta_id').eq('workspace_id', ws).gte('data', ini).lte('data', fim).neq('status', 'pendente').limit(20000),
      supabase.from('plano_contas').select('*').eq('workspace_id', ws),
    ])
    if (l.error) throw l.error
    return { lanc: l.data as unknown as Lancamento[], planos: (p.data ?? []) as PlanoConta[] }
  }, [ws, ini, fim])

  const calc = useMemo(() => {
    const lanc = periodo.data?.lanc ?? []; const pl = Object.fromEntries((periodo.data?.planos ?? []).map(p => [p.id, p]))
    let rec = 0, desp = 0, semCat = 0; const porCat: Record<string, number> = {}
    for (const l of lanc) {
      if (l.tipo === 'transferencia') continue
      const v = Number(l.valor); const p = l.plano_conta_id ? pl[l.plano_conta_id] : undefined
      if (!p) semCat++
      const ehRec = p ? p.tipo === 'receita' : l.tipo === 'receita'
      const sinal = (l.tipo === 'receita') === ehRec ? 1 : -1
      if (ehRec) rec += sinal * v; else { desp += sinal * v; const g = p ? (p.parent_id ? pl[p.parent_id]?.nome ?? p.nome : p.nome) : 'Sem categoria'; porCat[g] = (porCat[g] ?? 0) + sinal * v }
    }
    return { rec, desp, semCat, n: lanc.length, top: Object.entries(porCat).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([nome, valor]) => ({ nome, valor })) }
  }, [periodo.data])

  const r = resumo.r
  const saldo = r?.saldoContas ?? 0, inv = r?.investTotal ?? 0, pl = (r?.ativos ?? 0) - (r?.passivos ?? 0)
  const chart = (hist.data?.res ?? []).map(x => ({ mes: mesLabel(x.competencia), receitas: Number(x.receitas), despesas: Number(x.despesas), resultado: Number(x.resultado) }))
  const atalhos = [
    { l: 'Mês atual', f: () => [firstDayOfMonth(), todayISO()] },
    { l: '30 dias', f: () => { const d = new Date(); d.setDate(d.getDate() - 29); return [d.toISOString().slice(0, 10), todayISO()] } },
    { l: 'Mês anterior', f: () => { const d = new Date(); return [new Date(d.getFullYear(), d.getMonth() - 1, 1).toISOString().slice(0, 10), new Date(d.getFullYear(), d.getMonth(), 0).toISOString().slice(0, 10)] } },
    { l: '12 meses', f: () => { const d = new Date(); d.setFullYear(d.getFullYear() - 1); return [d.toISOString().slice(0, 10), todayISO()] } },
    { l: 'Ano', f: () => [`${new Date().getFullYear()}-01-01`, todayISO()] },
  ]

  return (
    <div>
      <PageHeader crumb="Visão" title="Status Atual" actions={<div className="text-xs text-muted">{hist.data?.sinc ? `Dados bancários atualizados em ${fmtDateTime(hist.data.sinc)}` : 'Sem contas conectadas'}</div>} />

      {/* 1. Filtro de período */}
      <div className="card p-3 flex flex-wrap items-end gap-3 mb-4 no-print">
        <div className="flex items-center gap-1 text-muted text-xs font-bold uppercase pr-2"><Filter size={14} /> Período</div>
        <Field label="Data inicial"><input type="date" className="input" value={ini} onChange={e => setIni(e.target.value)} /></Field>
        <Field label="Data final"><input type="date" className="input" value={fim} onChange={e => setFim(e.target.value)} /></Field>
        <div className="flex gap-1 pb-0.5 flex-wrap">{atalhos.map(x => <button key={x.l} className="btn py-1.5 text-xs" onClick={() => { const [a, b] = x.f(); setIni(a); setFim(b) }}>{x.l}</button>)}</div>
      </div>

      {/* 2. Receitas, gastos e resultado do período */}
      {periodo.error ? <ErrorBox msg={periodo.error} /> : (
        <div className="grid grid-cols-3 gap-3 mb-3">
          <Kpi label="Entradas" value={periodo.loading ? '…' : brl(calc.rec)} tone="pos" sub={`${fmtDate(ini)} a ${fmtDate(fim)}`} />
          <Kpi label="Saídas" value={periodo.loading ? '…' : brl(calc.desp)} tone="neg" sub={`${calc.n} lançamentos${calc.semCat ? ` · ${calc.semCat} sem categoria` : ''}`} />
          <Kpi label="Resultado" value={periodo.loading ? '…' : brl(calc.rec - calc.desp)} tone={calc.rec - calc.desp >= 0 ? 'brand' : 'neg'} sub={calc.rec ? `taxa de poupança ${pct((calc.rec - calc.desp) / calc.rec * 100)}` : undefined} />
        </div>
      )}

      {/* 3. Posição */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        <Kpi label="Saldo em conta" value={brl(saldo)} tone="brand" sub={<span className="flex items-center gap-1"><Wallet size={12} /> contas correntes e poupança</span>} />
        <Kpi label="Investimentos" value={brl(inv)} sub={<span className="flex items-center gap-1"><TrendingUp size={12} /> posição atual</span>} />
        <Kpi label="Patrimônio líquido" value={brl(pl)} tone={pl >= 0 ? 'pos' : 'neg'} sub={<span className="flex items-center gap-1"><Landmark size={12} /> ativos − passivos</span>} />
      </div>

      {/* 4. Termômetro e pilares */}
      {resumo.loading ? <Loading /> : r && (
        <div className="card p-5 mb-4">
          <div className="grid lg:grid-cols-[300px_1fr] gap-6 items-center">
            <div className="flex flex-col items-center"><Gauge value={r.score.total} label={r.score.rotulo} /><div className="text-xs text-muted -mt-2">Score financeiro · média dos últimos {r.media.meses || 0} meses</div></div>
            <div>
              <div className="flex flex-wrap gap-2 mb-4">{r.score.pilares.map((p, i) => <button key={p.key} onClick={() => setPilar(i)} className={`btn text-sm ${pilar === i ? 'border-brand bg-brand-soft' : ''}`}><span className="w-1.5 h-4 rounded-sm" style={{ background: p.cor }} /> {p.label}</button>)}</div>
              <div className="flex items-center gap-5 flex-wrap"><Anel value={r.score.pilares[pilar].score} cor={r.score.pilares[pilar].cor} /><ul className="text-sm text-ink/80 flex flex-col gap-1">{r.score.pilares[pilar].detalhes.map(d => <li key={d}>• {d}</li>)}</ul></div>
            </div>
          </div>
        </div>
      )}

      {/* 5. Gráficos */}
      <div className="grid lg:grid-cols-2 gap-4 mb-4">
        <div className="card p-4"><div className="font-black mb-1">Saídas por grupo no período</div>{calc.top.length ? <BarrasHorizontais data={calc.top} color={SERIES[1]} /> : <div className="text-sm text-muted py-6">Sem despesas no período.</div>}</div>
        <div className="card p-4"><div className="font-black mb-1">Últimos 6 meses</div>{chart.length ? <ReceitaDespesaChart data={chart} /> : <div className="text-sm text-muted py-6">Sem histórico ainda.</div>}</div>
      </div>

      {/* 6. Alertas */}
      {r && !!r.score.alertas.length && (
        <div className="card p-4">
          <div className="font-black mb-3">Pontos de atenção</div>
          <ul className="flex flex-col gap-2">
            {r.score.alertas.map((a, i) => (
              <li key={i} className="flex items-center gap-3 text-sm">
                <span className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${a.nivel === 'alto' ? 'bg-red-50 text-neg' : a.nivel === 'medio' ? 'bg-amber-50 text-amber-700' : 'bg-brand-soft text-brand'}`}><AlertTriangle size={15} /></span>
                <span className="flex-1">{a.texto}</span>
                <Link to={a.to} className="font-bold text-brand whitespace-nowrap">{a.acao}</Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
