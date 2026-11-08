import { useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useQuery } from '../hooks/useQuery'
import { Empty, ErrorBox, Kpi, Loading, PageHeader, Tabs } from '../components/ui'
import { BarrasHorizontais, LinhaChart, Rosca, SERIES } from '../components/charts'
import { brl, mesLabel, pct } from '../lib/format'
import type { Lancamento, PlanoConta } from '../lib/types'

type Tab = 'uso' | 'categorias' | 'habitos'

export default function Analise() {
  const { workspace } = useAuth()
  const ws = workspace!.id
  const [meses, setMeses] = useState(6)
  const [tab, setTab] = useState<Tab>('uso')
  const ini = useMemo(() => { const d = new Date(); d.setMonth(d.getMonth() - (meses - 1)); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01` }, [meses])

  const q = useQuery(async () => {
    const [l, p] = await Promise.all([
      supabase.from('lancamentos').select('id, data, competencia, valor, tipo, status, plano_conta_id, descricao, categoria_origem').eq('workspace_id', ws).gte('data', ini).neq('status', 'pendente').neq('tipo', 'transferencia').limit(20000),
      supabase.from('plano_contas').select('*').eq('workspace_id', ws),
    ])
    if (l.error) throw l.error
    return { lanc: l.data as Lancamento[], planos: (p.data ?? []) as PlanoConta[] }
  }, [ws, ini])

  const a = useMemo(() => {
    const lanc = q.data?.lanc ?? []; const planos = q.data?.planos ?? []
    const pl = Object.fromEntries(planos.map(p => [p.id, p]))
    const porMes: Record<string, { receitas: number; despesas: number; fixas: number; variaveis: number }> = {}
    const porCat: Record<string, number> = {}; const porGrupo: Record<string, number> = {}
    const porDiaSemana = Array(7).fill(0); const porDescricao: Record<string, { total: number; n: number }> = {}
    let totR = 0, totD = 0, fixas = 0, variaveis = 0, nDesp = 0, maior = { v: 0, d: '' }
    for (const l of lanc) {
      const v = Number(l.valor); const k = l.competencia.slice(0, 10)
      porMes[k] ??= { receitas: 0, despesas: 0, fixas: 0, variaveis: 0 }
      const p = l.plano_conta_id ? pl[l.plano_conta_id] : undefined
      const ehReceita = p ? p.tipo === 'receita' : l.tipo === 'receita'
      if (ehReceita) { const s = l.tipo === 'receita' ? 1 : -1; totR += s * v; porMes[k].receitas += s * v; continue }
      if (l.tipo === 'receita') { totD -= v; porMes[k].despesas -= v; continue } // estorno
      totD += v; nDesp++; porMes[k].despesas += v
      const nome = p ? p.nome : (l.categoria_origem ?? 'Sem categoria')
      porCat[nome] = (porCat[nome] ?? 0) + v
      const g = p?.parent_id ? pl[p.parent_id]?.nome : (p?.nome ?? 'Sem categoria'); porGrupo[g ?? 'Sem categoria'] = (porGrupo[g ?? 'Sem categoria'] ?? 0) + v
      if (p?.natureza === 'fixa') { fixas += v; porMes[k].fixas += v } else { variaveis += v; porMes[k].variaveis += v }
      porDiaSemana[new Date(l.data + 'T12:00:00').getDay()] += v
      const d = l.descricao.replace(/\d+/g, '').trim().slice(0, 28).toUpperCase(); porDescricao[d] ??= { total: 0, n: 0 }; porDescricao[d].total += v; porDescricao[d].n++
      if (v > maior.v) maior = { v, d: l.descricao }
    }
    const mesesArr = Object.keys(porMes).sort().map(k => ({ mes: mesLabel(k), ...porMes[k], resultado: porMes[k].receitas - porMes[k].despesas, poupanca: porMes[k].receitas ? ((porMes[k].receitas - porMes[k].despesas) / porMes[k].receitas) * 100 : 0 }))
    const topCat = Object.entries(porCat).sort((x, y) => y[1] - x[1]).slice(0, 10).map(([nome, valor]) => ({ nome, valor }))
    const recorrentes = Object.entries(porDescricao).filter(([, v]) => v.n >= Math.max(2, Math.floor(meses * 0.6))).sort((x, y) => y[1].total - x[1].total).slice(0, 12)
    const n = mesesArr.length || 1
    return { mesesArr, topCat, porGrupo, totR, totD, fixas, variaveis, nDesp, maior, recorrentes, porDiaSemana, mediaDesp: totD / n, mediaRec: totR / n, ticket: nDesp ? totD / nDesp : 0 }
  }, [q.data, meses])

  const taxaPoupanca = a.totR ? ((a.totR - a.totD) / a.totR) * 100 : 0
  const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

  return (
    <div>
      <PageHeader title="Análise" actions={<select className="input w-40" value={meses} onChange={e => setMeses(Number(e.target.value))}><option value={3}>Últimos 3 meses</option><option value={6}>Últimos 6 meses</option><option value={12}>Últimos 12 meses</option><option value={24}>Últimos 24 meses</option></select>}>
        <Tabs tabs={[{ key: 'uso', label: 'Uso do Dinheiro' }, { key: 'categorias', label: 'Categorias' }, { key: 'habitos', label: 'Hábitos e Recorrências' }]} value={tab} onChange={setTab} />
      </PageHeader>

      {q.loading ? <Loading /> : q.error ? <ErrorBox msg={q.error} /> : !q.data?.lanc.length ? <Empty title="Sem dados para analisar" hint="Importe ou registre lançamentos para gerar os indicadores." /> : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-3 mb-5">
            <Kpi label="Taxa de poupança" value={pct(taxaPoupanca)} tone={taxaPoupanca >= 20 ? 'pos' : taxaPoupanca >= 0 ? 'brand' : 'neg'} sub="meta de referência: 20%" />
            <Kpi label="Despesa média mensal" value={brl(a.mediaDesp)} />
            <Kpi label="Receita média mensal" value={brl(a.mediaRec)} />
            <Kpi label="Custo fixo / despesas" value={pct(a.totD ? (a.fixas / a.totD) * 100 : 0)} sub="comprometimento fixo" />
            <Kpi label="Ticket médio" value={brl(a.ticket)} sub={`${a.nDesp} despesas`} />
            <Kpi label="Maior gasto" value={brl(a.maior.v)} sub={<span className="truncate block">{a.maior.d}</span>} />
          </div>

          {tab === 'uso' && <div className="grid lg:grid-cols-2 gap-4">
            <div className="card p-4"><div className="font-black mb-1">Fixas x variáveis por mês</div><div className="text-xs text-muted mb-2">Quanto do gasto mensal é compromisso fixo (moradia, educação, seguros) versus consumo variável.</div><LinhaChart data={a.mesesArr} series={[{ key: 'fixas', name: 'Fixas', color: SERIES[0] }, { key: 'variaveis', name: 'Variáveis', color: SERIES[1] }]} /></div>
            <div className="card p-4"><div className="font-black mb-1">Resultado mensal</div><div className="text-xs text-muted mb-2">Receitas menos despesas em cada mês.</div><LinhaChart data={a.mesesArr} series={[{ key: 'resultado', name: 'Resultado', color: '#104862' }]} /></div>
            <div className="card p-4 lg:col-span-2"><div className="font-black mb-1">Distribuição por grupo</div><Rosca data={Object.entries(a.porGrupo).sort((x, y) => y[1] - x[1]).map(([nome, valor]) => ({ nome, valor }))} /></div>
          </div>}

          {tab === 'categorias' && <div className="grid lg:grid-cols-2 gap-4">
            <div className="card p-4"><div className="font-black mb-1">Top 10 categorias de despesa</div><div className="text-xs text-muted mb-2">Período selecionado.</div><BarrasHorizontais data={a.topCat} color={SERIES[1]} /></div>
            <div className="card p-4"><div className="font-black mb-2">Participação de cada categoria</div>
              <table className="tbl"><thead><tr><th>Categoria</th><th className="text-right">Total</th><th className="text-right">Média/mês</th><th className="text-right">% despesas</th></tr></thead>
                <tbody>{a.topCat.map(c => <tr key={c.nome}><td className="font-bold">{c.nome}</td><td className="text-right num">{brl(c.valor)}</td><td className="text-right num text-muted">{brl(c.valor / (a.mesesArr.length || 1))}</td><td className="text-right num">{pct(a.totD ? c.valor / a.totD * 100 : 0)}</td></tr>)}</tbody></table>
            </div>
          </div>}

          {tab === 'habitos' && <div className="grid lg:grid-cols-2 gap-4">
            <div className="card p-4"><div className="font-black mb-1">Gastos recorrentes</div><div className="text-xs text-muted mb-2">Descrições que se repetem na maioria dos meses — assinaturas, mensalidades e hábitos.</div>
              <table className="tbl"><thead><tr><th>Descrição</th><th className="text-right">Ocorrências</th><th className="text-right">Total</th><th className="text-right">Média</th></tr></thead>
                <tbody>{a.recorrentes.map(([d, v]) => <tr key={d}><td className="font-bold">{d}</td><td className="text-right num">{v.n}</td><td className="text-right num">{brl(v.total)}</td><td className="text-right num text-muted">{brl(v.total / v.n)}</td></tr>)}
                  {!a.recorrentes.length && <tr><td colSpan={4} className="text-muted">Ainda não há recorrências detectadas.</td></tr>}</tbody></table>
            </div>
            <div className="card p-4"><div className="font-black mb-1">Gastos por dia da semana</div><div className="text-xs text-muted mb-2">Em que dias o dinheiro sai mais.</div><BarrasHorizontais data={DIAS.map((d, i) => ({ nome: d, valor: a.porDiaSemana[i] }))} color={SERIES[0]} height={260} /></div>
          </div>}
        </>
      )}
    </div>
  )
}
