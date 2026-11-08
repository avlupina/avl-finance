import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Sparkles, Copy, Plus, PiggyBank, ListChecks, Trash2 } from 'lucide-react'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid } from 'recharts'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useQuery } from '../hooks/useQuery'
import { useResumo } from '../hooks/useResumo'
import { ErrorBox, Field, Kpi, Loading, Modal, PageHeader, Tabs } from '../components/ui'
import { brl, brlCompact, competenciaISO, MESES, pct } from '../lib/format'
import type { Orcamento, PlanoConta } from '../lib/types'

type Tab = 'metas' | 'tabela'
const CORES = { renda: '#1baf7a', obrigatorias: '#2a78d6', nao_obrigatorias: '#eb6834', financiamentos: '#eda100', investimentos: '#6250d6', outros: '#94a3b8' }

/** Plano mensal: renda média × gastos médios por natureza, metas de gasto por categoria e orçamento detalhado. */
export default function Plano() {
  const { workspace, canEditModule, updateConfig } = useAuth()
  const ws = workspace!.id
  const podeEditar = canEditModule('plano')
  const resumo = useResumo()
  const hoje = new Date()
  const [ano, setAno] = useState(hoje.getFullYear())
  const [mes, setMes] = useState(hoje.getMonth() + 1)
  const comp = competenciaISO(ano, mes)
  const [tab, setTab] = useState<Tab>('metas')
  const [msg, setMsg] = useState<string | null>(null)
  const [modalMeta, setModalMeta] = useState<null | { plano_conta_id: string; valor: string }>(null)

  const q = useQuery(async () => {
    const fim = new Date(ano, mes, 0).toISOString().slice(0, 10)
    const [p, o, l] = await Promise.all([
      supabase.from('plano_contas').select('*').eq('workspace_id', ws).eq('ativo', true).order('codigo'),
      supabase.from('orcamentos').select('*').eq('workspace_id', ws).eq('competencia', comp),
      supabase.from('lancamentos').select('plano_conta_id, valor, tipo').eq('workspace_id', ws).gte('data', comp).lte('data', fim).neq('status', 'pendente').neq('tipo', 'transferencia').limit(30000),
    ])
    if (p.error) throw p.error
    const planos = p.data as PlanoConta[]; const pl = Object.fromEntries(planos.map(x => [x.id, x]))
    const real: Record<string, number> = {}
    for (const r of (l.data ?? []) as { plano_conta_id: string | null; valor: number; tipo: string }[]) {
      if (!r.plano_conta_id) continue; const pc = pl[r.plano_conta_id]; if (!pc) continue
      const sinal = (r.tipo === 'receita') === (pc.tipo === 'receita') ? 1 : -1
      real[r.plano_conta_id] = (real[r.plano_conta_id] ?? 0) + sinal * Number(r.valor)
    }
    return { planos, orc: Object.fromEntries(((o.data ?? []) as Orcamento[]).map(x => [x.plano_conta_id, Number(x.valor)])), real }
  }, [ws, comp])

  const media = resumo.r?.porPlanoMedia ?? {}
  const m = resumo.r?.media

  // gráfico renda × gastos por natureza (médias)
  const barras = useMemo(() => {
    if (!m) return []
    return [
      { nome: 'Renda', renda: Math.round(m.rec) },
      { nome: 'Gastos', obrigatorias: Math.round(m.fixas), nao_obrigatorias: Math.round(m.variaveis), financiamentos: Math.round(m.dividas), investimentos: Math.round(m.invest) },
    ]
  }, [m])

  const grupos = useMemo(() => (q.data?.planos ?? []).filter(p => !p.parent_id && p.tipo !== 'transferencia').map(g => ({ g, filhos: (q.data?.planos ?? []).filter(f => f.parent_id === g.id) })), [q.data])
  const metas = useMemo(() => grupos.flatMap(({ g, filhos }) => filhos.filter(f => g.tipo !== 'receita' && (q.data?.orc[f.id] ?? 0) > 0).map(f => ({ f, meta: q.data!.orc[f.id], real: q.data!.real[f.id] ?? 0, media: media[f.id] ?? 0 }))).sort((a, b) => b.meta - a.meta), [grupos, q.data, media])
  const economia = metas.reduce((a, x) => a + Math.max(0, x.media - x.meta), 0)
  const tot = useMemo(() => { const t = { recPlan: 0, recReal: 0, despPlan: 0, despReal: 0 }; for (const { g, filhos } of grupos) for (const f of filhos) { const plan = q.data?.orc[f.id] ?? 0, real = q.data?.real[f.id] ?? 0; if (g.tipo === 'receita') { t.recPlan += plan; t.recReal += real } else { t.despPlan += plan; t.despReal += real } } return t }, [grupos, q.data])
  const reservaMeses = (resumo.r?.config.reserva_meses ?? 6)
  const reservaIdeal = (m?.desp ?? 0) * reservaMeses

  const navMes = (d: number) => { const nd = new Date(ano, mes - 1 + d, 1); setAno(nd.getFullYear()); setMes(nd.getMonth() + 1) }
  const salvar = async (plano: string, valor: number) => { await supabase.from('orcamentos').upsert({ workspace_id: ws, plano_conta_id: plano, competencia: comp, valor }, { onConflict: 'workspace_id,plano_conta_id,competencia' }); q.refetch() }
  const remover = async (plano: string) => { await supabase.from('orcamentos').delete().eq('workspace_id', ws).eq('plano_conta_id', plano).eq('competencia', comp); q.refetch() }
  const preencherMedia = async () => {
    if (!confirm('Preencher o plano deste mês com a média dos 3 meses anteriores (apenas categorias ainda sem valor)?')) return
    const rows = grupos.flatMap(({ filhos }) => filhos).filter(f => !q.data?.orc[f.id] && (media[f.id] ?? 0) > 0).map(f => ({ workspace_id: ws, plano_conta_id: f.id, competencia: comp, valor: Math.round(media[f.id]) }))
    if (!rows.length) { setMsg('Nada a preencher.'); return }
    const { error } = await supabase.from('orcamentos').upsert(rows, { onConflict: 'workspace_id,plano_conta_id,competencia' })
    if (error) alert(error.message); else { setMsg(`${rows.length} categoria(s) preenchidas com a média.`); q.refetch() }
  }
  const copiarAnterior = async () => {
    const ant = new Date(ano, mes - 2, 1); const compAnt = competenciaISO(ant.getFullYear(), ant.getMonth() + 1)
    const { data } = await supabase.from('orcamentos').select('plano_conta_id, valor').eq('workspace_id', ws).eq('competencia', compAnt)
    const rows = ((data ?? []) as { plano_conta_id: string; valor: number }[]).filter(r => !q.data?.orc[r.plano_conta_id]).map(r => ({ workspace_id: ws, plano_conta_id: r.plano_conta_id, competencia: comp, valor: r.valor }))
    if (!rows.length) { setMsg('Nada a copiar do mês anterior.'); return }
    const { error } = await supabase.from('orcamentos').upsert(rows, { onConflict: 'workspace_id,plano_conta_id,competencia' })
    if (error) alert(error.message); else { setMsg(`${rows.length} categoria(s) copiadas.`); q.refetch() }
  }

  const saldoPlano = (m?.rec ?? 0) - (m?.desp ?? 0)
  const folhasDesp = grupos.filter(x => x.g.tipo !== 'receita').flatMap(x => x.filhos)

  return (
    <div>
      <PageHeader title="Plano" actions={<>
        <div className="flex items-center gap-1 card px-1 py-0.5">
          <button className="btn btn-ghost p-1.5" onClick={() => navMes(-1)}><ChevronLeft size={16} /></button>
          <span className="font-black w-28 text-center">{MESES[mes - 1]}/{ano}</span>
          <button className="btn btn-ghost p-1.5" onClick={() => navMes(1)}><ChevronRight size={16} /></button>
        </div>
        {podeEditar && <button className="btn" onClick={copiarAnterior}><Copy size={16} /> Copiar mês anterior</button>}
        {podeEditar && <button className="btn" onClick={preencherMedia}><Sparkles size={16} /> Preencher com média</button>}
        {podeEditar && <button className="btn btn-primary" onClick={() => setModalMeta({ plano_conta_id: '', valor: '' })}><Plus size={16} /> Nova meta de gasto</button>}
      </>} />

      <div className="grid grid-cols-3 gap-3 mb-5 max-w-3xl">
        <div><div className="text-xs text-muted font-bold uppercase">Renda média</div><div className="text-2xl font-black num text-pos">{brl(m?.rec ?? 0)}</div></div>
        <div><div className="text-xs text-muted font-bold uppercase">Gastos médios</div><div className="text-2xl font-black num text-neg">{brl(m?.desp ?? 0)}</div></div>
        <div><div className="text-xs text-muted font-bold uppercase">Saldo do plano</div><div className={`text-2xl font-black num ${saldoPlano < 0 ? 'text-neg' : 'text-brand'}`}>{saldoPlano < 0 ? '−' : ''}{brl(Math.abs(saldoPlano))}</div></div>
      </div>
      {msg && <div className="rounded-lg border border-green-200 bg-green-50 text-green-800 px-3 py-2 text-sm mb-3">{msg}</div>}

      <div className="grid lg:grid-cols-[1fr_1.1fr] gap-4 mb-4">
        <div className="card p-4">
          <div className="font-black mb-1">Renda × gastos (média dos últimos {m?.meses || 0} meses)</div>
          <ResponsiveContainer width="100%" height={340}>
            <BarChart data={barras} barCategoryGap={30} margin={{ left: 8, right: 8 }}>
              <CartesianGrid vertical={false} stroke="#eef1f4" />
              <XAxis dataKey="nome" tick={{ fontSize: 12, fontFamily: 'Overlock' }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={brlCompact} tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} width={70} />
              <Tooltip formatter={(v) => brl(Number(v))} contentStyle={{ borderRadius: 10, fontFamily: 'Overlock' }} cursor={{ fill: '#f1f5f9' }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="renda" name="Renda" stackId="a" fill={CORES.renda} />
              <Bar dataKey="obrigatorias" name="Despesas obrigatórias" stackId="a" fill={CORES.obrigatorias} />
              <Bar dataKey="nao_obrigatorias" name="Despesas não obrigatórias" stackId="a" fill={CORES.nao_obrigatorias} />
              <Bar dataKey="financiamentos" name="Financiamentos e dívidas" stackId="a" fill={CORES.financiamentos} />
              <Bar dataKey="investimentos" name="Investimentos" stackId="a" fill={CORES.investimentos} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
          <div className="mt-3 flex flex-col gap-2">
            <div className={`rounded-xl p-3 text-sm flex gap-3 ${saldoPlano < 0 ? 'bg-red-50' : 'bg-green-50'}`}><PiggyBank className={saldoPlano < 0 ? 'text-neg' : 'text-pos'} /><span>{saldoPlano < 0 ? <>Você gasta <b className="text-neg">{brl(-saldoPlano)} ({m?.rec ? pct(-saldoPlano / m.rec * 100) : '—'})</b> a mais do que ganha. Crie metas para otimizar seus gastos e começar a poupar.</> : <>Você poupa <b className="text-pos">{brl(saldoPlano)} ({m?.rec ? pct(saldoPlano / m.rec * 100) : '—'})</b> da sua renda em média.</>}</span></div>
            <div className="rounded-xl p-3 text-sm flex gap-3 bg-brand-soft items-center"><ListChecks className="text-brand" /><span className="flex-1">De acordo com seu padrão de vida atual, a reserva de emergência ideal é de <b className="text-brand">{brl(reservaIdeal)}</b> ({reservaMeses} meses de gastos).</span>{podeEditar && <select className="input w-24 py-1 text-xs" value={reservaMeses} onChange={e => updateConfig({ reserva_meses: Number(e.target.value) })}>{[3, 6, 9, 12].map(n => <option key={n} value={n}>{n} meses</option>)}</select>}</div>
          </div>
        </div>

        <div className="card p-4">
          <div className="flex items-start gap-3 rounded-xl bg-brand-soft/60 p-3 mb-4 text-sm"><ListChecks className="text-brand shrink-0" /><span>Ao cumprir suas metas, você economizará <b className="text-brand">{brl(economia)}</b> todos os meses, totalizando <b className="text-brand">{brl(economia * 12)}</b> no ano.</span></div>
          <Tabs tabs={[{ key: 'metas', label: 'Metas de gasto' }, { key: 'tabela', label: 'Orçamento completo' }]} value={tab} onChange={setTab} />
          {q.loading ? <Loading /> : q.error ? <ErrorBox msg={q.error} /> : tab === 'metas' ? (
            <div className="mt-4 flex flex-col gap-4">
              {!metas.length && <div className="text-sm text-muted">Nenhuma meta de gasto para {MESES[mes - 1]}. Clique em "Nova meta de gasto" ou "Preencher com média".</div>}
              {metas.map(({ f, meta, real, media: md }) => {
                const perc = Math.min(100, real / meta * 100); const estourou = real > meta
                return (
                  <div key={f.id} className="flex gap-3 items-start">
                    <div className="w-10 h-10 rounded-full bg-amber-50 text-amber-700 flex items-center justify-center font-black text-xs shrink-0">{f.codigo.split('.')[1]}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-baseline"><div className="font-bold">{f.nome}</div>{md > 0 && <div className="text-xs text-muted line-through num">{brl(md)}</div>}</div>
                      <div className="relative h-2 rounded-full bg-surface mt-1.5">
                        <div className={`h-full rounded-full ${estourou ? 'bg-neg' : 'bg-amber-600'}`} style={{ width: `${perc}%` }} />
                        {md > 0 && md > meta && <div className="absolute top-[-3px] w-0.5 h-3.5 bg-pos" style={{ left: `${Math.min(100, meta / md * 100)}%` }} title="meta" />}
                      </div>
                      <div className="flex justify-between text-xs mt-1"><span className="text-muted">Mês: <b className={estourou ? 'text-neg' : ''}>{brl(real)}</b> ({estourou ? 'excedeu ' + brl(real - meta) : 'restam ' + brl(meta - real)})</span><button disabled={!podeEditar} className="text-pos font-bold hover:underline" onClick={() => setModalMeta({ plano_conta_id: f.id, valor: String(meta) })}>Meta: {brl(meta)}</button></div>
                    </div>
                    {podeEditar && <button className="btn btn-ghost p-1 text-muted" title="Remover meta" onClick={() => remover(f.id)}><Trash2 size={14} /></button>}
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <div className="grid grid-cols-2 gap-3 mb-3">
                <Kpi label="Receita planejada" value={brl(tot.recPlan)} tone="pos" sub={`realizado ${brl(tot.recReal)}`} />
                <Kpi label="Gastos planejados" value={brl(tot.despPlan)} tone="neg" sub={`realizado ${brl(tot.despReal)} (${tot.despPlan ? pct(tot.despReal / tot.despPlan * 100, 0) : '—'})`} />
              </div>
              {grupos.map(({ g, filhos }) => (
                <table key={g.id} className="tbl mb-3">
                  <thead><tr><th>{g.codigo} {g.nome}</th><th className="text-right w-28">Média 3m</th><th className="text-right w-28">Planejado</th><th className="text-right w-28">Realizado</th></tr></thead>
                  <tbody>{filhos.map(f => { const p = q.data?.orc[f.id] ?? 0, r = q.data?.real[f.id] ?? 0, md = media[f.id] ?? 0; if (!p && !r && !md) return null; return <tr key={f.id}><td>{f.nome}</td><td className="text-right num text-muted">{md ? brl(md) : '·'}</td><td className="text-right"><PlanCell value={p} editable={podeEditar} onSave={v => salvar(f.id, v)} /></td><td className={`text-right num font-bold ${g.tipo !== 'receita' && p && r > p ? 'text-neg' : ''}`}>{r ? brl(r) : '·'}</td></tr> })}</tbody>
                </table>
              ))}
            </div>
          )}
        </div>
      </div>

      <Modal open={!!modalMeta} onClose={() => setModalMeta(null)} title="Meta de gasto">
        {modalMeta && <form onSubmit={async e => { e.preventDefault(); const v = Number(modalMeta.valor.replace(/\./g, '').replace(',', '.')); if (!modalMeta.plano_conta_id || !v) return; await salvar(modalMeta.plano_conta_id, v); setModalMeta(null) }} className="flex flex-col gap-3">
          <Field label="Categoria"><select className="input" required value={modalMeta.plano_conta_id} onChange={e => setModalMeta({ ...modalMeta, plano_conta_id: e.target.value, valor: modalMeta.valor || (media[e.target.value] ? String(Math.round(media[e.target.value])) : '') })}><option value="">—</option>{folhasDesp.map(f => <option key={f.id} value={f.id}>{f.codigo} {f.nome}{media[f.id] ? ` (média ${brl(media[f.id])})` : ''}</option>)}</select></Field>
          <Field label="Meta mensal (R$)"><input className="input num" required value={modalMeta.valor} onChange={e => setModalMeta({ ...modalMeta, valor: e.target.value })} /></Field>
          <div className="flex justify-end gap-2"><button type="button" className="btn" onClick={() => setModalMeta(null)}>Cancelar</button><button className="btn btn-primary">Salvar</button></div>
        </form>}
      </Modal>
    </div>
  )
}

function PlanCell({ value, editable, onSave }: { value: number; editable: boolean; onSave: (v: number) => void }) {
  const [edit, setEdit] = useState(false); const [v, setV] = useState('')
  if (edit) return <input autoFocus className="input py-0.5 px-1 w-28 text-right num text-sm" value={v} onChange={e => setV(e.target.value)} onBlur={() => { setEdit(false); const n = Number(v.replace(/\./g, '').replace(',', '.')); if (!isNaN(n) && n !== value) onSave(n) }} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEdit(false) }} />
  return <button type="button" disabled={!editable} onClick={() => { setV(value ? String(value) : ''); setEdit(true) }} className={`num ${value ? 'font-bold' : 'text-muted/60'} ${editable ? 'hover:text-brand hover:underline' : ''}`}>{value ? brl(value) : 'definir'}</button>
}
