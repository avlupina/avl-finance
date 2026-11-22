import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, CheckCircle2 } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { useQuery } from '../hooks/useQuery'
import { Badge, ErrorBox, Kpi, Loading, PageHeader } from '../components/ui'
import { brl, fmtDate, todayISO } from '../lib/format'
import { addDias, iso, carregarAgenda, calcularItensProjetados, type ItemProjetado } from '../lib/fluxo'

const HORIZONTES = [7, 15, 30, 60, 90] as const

/**
 * NCG — Necessidade de Capital de Giro: a partir do disponível hoje (contas correntes, poupança e dinheiro) e do fluxo projetado
 * (faturas de cartão por ciclo, compromissos da Agenda e Projeções previstas), acumula dia a dia o saldo projetado e identifica,
 * em cada horizonte, o ponto mais baixo. Se o ponto mais baixo é negativo, esse valor é o capital necessário.
 */
export default function NCG() {
  const { workspace } = useAuth()
  const ws = workspace!.id
  const hoje = new Date(todayISO() + 'T12:00:00')
  const fim = addDias(hoje, 90)
  const q = useQuery(() => carregarAgenda(ws, hoje, fim, true), [ws])

  const m = useMemo(() => {
    const d = q.data; if (!d) return null
    const itens = calcularItensProjetados(d, hoje, hoje, fim).filter(i => !i.concluido && i.tipo !== 'transferencia')
    const disponivel = d.contas.filter(c => c.tipo !== 'cartao_credito' && c.tipo !== 'investimento').reduce((a, c) => a + Number(c.saldo_atual), 0)
    // Fluxo acumulado dia a dia (somente dias com itens)
    const porDia = new Map<string, ItemProjetado[]>()
    for (const i of itens) (porDia.get(i.data) ?? porDia.set(i.data, []).get(i.data)!).push(i)
    const dias = [...porDia.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([data, its]) => ({ data, entradas: its.filter(i => i.tipo === 'receita').reduce((a, i) => a + i.valor, 0), saidas: its.filter(i => i.tipo === 'despesa').reduce((a, i) => a + i.valor, 0), itens: its }))
    let acc = disponivel
    const linha = dias.map(x => { acc += x.entradas - x.saidas; return { ...x, saldo: acc } })
    const horizontes = HORIZONTES.map(h => {
      const lim = iso(addDias(hoje, h))
      const ate = linha.filter(x => x.data <= lim)
      const entradas = ate.reduce((a, x) => a + x.entradas, 0), saidas = ate.reduce((a, x) => a + x.saidas, 0)
      const saldoFim = disponivel + entradas - saidas
      const minimo = ate.reduce((a, x) => x.saldo < a.saldo ? { saldo: x.saldo, data: x.data } : a, { saldo: disponivel, data: iso(hoje) })
      return { h, lim, entradas, saidas, saldoFim, minimo, ncg: Math.max(0, -minimo.saldo), n: ate.reduce((a, x) => a + x.itens.length, 0) }
    })
    return { disponivel, linha, horizontes, totalItens: itens.length, origens: { fatura: itens.filter(i => i.origem === 'fatura').length, manual: itens.filter(i => i.origem === 'manual').length, projecao: itens.filter(i => i.origem === 'projecao').length } }
  }, [q.data])

  const pior = m ? m.horizontes.reduce((a, h) => h.ncg > a.ncg ? h : a, m.horizontes[0]) : null

  return (
    <div>
      <PageHeader crumb="Visão" title="NCG — Necessidade de Capital" actions={<div className="text-xs text-muted">Horizontes de 7 a 90 dias a partir de {fmtDate(iso(hoje))}</div>} />
      {q.loading ? <Loading /> : q.error ? <ErrorBox msg={q.error} /> : !m || !pior ? null : <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <Kpi label="Disponível hoje" value={brl(m.disponivel)} tone="brand" sub="contas correntes, poupança e dinheiro" />
        <Kpi label="Saídas previstas (90 dias)" value={brl(m.horizontes[4].saidas)} tone="neg" sub={`${m.origens.fatura} fatura(s) · ${m.origens.manual} compromisso(s) · ${m.origens.projecao} projeção(ões)`} />
        <Kpi label="Entradas previstas (90 dias)" value={brl(m.horizontes[4].entradas)} tone="pos" />
        <Kpi label="Maior necessidade" value={pior.ncg > 0 ? brl(pior.ncg) : 'Nenhuma'} tone={pior.ncg > 0 ? 'neg' : 'pos'} sub={pior.ncg > 0 ? `até ${fmtDate(pior.minimo.data)} (horizonte de ${pior.h} dias)` : 'caixa suficiente em todos os horizontes'} />
      </div>

      <div className="card overflow-hidden mb-5">
        <div className="px-4 py-3 border-b border-line font-black">Necessidade de capital por horizonte</div>
        <table className="tbl">
          <thead><tr><th>Horizonte</th><th>Até</th><th className="text-right">Entradas previstas</th><th className="text-right">Saídas previstas</th><th className="text-right">Saldo projetado</th><th className="text-right">Ponto mais baixo</th><th className="text-right">NCG</th><th></th></tr></thead>
          <tbody>
            {m.horizontes.map(h => (
              <tr key={h.h}>
                <td className="font-bold">{h.h} dias</td>
                <td className="num text-muted">{fmtDate(h.lim)}</td>
                <td className="text-right num text-pos">{h.entradas ? brl(h.entradas) : <span className="text-muted">—</span>}</td>
                <td className="text-right num text-neg">{h.saidas ? brl(h.saidas) : <span className="text-muted">—</span>}</td>
                <td className={`text-right num font-bold ${h.saldoFim < 0 ? 'text-neg' : ''}`}>{brl(h.saldoFim)}</td>
                <td className="text-right num"><span className={h.minimo.saldo < 0 ? 'text-neg' : ''}>{brl(h.minimo.saldo)}</span><div className="text-[11px] text-muted">em {fmtDate(h.minimo.data)}</div></td>
                <td className={`text-right num font-black ${h.ncg > 0 ? 'text-neg' : 'text-pos'}`}>{h.ncg > 0 ? brl(h.ncg) : 'R$ 0,00'}</td>
                <td>{h.ncg > 0 ? <Badge tone="red"><AlertTriangle size={12} /> faltará caixa</Badge> : <Badge tone="green"><CheckCircle2 size={12} /> coberto</Badge>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="px-4 py-2 text-xs text-muted border-t border-line">NCG = quanto falta para o saldo projetado não ficar negativo em nenhum dia do horizonte (ponto mais baixo do fluxo acumulado). Base: faturas por ciclo de fechamento, compromissos da <Link to="/agenda" className="text-brand font-bold">Agenda</Link> e <Link to="/projecoes" className="text-brand font-bold">Projeções</Link> previstas.</div>
      </div>

      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-line flex items-center justify-between"><div className="font-black">Fluxo projetado acumulado (90 dias)</div><div className="text-xs text-muted">{m.totalItens} item(ns)</div></div>
        {!m.linha.length ? <div className="p-6 text-sm text-muted text-center">Nada projetado para os próximos 90 dias. Informe o vencimento dos cartões em Contas e lance compromissos na Agenda ou em Projeções.</div> : (
          <table className="tbl">
            <thead><tr><th>Data</th><th>Itens</th><th className="text-right">Entradas</th><th className="text-right">Saídas</th><th className="text-right">Saldo projetado</th></tr></thead>
            <tbody>
              <tr className="bg-surface/60"><td className="font-bold" colSpan={4}>Disponível hoje ({fmtDate(iso(hoje))})</td><td className="text-right num font-bold">{brl(m.disponivel)}</td></tr>
              {m.linha.map(x => (
                <tr key={x.data} className={x.saldo < 0 ? 'bg-red-50/60' : ''}>
                  <td className="num whitespace-nowrap">{fmtDate(x.data)}</td>
                  <td className="text-xs">{x.itens.map(i => <div key={i.key} className="flex items-center gap-1"><span className={i.tipo === 'receita' ? 'text-pos' : 'text-neg'}>{i.tipo === 'receita' ? '+' : '−'}</span><span className="font-medium">{i.titulo}</span><span className="text-muted">{brl(i.valor)}</span></div>)}</td>
                  <td className="text-right num text-pos">{x.entradas ? brl(x.entradas) : ''}</td>
                  <td className="text-right num text-neg">{x.saidas ? brl(x.saidas) : ''}</td>
                  <td className={`text-right num font-bold ${x.saldo < 0 ? 'text-neg' : ''}`}>{brl(x.saldo)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      </>}
    </div>
  )
}
