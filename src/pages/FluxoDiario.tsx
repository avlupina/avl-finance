import { useMemo, useState } from 'react'
import { Download } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { useQuery } from '../hooks/useQuery'
import { Empty, ErrorBox, Kpi, Loading, PageHeader, Tabs } from '../components/ui'
import { brl, downloadCSV, fmtDate, todayISO } from '../lib/format'
import { addDias, iso, dataLocal, carregarFluxoRealizado, calcularFluxoRealizado, carregarAgenda, calcularItensProjetados } from '../lib/fluxo'

type Periodo = '15' | '30' | '60' | '90' | 'custom'

/**
 * Fluxo Diário (contínuo): dia a dia, saldo inicial, entradas, saídas, saldo final e resultado.
 * Dias até hoje usam o realizado (lançamentos efetivados nas contas); dias a partir de hoje usam o projetado
 * (faturas de cartão por ciclo, compromissos da Agenda e Projeções previstas). O saldo é carregado de um dia para o outro.
 */
export default function FluxoDiario() {
  const { workspace } = useAuth()
  const ws = workspace!.id
  const [p, setP] = useState<Periodo>('30')
  const hojeISO = todayISO()
  const hoje = dataLocal(hojeISO)
  const [custom, setCustom] = useState(() => ({ ini: hojeISO, fim: iso(new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0, 12)) }))
  const ini = p === 'custom' ? custom.ini : hojeISO
  const fim = p === 'custom' ? custom.fim : iso(addDias(hoje, Number(p)))

  const q = useQuery(async () => {
    const [real, proj] = await Promise.all([
      carregarFluxoRealizado(ws, ini < hojeISO ? ini : hojeISO, hojeISO),
      fim >= hojeISO ? carregarAgenda(ws, hoje, dataLocal(fim), true) : Promise.resolve(null),
    ])
    return { real, proj }
  }, [ws, ini, fim])

  const m = useMemo(() => {
    const d = q.data; if (!d) return null
    const real = calcularFluxoRealizado(d.real, ini < hojeISO ? ini : hojeISO, hojeISO, true, true)
    const realPorDia = new Map(real.dias.map(x => [x.data, x]))
    const itens = d.proj ? calcularItensProjetados(d.proj, hoje, hoje, dataLocal(fim)).filter(i => !i.concluido && i.tipo !== 'transferencia') : []
    const projPorDia = new Map<string, { entradas: number; saidas: number; n: number; titulos: string[] }>()
    for (const i of itens) { const x = projPorDia.get(i.data) ?? { entradas: 0, saidas: 0, n: 0, titulos: [] }; if (i.tipo === 'receita') x.entradas += i.valor; else x.saidas += i.valor; x.n++; x.titulos.push(`${i.titulo}${i.atrasadoDesde ? ' (atrasado)' : ''}`); projPorDia.set(i.data, x) }
    // Saldo de partida: realizado no início do período ou, se o período começa no futuro, saldo de hoje + projetado até a véspera.
    let saldo = ini <= hojeISO ? real.saldoInicial : real.saldoFinal
    if (ini > hojeISO) for (const [data, x] of projPorDia) if (data < ini) saldo += x.entradas - x.saidas
    const dias: { data: string; saldoInicial: number; entradas: number; saidas: number; saldoFinal: number; n: number; projetado: boolean; titulos: string[] }[] = []
    for (let dt = dataLocal(ini); iso(dt) <= fim; dt = addDias(dt, 1)) {
      const k = iso(dt)
      const r = k <= hojeISO ? realPorDia.get(k) : undefined
      const pj = k >= hojeISO ? projPorDia.get(k) : undefined
      const entradas = (r?.entradas ?? 0) + (pj?.entradas ?? 0), saidas = (r?.saidas ?? 0) + (pj?.saidas ?? 0)
      const saldoInicial = saldo; saldo += entradas - saidas
      dias.push({ data: k, saldoInicial, entradas, saidas, saldoFinal: saldo, n: (r?.linhas.length ?? 0) + (pj?.n ?? 0), projetado: k > hojeISO, titulos: pj?.titulos ?? [] })
    }
    const entradas = dias.reduce((a, x) => a + x.entradas, 0), saidas = dias.reduce((a, x) => a + x.saidas, 0)
    const minimo = dias.reduce((a, x) => x.saldoFinal < a.saldoFinal ? x : a, dias[0])
    return { dias, entradas, saidas, saldoInicial: dias[0]?.saldoInicial ?? 0, saldoFinal: dias[dias.length - 1]?.saldoFinal ?? 0, minimo, nProj: itens.length }
  }, [q.data, ini, fim, hojeISO])

  const exportar = () => { if (!m) return; downloadCSV(`fluxo_diario_${ini}_${fim}.csv`, m.dias.map(d => ({ data: d.data, saldo_inicial: d.saldoInicial, entradas: d.entradas, saidas: d.saidas, saldo_final: d.saldoFinal, resultado: d.entradas - d.saidas, tipo: d.projetado ? 'projetado' : 'realizado' }))) }

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
          <Kpi label="Entradas" value={brl(m.entradas)} tone="pos" sub={`de ${fmtDate(ini)} a ${fmtDate(fim)}`} />
          <Kpi label="Saídas" value={brl(m.saidas)} tone="neg" sub={`${m.nProj} item(ns) projetado(s)`} />
          <Kpi label="Saldo final" value={brl(m.saldoFinal)} tone={m.saldoFinal >= 0 ? 'pos' : 'neg'} sub={m.minimo && m.minimo.saldoFinal < 0 ? <>ponto mais baixo <b className="text-neg">{brl(m.minimo.saldoFinal)}</b> em {fmtDate(m.minimo.data)}</> : <>resultado do período <b className={m.entradas - m.saidas >= 0 ? 'text-pos' : 'text-neg'}>{brl(m.entradas - m.saidas)}</b></>} />
        </div>
        {!m.dias.length ? <Empty title="Sem dias no período" /> : (
          <div className="card overflow-hidden">
            <table className="tbl">
              <thead><tr><th>Data</th><th>Saldo inicial</th><th>Entradas</th><th>Saídas</th><th>Saldo final</th><th>Resultado do dia</th></tr></thead>
              <tbody>
                {m.dias.map(d => { const res = d.entradas - d.saidas; const semMov = d.n === 0; return (
                  <tr key={d.data} className={`${semMov ? 'text-muted' : ''} ${d.data === hojeISO ? 'bg-brand/5' : ''}`}>
                    <td className="num whitespace-nowrap">{fmtDate(d.data)} <span className="text-[11px] text-muted ml-1">{dataLocal(d.data).toLocaleDateString('pt-BR', { weekday: 'short' })}</span>{d.data === hojeISO && <span className="text-[10px] font-bold uppercase text-brand ml-2">hoje</span>}{d.projetado && !semMov && <span className="text-[10px] uppercase text-muted ml-2">projetado</span>}{d.titulos.length > 0 && <div className="text-[11px] text-muted font-normal whitespace-normal max-w-xs" title={d.titulos.join(' · ')}>{d.titulos.slice(0, 3).join(' · ')}{d.titulos.length > 3 ? ` +${d.titulos.length - 3}` : ''}</div>}</td>
                    <td className="num">{brl(d.saldoInicial)}</td>
                    <td className="num text-pos">{d.entradas ? brl(d.entradas) : <span className="text-muted">—</span>}</td>
                    <td className="num text-neg">{d.saidas ? brl(d.saidas) : <span className="text-muted">—</span>}</td>
                    <td className={`num font-bold ${d.saldoFinal < 0 ? 'text-neg' : ''}`}>{brl(d.saldoFinal)}</td>
                    <td className={`num ${res > 0 ? 'text-pos' : res < 0 ? 'text-neg' : 'text-muted'}`}>{semMov ? '—' : brl(res)}</td>
                  </tr>) })}
                <tr className="bg-surface/60 font-bold"><td>Total do período</td><td className="num">{brl(m.saldoInicial)}</td><td className="num text-pos">{brl(m.entradas)}</td><td className="num text-neg">{brl(m.saidas)}</td><td className="num">{brl(m.saldoFinal)}</td><td className={`num ${m.entradas - m.saidas >= 0 ? 'text-pos' : 'text-neg'}`}>{brl(m.entradas - m.saidas)}</td></tr>
              </tbody>
            </table>
            <div className="px-4 py-2 text-xs text-muted border-t border-line">Até hoje: lançamentos efetivados nas contas. A partir de hoje: faturas de cartão por ciclo, compromissos da Agenda (inclusive vencidos e ainda em aberto, posicionados em hoje) e todas as Projeções previstas. Compromissos com lançamento equivalente no extrato são tratados como quitados. Dias sem movimento carregam o saldo.</div>
          </div>
        )}
      </>)}
    </div>
  )
}
