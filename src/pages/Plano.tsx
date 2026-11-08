import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Sparkles, Copy } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useQuery } from '../hooks/useQuery'
import { ErrorBox, Kpi, Loading, PageHeader } from '../components/ui'
import { brl, competenciaISO, MESES, pct } from '../lib/format'
import type { Orcamento, PlanoConta } from '../lib/types'

/** Plano mensal: quanto pretendo receber e gastar em cada categoria, comparado ao realizado. */
export default function Plano() {
  const { workspace, canEditModule } = useAuth()
  const ws = workspace!.id
  const podeEditar = canEditModule('plano')
  const hoje = new Date()
  const [ano, setAno] = useState(hoje.getFullYear())
  const [mes, setMes] = useState(hoje.getMonth() + 1)
  const comp = competenciaISO(ano, mes)
  const [msg, setMsg] = useState<string | null>(null)

  const q = useQuery(async () => {
    const fim = new Date(ano, mes, 0).toISOString().slice(0, 10)
    const ini3 = new Date(ano, mes - 4, 1).toISOString().slice(0, 10)
    const [p, o, l] = await Promise.all([
      supabase.from('plano_contas').select('*').eq('workspace_id', ws).eq('ativo', true).order('codigo'),
      supabase.from('orcamentos').select('*').eq('workspace_id', ws).eq('competencia', comp),
      supabase.from('lancamentos').select('plano_conta_id, valor, tipo, competencia').eq('workspace_id', ws).gte('data', ini3).lte('data', fim).neq('status', 'pendente').neq('tipo', 'transferencia').limit(30000),
    ])
    if (p.error) throw p.error
    const planos = p.data as PlanoConta[]
    const pl = Object.fromEntries(planos.map(x => [x.id, x]))
    const real: Record<string, number> = {}; const media: Record<string, number> = {}
    for (const r of (l.data ?? []) as { plano_conta_id: string | null; valor: number; tipo: string; competencia: string }[]) {
      if (!r.plano_conta_id) continue
      const pc = pl[r.plano_conta_id]; if (!pc) continue
      const sinal = (r.tipo === 'receita') === (pc.tipo === 'receita') ? 1 : -1
      const v = sinal * Number(r.valor)
      if (r.competencia.slice(0, 10) === comp) real[r.plano_conta_id] = (real[r.plano_conta_id] ?? 0) + v
      else media[r.plano_conta_id] = (media[r.plano_conta_id] ?? 0) + v / 3
    }
    return { planos, orc: Object.fromEntries(((o.data ?? []) as Orcamento[]).map(x => [x.plano_conta_id, Number(x.valor)])), real, media }
  }, [ws, comp])

  const grupos = useMemo(() => {
    const planos = q.data?.planos ?? []
    return planos.filter(p => !p.parent_id && p.tipo !== 'transferencia').map(g => ({ g, filhos: planos.filter(f => f.parent_id === g.id) }))
  }, [q.data])

  const tot = useMemo(() => {
    const t = { recPlan: 0, recReal: 0, despPlan: 0, despReal: 0 }
    for (const { g, filhos } of grupos) for (const f of filhos) {
      const plan = q.data?.orc[f.id] ?? 0, real = q.data?.real[f.id] ?? 0
      if (g.tipo === 'receita') { t.recPlan += plan; t.recReal += real } else { t.despPlan += plan; t.despReal += real }
    }
    return t
  }, [grupos, q.data])

  const navMes = (d: number) => { const nd = new Date(ano, mes - 1 + d, 1); setAno(nd.getFullYear()); setMes(nd.getMonth() + 1) }
  const salvar = async (plano: string, valor: number) => {
    await supabase.from('orcamentos').upsert({ workspace_id: ws, plano_conta_id: plano, competencia: comp, valor }, { onConflict: 'workspace_id,plano_conta_id,competencia' }); q.refetch()
  }
  const preencherMedia = async () => {
    if (!confirm('Preencher o plano deste mês com a média dos 3 meses anteriores (apenas categorias ainda sem valor)?')) return
    const rows = grupos.flatMap(({ filhos }) => filhos).filter(f => !q.data?.orc[f.id] && (q.data?.media[f.id] ?? 0) > 0).map(f => ({ workspace_id: ws, plano_conta_id: f.id, competencia: comp, valor: Math.round(q.data!.media[f.id]) }))
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

  const sobraPlan = tot.recPlan - tot.despPlan, sobraReal = tot.recReal - tot.despReal

  return (
    <div>
      <PageHeader title="Plano" actions={<>
        <div className="flex items-center gap-1 card px-1 py-0.5">
          <button className="btn btn-ghost p-1.5" onClick={() => navMes(-1)}><ChevronLeft size={16} /></button>
          <span className="font-black w-28 text-center">{MESES[mes - 1]}/{ano}</span>
          <button className="btn btn-ghost p-1.5" onClick={() => navMes(1)}><ChevronRight size={16} /></button>
        </div>
        {podeEditar && <button className="btn" onClick={copiarAnterior}><Copy size={16} /> Copiar mês anterior</button>}
        {podeEditar && <button className="btn btn-primary" onClick={preencherMedia}><Sparkles size={16} /> Preencher com média 3 meses</button>}
      </>}>
        <p className="text-sm text-muted">Defina quanto pretende receber e gastar por categoria neste mês. O realizado é atualizado com os lançamentos; categorias acima do planejado ficam em vermelho.</p>
      </PageHeader>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <Kpi label="Receita planejada" value={brl(tot.recPlan)} tone="pos" sub={`realizado ${brl(tot.recReal)}`} />
        <Kpi label="Gastos planejados" value={brl(tot.despPlan)} tone="neg" sub={`realizado ${brl(tot.despReal)} (${tot.despPlan ? pct(tot.despReal / tot.despPlan * 100, 0) : '—'})`} />
        <Kpi label="Sobra planejada" value={brl(sobraPlan)} tone={sobraPlan >= 0 ? 'brand' : 'neg'} sub={tot.recPlan ? `${pct(sobraPlan / tot.recPlan * 100, 0)} da receita` : undefined} />
        <Kpi label="Sobra realizada" value={brl(sobraReal)} tone={sobraReal >= 0 ? 'pos' : 'neg'} sub="até agora no mês" />
      </div>
      {msg && <div className="rounded-lg border border-green-200 bg-green-50 text-green-800 px-3 py-2 text-sm mb-3">{msg}</div>}

      {q.loading ? <Loading /> : q.error ? <ErrorBox msg={q.error} /> : (
        <div className="grid lg:grid-cols-2 gap-4 items-start">
          {grupos.map(({ g, filhos }) => {
            const plan = filhos.reduce((a, f) => a + (q.data?.orc[f.id] ?? 0), 0), real = filhos.reduce((a, f) => a + (q.data?.real[f.id] ?? 0), 0)
            return (
              <div key={g.id} className="card">
                <div className="px-4 py-3 border-b border-line bg-surface/60 rounded-t-xl flex items-center justify-between">
                  <div className="font-black">{g.codigo} {g.nome}</div>
                  <div className="text-xs text-muted num">plan. <b>{brl(plan)}</b> · real. <b className={g.tipo !== 'receita' && real > plan && plan ? 'text-neg' : ''}>{brl(real)}</b></div>
                </div>
                <table className="tbl">
                  <thead><tr><th>Categoria</th><th className="text-right w-32">Planejado</th><th className="text-right w-28">Realizado</th><th className="w-36">Execução</th></tr></thead>
                  <tbody>{filhos.map(f => {
                    const p = q.data?.orc[f.id] ?? 0, r = q.data?.real[f.id] ?? 0, m = q.data?.media[f.id] ?? 0
                    const perc = p ? Math.min(150, r / p * 100) : 0
                    const estourou = g.tipo !== 'receita' && p > 0 && r > p
                    if (!p && !r && !m) return null
                    return <tr key={f.id}>
                      <td><div className="font-bold">{f.nome}</div>{m > 0 && <div className="text-[11px] text-muted">média 3m {brl(m)}</div>}</td>
                      <td className="text-right"><PlanCell value={p} editable={podeEditar} onSave={v => salvar(f.id, v)} /></td>
                      <td className={`text-right num font-bold ${estourou ? 'text-neg' : ''}`}>{r ? brl(r) : <span className="text-muted/50">·</span>}</td>
                      <td><div className="flex items-center gap-2"><div className="h-2 flex-1 rounded-full bg-surface overflow-hidden"><div className={`h-full ${estourou ? 'bg-neg' : g.tipo === 'receita' ? 'bg-pos' : 'bg-brand'}`} style={{ width: `${Math.min(100, perc)}%` }} /></div><span className="text-xs num text-muted w-10 text-right">{p ? pct(r / p * 100, 0) : '—'}</span></div></td>
                    </tr>
                  })}</tbody>
                </table>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function PlanCell({ value, editable, onSave }: { value: number; editable: boolean; onSave: (v: number) => void }) {
  const [edit, setEdit] = useState(false); const [v, setV] = useState('')
  if (edit) return <input autoFocus className="input py-0.5 px-1 w-28 text-right num text-sm" value={v} onChange={e => setV(e.target.value)} onBlur={() => { setEdit(false); const n = Number(v.replace(/\./g, '').replace(',', '.')); if (!isNaN(n) && n !== value) onSave(n) }} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEdit(false) }} />
  return <button type="button" disabled={!editable} onClick={() => { setV(value ? String(value) : ''); setEdit(true) }} className={`num ${value ? 'font-bold' : 'text-muted/60'} ${editable ? 'hover:text-brand hover:underline' : ''}`}>{value ? brl(value) : 'definir'}</button>
}
