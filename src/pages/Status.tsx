import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Filter, Wallet, CreditCard, TrendingUp, Landmark, AlertTriangle, ArrowRight } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useQuery } from '../hooks/useQuery'
import { Empty, ErrorBox, Field, Kpi, Loading, MoneyCell, PageHeader } from '../components/ui'
import { BarrasHorizontais, ReceitaDespesaChart, SERIES } from '../components/charts'
import { brl, firstDayOfMonth, fmtDate, fmtDateTime, mesLabel, pct, todayISO } from '../lib/format'
import { useResumo } from '../hooks/useResumo'
import { Gauge, Anel } from '../components/Gauge'
import type { Conta, Lancamento, PlanoConta, Projecao } from '../lib/types'

const saudacao = () => { const h = new Date().getHours(); return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite' }

export default function Status() {
  const { workspace, profile } = useAuth()
  const ws = workspace!.id
  const resumo = useResumo()
  const [pilar, setPilar] = useState(0)
  const [ini, setIni] = useState(firstDayOfMonth())
  const [fim, setFim] = useState(todayISO())

  useEffect(() => { supabase.rpc('registrar_snapshot_patrimonio', { ws }).then(() => {}) }, [ws])

  const base = useQuery(async () => {
    const mes6 = new Date(); mes6.setMonth(mes6.getMonth() - 5)
    const [c, p, r, m, pr] = await Promise.all([
      supabase.from('contas').select('*, bancos(nome, cor)').eq('workspace_id', ws).eq('ativa', true).order('tipo'),
      supabase.from('v_patrimonio_liquido').select('*').eq('workspace_id', ws).maybeSingle(),
      supabase.from('v_resultado_mensal').select('*').eq('workspace_id', ws).gte('competencia', `${mes6.getFullYear()}-${String(mes6.getMonth() + 1).padStart(2, '0')}-01`).order('competencia'),
      supabase.from('metas').select('*').eq('workspace_id', ws).limit(4),
      supabase.from('projecoes').select('*, plano_contas(nome)').eq('workspace_id', ws).eq('status', 'prevista').gte('competencia', firstDayOfMonth()).order('data_prevista', { nullsFirst: false }).limit(8),
    ])
    if (c.error) throw c.error
    return { contas: c.data as Conta[], pos: p.data as Record<string, number> | null, res: (r.data ?? []) as { competencia: string; receitas: number; despesas: number; resultado: number }[], metas: m.data ?? [], proj: (pr.data ?? []) as (Projecao & { plano_contas?: { nome: string } | null })[] }
  }, [ws])

  const periodo = useQuery(async () => {
    const [l, p] = await Promise.all([
      supabase.from('lancamentos').select('id, data, descricao, valor, tipo, status, plano_conta_id, contas:conta_id(nome)').eq('workspace_id', ws).gte('data', ini).lte('data', fim).neq('status', 'pendente').order('data', { ascending: false }).limit(20000),
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
    const top = Object.entries(porCat).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([nome, valor]) => ({ nome, valor }))
    return { rec, desp, semCat, top, n: lanc.length, ultimos: lanc.slice(0, 8) }
  }, [periodo.data])

  const pos = base.data?.pos
  const saldo = Number(pos?.saldo_contas ?? 0), fat = Number(pos?.faturas_cartao ?? 0), inv = Number(pos?.investimentos ?? 0)
  const pl = saldo + fat + inv + Number(pos?.outros_ativos ?? 0) - Number(pos?.passivos ?? 0)
  const chart = (base.data?.res ?? []).map(r => ({ mes: mesLabel(r.competencia), receitas: Number(r.receitas), despesas: Number(r.despesas), resultado: Number(r.resultado) }))
  const ultimaSinc = (base.data?.contas ?? []).map(c => c.ultima_sincronizacao).filter(Boolean).sort().pop()
  const projTotal = (base.data?.proj ?? []).filter(p => p.tipo === 'despesa').reduce((a, p) => a + Number(p.valor), 0)

  return (
    <div>
      <PageHeader crumb="Início" title={`${saudacao()}, ${(profile?.nome ?? '').split(' ')[0]}!`} actions={<div className="text-xs text-muted">{ultimaSinc ? `Dados bancários atualizados em ${fmtDateTime(ultimaSinc as string)}` : 'Sem contas conectadas'}</div>} />

      {/* Score financeiro */}
      {resumo.r && (
        <div className="card p-5 mb-5">
          <div className="grid lg:grid-cols-[300px_1fr] gap-6 items-center">
            <div className="flex flex-col items-center"><Gauge value={resumo.r.score.total} label={resumo.r.score.rotulo} /><div className="text-xs text-muted -mt-2">Score financeiro · média dos últimos {resumo.r.media.meses || 0} meses</div></div>
            <div>
              <div className="flex flex-wrap gap-2 mb-4">
                {resumo.r.score.pilares.map((p, i) => <button key={p.key} onClick={() => setPilar(i)} className={`btn text-sm ${pilar === i ? 'border-brand bg-brand-soft' : ''}`}><span className="w-1.5 h-4 rounded-sm" style={{ background: p.cor }} /> {p.label}</button>)}
              </div>
              <div className="flex items-center gap-5 flex-wrap">
                <Anel value={resumo.r.score.pilares[pilar].score} cor={resumo.r.score.pilares[pilar].cor} />
                <ul className="text-sm text-ink/80 flex flex-col gap-1">{resumo.r.score.pilares[pilar].detalhes.map(d => <li key={d}>• {d}</li>)}</ul>
              </div>
            </div>
          </div>
          {!!resumo.r.score.alertas.length && (
            <ul className="mt-5 border-t border-line pt-4 flex flex-col gap-2">
              {resumo.r.score.alertas.slice(0, 5).map((a, i) => (
                <li key={i} className="flex items-center gap-3 text-sm">
                  <span className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${a.nivel === 'alto' ? 'bg-red-50 text-neg' : a.nivel === 'medio' ? 'bg-amber-50 text-amber-700' : 'bg-brand-soft text-brand'}`}><AlertTriangle size={15} /></span>
                  <span className="flex-1">{a.texto}</span>
                  <Link to={a.to} className="font-bold text-brand whitespace-nowrap">{a.acao}</Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Posição */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <Kpi label="Disponível em contas" value={brl(saldo)} tone="brand" sub={<span className="flex items-center gap-1"><Wallet size={12} /> {(base.data?.contas ?? []).filter(c => c.tipo !== 'cartao_credito').length} conta(s)</span>} />
        <Kpi label="Faturas de cartão" value={brl(Math.abs(fat))} tone="neg" sub={<span className="flex items-center gap-1"><CreditCard size={12} /> a pagar</span>} />
        <Kpi label="Investimentos" value={brl(inv)} sub={<span className="flex items-center gap-1"><TrendingUp size={12} /> posição atual</span>} />
        <Kpi label="Patrimônio líquido" value={brl(pl)} tone={pl >= 0 ? 'pos' : 'neg'} sub={<span className="flex items-center gap-1"><Landmark size={12} /> ativos − passivos</span>} />
      </div>

      {/* Filtro de período */}
      <div className="card p-3 flex flex-wrap items-end gap-3 mb-4 no-print">
        <div className="flex items-center gap-1 text-muted text-xs font-bold uppercase pr-2"><Filter size={14} /> Receitas e gastos no período</div>
        <Field label="Data inicial"><input type="date" className="input" value={ini} onChange={e => setIni(e.target.value)} /></Field>
        <Field label="Data final"><input type="date" className="input" value={fim} onChange={e => setFim(e.target.value)} /></Field>
        <div className="flex gap-1 pb-0.5">
          {[{ l: 'Mês atual', f: () => [firstDayOfMonth(), todayISO()] }, { l: '30 dias', f: () => { const d = new Date(); d.setDate(d.getDate() - 29); return [d.toISOString().slice(0, 10), todayISO()] } }, { l: 'Mês anterior', f: () => { const d = new Date(); const a = new Date(d.getFullYear(), d.getMonth() - 1, 1); const b = new Date(d.getFullYear(), d.getMonth(), 0); return [a.toISOString().slice(0, 10), b.toISOString().slice(0, 10)] } }, { l: 'Ano', f: () => [`${new Date().getFullYear()}-01-01`, todayISO()] }]
            .map(x => <button key={x.l} className="btn py-1.5 text-xs" onClick={() => { const [a, b] = x.f(); setIni(a); setFim(b) }}>{x.l}</button>)}
        </div>
      </div>

      {periodo.loading ? <Loading /> : periodo.error ? <ErrorBox msg={periodo.error} /> : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
          <Kpi label="Receitas" value={brl(calc.rec)} tone="pos" sub={`${fmtDate(ini)} a ${fmtDate(fim)}`} />
          <Kpi label="Gastos" value={brl(calc.desp)} tone="neg" sub={`${calc.n} lançamentos`} />
          <Kpi label="Resultado" value={brl(calc.rec - calc.desp)} tone={calc.rec - calc.desp >= 0 ? 'brand' : 'neg'} sub={calc.rec ? `poupança ${pct((calc.rec - calc.desp) / calc.rec * 100)}` : undefined} />
          <Kpi label="Sem categoria" value={String(calc.semCat)} tone={calc.semCat ? 'neg' : 'pos'} sub={calc.semCat ? <Link to="/lancamentos" className="text-brand underline">classificar agora</Link> : 'tudo classificado'} />
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-4 mb-4">
        <div className="card p-4"><div className="font-black mb-1">Gastos por grupo no período</div>{calc.top.length ? <BarrasHorizontais data={calc.top} color={SERIES[1]} /> : <div className="text-sm text-muted py-6">Sem despesas no período.</div>}</div>
        <div className="card p-4"><div className="font-black mb-1">Últimos 6 meses</div>{chart.length ? <ReceitaDespesaChart data={chart} /> : <div className="text-sm text-muted py-6">Sem histórico ainda.</div>}</div>
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <div className="card lg:col-span-2">
          <div className="px-4 py-3 border-b border-line font-black flex justify-between items-center">Últimos lançamentos <Link to="/lancamentos" className="text-sm text-brand font-bold flex items-center gap-1">ver todos <ArrowRight size={14} /></Link></div>
          {calc.ultimos.length ? <table className="tbl"><tbody>{calc.ultimos.map(l => <tr key={l.id}><td className="num whitespace-nowrap">{fmtDate(l.data)}</td><td><div className="font-bold">{l.descricao}</div><div className="text-xs text-muted">{(l as unknown as { contas?: { nome: string } }).contas?.nome ?? ''}</div></td><td className="text-right"><MoneyCell v={Number(l.valor)} tipo={l.tipo} /></td></tr>)}</tbody></table> : <div className="p-4 text-sm text-muted">Nenhum lançamento no período.</div>}
        </div>
        <div className="flex flex-col gap-4">
          <div className="card p-4">
            <div className="font-black mb-2 flex items-center justify-between">Próximas projeções <Link to="/projecoes" className="text-xs text-brand font-bold">ver</Link></div>
            {base.data?.proj.length ? <ul className="text-sm flex flex-col gap-1.5">{base.data.proj.slice(0, 6).map(p => <li key={p.id} className="flex justify-between gap-2"><span className="truncate">{p.descricao}<span className="text-muted text-xs"> · {p.data_prevista ? fmtDate(p.data_prevista) : mesLabel(p.competencia)}</span></span><MoneyCell v={Number(p.valor)} tipo={p.tipo} /></li>)}<li className="border-t border-line pt-1.5 flex justify-between font-bold"><span>Gastos previstos</span><span className="num text-neg">{brl(projTotal)}</span></li></ul> : <div className="text-sm text-muted">Nenhuma projeção cadastrada.</div>}
          </div>
          <div className="card p-4">
            <div className="font-black mb-2 flex items-center justify-between">Objetivos <Link to="/futuro" className="text-xs text-brand font-bold">ver</Link></div>
            {base.data?.metas.length ? <ul className="flex flex-col gap-2">{(base.data.metas as { id: string; nome: string; valor_alvo: number; valor_atual: number }[]).map(m => { const p = Number(m.valor_alvo) ? Math.min(100, Number(m.valor_atual) / Number(m.valor_alvo) * 100) : 0; return <li key={m.id}><div className="flex justify-between text-sm"><span className="font-bold truncate">{m.nome}</span><span className="num text-muted">{pct(p, 0)}</span></div><div className="h-1.5 rounded-full bg-surface overflow-hidden"><div className="h-full bg-brand" style={{ width: `${p}%` }} /></div></li> })}</ul> : <div className="text-sm text-muted">Nenhum objetivo definido.</div>}
          </div>
          {!base.data?.contas.length && !base.loading && <Empty title="Conecte seu banco" hint="Vá em Integrações para importar contas e extratos automaticamente." action={<Link to="/integracoes" className="btn btn-primary">Integrações</Link>} />}
          {!!calc.semCat && <div className="card p-3 text-sm flex gap-2 text-amber-800 bg-amber-50 border-amber-200"><AlertTriangle size={16} className="shrink-0 mt-0.5" /> {calc.semCat} lançamento(s) sem categoria no período afetam a precisão dos indicadores.</div>}
        </div>
      </div>
    </div>
  )
}
