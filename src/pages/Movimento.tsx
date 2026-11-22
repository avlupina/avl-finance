import { useMemo, useState } from 'react'
import { Download } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { useQuery } from '../hooks/useQuery'
import { Badge, Empty, ErrorBox, Kpi, Loading, PageHeader, Tabs } from '../components/ui'
import { brl, downloadCSV, fmtDate, todayISO } from '../lib/format'
import { addDias, iso, carregarFluxoRealizado, calcularFluxoRealizado, type DiaFluxo } from '../lib/fluxo'

type Periodo = '7' | '15' | '30' | '60' | '90' | 'custom'

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

  const q = useQuery(() => carregarFluxoRealizado(ws, ini, fim), [ws, ini, fim])

  const m = useMemo(() => q.data ? calcularFluxoRealizado(q.data, ini, fim, ocultarInternas) : null, [q.data, ocultarInternas, ini, fim])

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

function FragmentDia({ d, ocultarInternas }: { d: DiaFluxo; ocultarInternas: boolean }) {
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
