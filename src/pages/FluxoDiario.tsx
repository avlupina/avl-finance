import { useMemo, useState } from 'react'
import { Download } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { useQuery } from '../hooks/useQuery'
import { Empty, ErrorBox, Kpi, Loading, PageHeader, Tabs } from '../components/ui'
import { brl, downloadCSV, fmtDate, todayISO } from '../lib/format'
import { addDias, iso, carregarFluxoRealizado, calcularFluxoRealizado } from '../lib/fluxo'

type Periodo = '15' | '30' | '60' | '90' | 'custom'

/** Fluxo Diário: saldo inicial, entradas, saídas, saldo final e resultado de cada dia (lançamentos efetivados nas contas, exceto cartões). */
export default function FluxoDiario() {
  const { workspace } = useAuth()
  const ws = workspace!.id
  const [p, setP] = useState<Periodo>('30')
  const [custom, setCustom] = useState(() => { const t = new Date(todayISO() + 'T12:00:00'); return { ini: iso(new Date(t.getFullYear(), t.getMonth(), 1, 12)), fim: iso(t) } })
  const hoje = new Date(todayISO() + 'T12:00:00')
  const ini = p === 'custom' ? custom.ini : iso(addDias(hoje, -(Number(p) - 1)))
  const fim = p === 'custom' ? custom.fim : iso(hoje)

  const q = useQuery(() => carregarFluxoRealizado(ws, ini, fim), [ws, ini, fim])
  const m = useMemo(() => q.data ? calcularFluxoRealizado(q.data, ini, fim, true, true) : null, [q.data, ini, fim])

  const exportar = () => { if (!m) return; downloadCSV(`fluxo_diario_${ini}_${fim}.csv`, m.dias.map(d => ({ data: d.data, saldo_inicial: d.saldoInicial, entradas: d.entradas, saidas: d.saidas, saldo_final: d.saldoFinal, resultado: d.entradas - d.saidas }))) }

  return (
    <div>
      <PageHeader crumb="Visão" title="Fluxo Diário" actions={<>
        <Tabs tabs={[{ key: '15', label: '15 dias' }, { key: '30', label: '30 dias' }, { key: '60', label: '60 dias' }, { key: '90', label: '90 dias' }, { key: 'custom', label: 'Período' }]} value={p} onChange={setP} />
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
        {!m.dias.length ? <Empty title="Sem dias no período" /> : (
          <div className="card overflow-hidden">
            <table className="tbl">
              <thead><tr><th>Data</th><th className="text-right">Saldo inicial</th><th className="text-right">Entradas</th><th className="text-right">Saídas</th><th className="text-right">Saldo final</th><th className="text-right">Resultado do dia</th></tr></thead>
              <tbody>
                {m.dias.map(d => { const res = d.entradas - d.saidas; const semMov = !d.linhas.length; return (
                  <tr key={d.data} className={semMov ? 'text-muted' : ''}>
                    <td className="num whitespace-nowrap">{fmtDate(d.data)} <span className="text-[11px] text-muted ml-1">{new Date(d.data + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'short' })}</span></td>
                    <td className="text-right num">{brl(d.saldoInicial)}</td>
                    <td className="text-right num text-pos">{d.entradas ? brl(d.entradas) : <span className="text-muted">—</span>}</td>
                    <td className="text-right num text-neg">{d.saidas ? brl(d.saidas) : <span className="text-muted">—</span>}</td>
                    <td className={`text-right num font-bold ${d.saldoFinal < 0 ? 'text-neg' : ''}`}>{brl(d.saldoFinal)}</td>
                    <td className={`text-right num ${res > 0 ? 'text-pos' : res < 0 ? 'text-neg' : 'text-muted'}`}>{semMov ? '—' : brl(res)}</td>
                  </tr>) })}
                <tr className="bg-surface/60 font-bold"><td>Total do período</td><td className="text-right num">{brl(m.saldoInicial)}</td><td className="text-right num text-pos">{brl(m.entradas)}</td><td className="text-right num text-neg">{brl(m.saidas)}</td><td className="text-right num">{brl(m.saldoFinal)}</td><td className={`text-right num ${m.entradas - m.saidas >= 0 ? 'text-pos' : 'text-neg'}`}>{brl(m.entradas - m.saidas)}</td></tr>
              </tbody>
            </table>
          </div>
        )}
      </>)}
    </div>
  )
}
