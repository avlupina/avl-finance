import { useMemo, useState } from 'react'
import { Download, Printer } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useQuery } from '../hooks/useQuery'
import { Empty, ErrorBox, Kpi, Loading, PageHeader, Tabs } from '../components/ui'
import { ReceitaDespesaChart } from '../components/charts'
import { brl, competenciaISO, downloadCSV, MESES, pct } from '../lib/format'
import type { Lancamento, Orcamento, PlanoConta } from '../lib/types'

type Tab = 'dre' | 'mensal' | 'orcado'

export default function Resultados() {
  const { workspace, canEditModule } = useAuth()
  const ws = workspace!.id
  const podeEditar = canEditModule('resultados')
  const [ano, setAno] = useState(new Date().getFullYear())
  const [tab, setTab] = useState<Tab>('dre')

  const q = useQuery(async () => {
    const [l, p, o] = await Promise.all([
      supabase.from('lancamentos').select('id, data, competencia, valor, tipo, status, plano_conta_id').eq('workspace_id', ws).gte('data', `${ano}-01-01`).lte('data', `${ano}-12-31`).neq('status', 'pendente').limit(20000),
      supabase.from('plano_contas').select('*').eq('workspace_id', ws).order('codigo'),
      supabase.from('orcamentos').select('*').eq('workspace_id', ws).gte('competencia', `${ano}-01-01`).lte('competencia', `${ano}-12-31`),
    ])
    if (l.error) throw l.error
    return { lanc: l.data as Lancamento[], planos: (p.data ?? []) as PlanoConta[], orc: (o.data ?? []) as Orcamento[] }
  }, [ws, ano])

  // matriz plano x mês
  const m = useMemo(() => {
    const lanc = q.data?.lanc ?? []; const planos = q.data?.planos ?? []
    const byPlano: Record<string, number[]> = {}
    const semCat: Record<string, number[]> = { receita: Array(12).fill(0), despesa: Array(12).fill(0) }
    const tot = { receitas: Array(12).fill(0), despesas: Array(12).fill(0) }
    const planoDe = Object.fromEntries(planos.map(p => [p.id, p]))
    for (const l of lanc) {
      if (l.tipo === 'transferencia') continue
      const mi = Number(l.competencia.slice(5, 7)) - 1
      const v = Number(l.valor)
      const p = l.plano_conta_id ? planoDe[l.plano_conta_id] : undefined
      if (!p) { if (l.tipo === 'receita') tot.receitas[mi] += v; else tot.despesas[mi] += v; semCat[l.tipo][mi] += v; continue }
      // sinal relativo à natureza da conta do plano: estorno (receita) numa conta de despesa abate a despesa
      const contaReceita = p.tipo === 'receita'
      const sinal = (l.tipo === 'receita') === contaReceita ? 1 : -1
      if (contaReceita) tot.receitas[mi] += sinal * v; else tot.despesas[mi] += sinal * v
      ;(byPlano[p.id] ??= Array(12).fill(0))[mi] += sinal * v
    }
    const parentOf = Object.fromEntries(planos.map(p => [p.id, p.parent_id]))
    const byGrupo: Record<string, number[]> = {}
    for (const [pid, arr] of Object.entries(byPlano)) { const g = parentOf[pid] ?? pid; byGrupo[g] ??= Array(12).fill(0); arr.forEach((v, i) => byGrupo[g][i] += v) }
    const orc: Record<string, number[]> = {}
    for (const o of q.data?.orc ?? []) { (orc[o.plano_conta_id] ??= Array(12).fill(0))[Number(o.competencia.slice(5, 7)) - 1] = Number(o.valor) }
    return { byPlano, byGrupo, semCat, tot, orc }
  }, [q.data])

  const sum = (a: number[]) => a.reduce((x, y) => x + y, 0)
  const mesesComDados = m.tot.receitas.map((r, i) => r + m.tot.despesas[i] > 0).lastIndexOf(true) + 1
  const totR = sum(m.tot.receitas), totD = sum(m.tot.despesas)
  const chart = MESES.map((mes, i) => ({ mes, receitas: m.tot.receitas[i], despesas: m.tot.despesas[i], resultado: m.tot.receitas[i] - m.tot.despesas[i] }))
  const planos = q.data?.planos ?? []
  const raizes = planos.filter(p => !p.parent_id && p.tipo !== 'transferencia')

  const exportar = () => {
    const rows: Record<string, unknown>[] = []
    for (const r of raizes) for (const f of planos.filter(p => p.parent_id === r.id)) {
      const arr = m.byPlano[f.id] ?? Array(12).fill(0)
      rows.push({ grupo: r.nome, codigo: f.codigo, conta: f.nome, ...Object.fromEntries(MESES.map((mm, i) => [mm, arr[i].toFixed(2).replace('.', ',')])), total: sum(arr).toFixed(2).replace('.', ',') })
    }
    downloadCSV(`dre_${ano}.csv`, rows)
  }

  const salvarOrc = async (plano: string, mes: number, valor: number) => {
    await supabase.from('orcamentos').upsert({ workspace_id: ws, plano_conta_id: plano, competencia: competenciaISO(ano, mes + 1), valor }, { onConflict: 'workspace_id,plano_conta_id,competencia' })
    q.refetch()
  }

  return (
    <div>
      <PageHeader title="Resultados" actions={<>
        <select className="input w-28" value={ano} onChange={e => setAno(Number(e.target.value))}>{[0, 1, 2, 3].map(d => { const y = new Date().getFullYear() - d; return <option key={y} value={y}>{y}</option> })}</select>
        <button className="btn" onClick={exportar}><Download size={16} /> Exportar</button>
        <button className="btn" onClick={() => window.print()}><Printer size={16} /> Imprimir</button>
      </>}>
        <Tabs tabs={[{ key: 'dre', label: 'DRE Pessoal' }, { key: 'mensal', label: 'Evolução Mensal' }, { key: 'orcado', label: 'Orçado x Realizado' }]} value={tab} onChange={setTab} />
      </PageHeader>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <Kpi label={`Receitas ${ano}`} value={brl(totR)} tone="pos" />
        <Kpi label={`Despesas ${ano}`} value={brl(totD)} tone="neg" />
        <Kpi label="Resultado" value={brl(totR - totD)} tone={totR - totD >= 0 ? 'brand' : 'neg'} sub={totR ? `Taxa de poupança ${pct(((totR - totD) / totR) * 100)}` : undefined} />
        <Kpi label="Média mensal de despesas" value={brl(mesesComDados ? totD / mesesComDados : 0)} sub={`${mesesComDados} mês(es) com dados`} />
      </div>

      {q.loading ? <Loading /> : q.error ? <ErrorBox msg={q.error} /> : !q.data?.lanc.length ? <Empty title={`Sem lançamentos em ${ano}`} hint="Os resultados são calculados a partir dos lançamentos efetivados e categorizados." /> : (
        <>
          {tab === 'mensal' && <div className="card p-4"><div className="font-black mb-2">Receitas x Despesas por mês</div><ReceitaDespesaChart data={chart} /></div>}

          {tab === 'dre' && (
            <div className="card overflow-x-auto">
              <table className="tbl text-xs">
                <thead><tr><th className="min-w-[220px]">Conta</th>{MESES.map(mm => <th key={mm} className="text-right">{mm}</th>)}<th className="text-right">Total</th><th className="text-right">%</th></tr></thead>
                <tbody>
                  {raizes.map(r => {
                    const filhos = planos.filter(p => p.parent_id === r.id)
                    const gArr = m.byGrupo[r.id] ?? Array(12).fill(0)
                    const base = r.tipo === 'receita' ? totR : totD
                    return [
                      <tr key={r.id} className="bg-surface/70 font-black"><td>{r.codigo} {r.nome}</td>{gArr.map((v, i) => <td key={i} className="text-right num">{v ? brl(v, { maximumFractionDigits: 0 }) : '·'}</td>)}<td className="text-right num">{brl(sum(gArr), { maximumFractionDigits: 0 })}</td><td className="text-right num text-muted">{base ? pct(sum(gArr) / base * 100, 0) : '—'}</td></tr>,
                      ...filhos.map(f => { const arr = m.byPlano[f.id] ?? Array(12).fill(0); if (!sum(arr)) return null; return <tr key={f.id}><td className="pl-6 text-ink/80">{f.codigo} {f.nome}</td>{arr.map((v, i) => <td key={i} className="text-right num text-ink/80">{v ? brl(v, { maximumFractionDigits: 0 }) : '·'}</td>)}<td className="text-right num font-bold">{brl(sum(arr), { maximumFractionDigits: 0 })}</td><td className="text-right num text-muted">{base ? pct(sum(arr) / base * 100, 0) : '—'}</td></tr> }),
                    ]
                  })}
                  {(sum(m.semCat.receita) > 0 || sum(m.semCat.despesa) > 0) && <tr className="text-amber-800"><td className="pl-6">Sem categoria (receitas − despesas)</td>{MESES.map((_, i) => <td key={i} className="text-right num">{brl(m.semCat.receita[i] - m.semCat.despesa[i], { maximumFractionDigits: 0 })}</td>)}<td className="text-right num font-bold">{brl(sum(m.semCat.receita) - sum(m.semCat.despesa), { maximumFractionDigits: 0 })}</td><td></td></tr>}
                  <tr className="bg-brand-soft font-black text-brand"><td>Resultado do período</td>{MESES.map((_, i) => { const v = m.tot.receitas[i] - m.tot.despesas[i]; return <td key={i} className={`text-right num ${v < 0 ? 'text-neg' : ''}`}>{brl(v, { maximumFractionDigits: 0 })}</td> })}<td className={`text-right num ${totR - totD < 0 ? 'text-neg' : ''}`}>{brl(totR - totD, { maximumFractionDigits: 0 })}</td><td className="text-right num">{totR ? pct((totR - totD) / totR * 100, 0) : '—'}</td></tr>
                </tbody>
              </table>
            </div>
          )}

          {tab === 'orcado' && (
            <div className="card overflow-x-auto">
              <div className="px-4 py-3 border-b border-line text-sm text-muted">Defina o orçamento mensal por categoria de despesa{podeEditar ? ' (clique no valor orçado para editar)' : ''}. Realizado considera lançamentos efetivados/conciliados.</div>
              <table className="tbl text-xs">
                <thead><tr><th className="min-w-[200px]">Categoria</th>{MESES.map(mm => <th key={mm} className="text-right min-w-[88px]">{mm}</th>)}<th className="text-right">Orçado</th><th className="text-right">Realizado</th><th className="text-right">Desvio</th></tr></thead>
                <tbody>
                  {planos.filter(p => p.parent_id && p.tipo === 'despesa' && p.ativo).map(f => {
                    const real = m.byPlano[f.id] ?? Array(12).fill(0); const orc = m.orc[f.id] ?? Array(12).fill(0)
                    const tO = sum(orc), tR = sum(real)
                    return <tr key={f.id}>
                      <td className="font-bold">{f.codigo} {f.nome}</td>
                      {MESES.map((_, i) => <td key={i} className="text-right">
                        <OrcCell orc={orc[i]} real={real[i]} editable={podeEditar} onSave={v => salvarOrc(f.id, i, v)} />
                      </td>)}
                      <td className="text-right num">{brl(tO, { maximumFractionDigits: 0 })}</td>
                      <td className="text-right num font-bold">{brl(tR, { maximumFractionDigits: 0 })}</td>
                      <td className={`text-right num font-bold ${tR > tO && tO ? 'text-neg' : 'text-pos'}`}>{tO ? pct((tR - tO) / tO * 100, 0) : '—'}</td>
                    </tr>
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function OrcCell({ orc, real, editable, onSave }: { orc: number; real: number; editable: boolean; onSave: (v: number) => void }) {
  const [edit, setEdit] = useState(false); const [v, setV] = useState(String(orc || ''))
  const over = orc > 0 && real > orc
  if (edit) return <input autoFocus className="input py-0.5 px-1 w-20 text-right num text-xs" value={v} onChange={e => setV(e.target.value)} onBlur={() => { setEdit(false); const n = Number(v.replace(',', '.')); if (!isNaN(n) && n !== orc) onSave(n) }} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
  return (
    <div className="flex flex-col items-end leading-tight">
      <button type="button" disabled={!editable} onClick={() => { setV(String(orc || '')); setEdit(true) }} className={`num text-muted ${editable ? 'hover:text-brand hover:underline' : ''}`}>{orc ? brl(orc, { maximumFractionDigits: 0 }) : <span className="opacity-50">orçar</span>}</button>
      <span className={`num font-bold ${over ? 'text-neg' : real ? 'text-ink' : 'text-muted/50'}`}>{real ? brl(real, { maximumFractionDigits: 0 }) : '·'}</span>
    </div>
  )
}
