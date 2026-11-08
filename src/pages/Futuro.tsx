import { useMemo, useState, type FormEvent } from 'react'
import { Plus, Pencil, Trash2, Target, ShieldCheck, Telescope, Flag, Sunrise } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useQuery } from '../hooks/useQuery'
import { Badge, Empty, ErrorBox, Field, Kpi, Loading, Modal, PageHeader, Tabs } from '../components/ui'
import { LinhaChart } from '../components/charts'
import { brl, fmtDate, MESES, pct } from '../lib/format'
import type { Meta } from '../lib/types'

type Tab = 'objetivos' | 'independencia' | 'projecao'
const emptyForm = () => ({ nome: '', tipo: 'meta' as Meta['tipo'], valor_alvo: '', valor_atual: '', aporte_mensal: '', data_alvo: '', descricao: '' })

export default function Futuro() {
  const { workspace, canEditModule } = useAuth()
  const ws = workspace!.id
  const podeEditar = canEditModule('futuro')
  const [tab, setTab] = useState<Tab>('objetivos')
  const [modal, setModal] = useState<null | { id?: string; form: ReturnType<typeof emptyForm> }>(null)
  const [err, setErr] = useState<string | null>(null)
  // premissas da projeção
  const [horizonte, setHorizonte] = useState(24)
  const [taxaAA, setTaxaAA] = useState(10)
  const [ajusteDesp, setAjusteDesp] = useState(0)
  // independência financeira
  const [rendaDesejada, setRendaDesejada] = useState<number | null>(null)
  const [taxaReal, setTaxaReal] = useState(4)
  const [aporteIF, setAporteIF] = useState<number | null>(null)

  const ini = useMemo(() => { const d = new Date(); d.setMonth(d.getMonth() - 11); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01` }, [])
  const q = useQuery(async () => {
    const [m, r, p] = await Promise.all([
      supabase.from('metas').select('*').eq('workspace_id', ws).order('data_alvo', { nullsFirst: false }),
      supabase.from('v_resultado_mensal').select('*').eq('workspace_id', ws).gte('competencia', ini),
      supabase.from('v_patrimonio_liquido').select('*').eq('workspace_id', ws).maybeSingle(),
    ])
    if (m.error) throw m.error
    return { metas: m.data as Meta[], res: (r.data ?? []) as { competencia: string; receitas: number; despesas: number }[], pos: p.data as Record<string, number> | null }
  }, [ws, ini])

  const base = useMemo(() => {
    const res = q.data?.res ?? []; const n = res.length || 1
    const rec = res.reduce((a, r) => a + Number(r.receitas), 0) / n, desp = res.reduce((a, r) => a + Number(r.despesas), 0) / n
    const pos = q.data?.pos; const liquido = Number(pos?.saldo_contas ?? 0) + Number(pos?.investimentos ?? 0) + Number(pos?.faturas_cartao ?? 0)
    const investido = Number(pos?.investimentos ?? 0)
    return { rec, desp, liquido, investido, meses: res.length }
  }, [q.data])

  const projecao = useMemo(() => {
    const i = Math.pow(1 + taxaAA / 100, 1 / 12) - 1
    const desp = base.desp * (1 + ajusteDesp / 100); const poup = base.rec - desp
    let acum = base.liquido, semRend = base.liquido
    const d = new Date(); const out = []
    for (let k = 1; k <= horizonte; k++) { d.setMonth(d.getMonth() + 1); acum = acum * (1 + i) + poup; semRend += poup; out.push({ mes: `${MESES[d.getMonth()]}/${String(d.getFullYear()).slice(2)}`, comRendimento: Math.round(acum), semRendimento: Math.round(semRend) }) }
    return { out, poup, final: acum }
  }, [base, horizonte, taxaAA, ajusteDesp])

  // Independência financeira: patrimônio necessário = renda anual desejada / taxa real de retirada
  const indep = useMemo(() => {
    const renda = rendaDesejada ?? Math.round(base.desp)
    const aporte = aporteIF ?? Math.max(0, Math.round(base.rec - base.desp))
    const necessario = taxaReal > 0 ? (renda * 12) / (taxaReal / 100) : 0
    const i = Math.pow(1 + taxaReal / 100, 1 / 12) - 1
    let acum = base.investido, meses = 0; const serie: { mes: string; patrimonio: number; alvo: number }[] = []
    const d = new Date()
    while (acum < necessario && meses < 600) { acum = acum * (1 + i) + aporte; meses++; d.setMonth(d.getMonth() + 1); if (meses % 12 === 0 || acum >= necessario) serie.push({ mes: `${MESES[d.getMonth()]}/${String(d.getFullYear()).slice(2)}`, patrimonio: Math.round(acum), alvo: Math.round(necessario) }) }
    return { renda, aporte, necessario, meses: acum >= necessario ? meses : null, progresso: necessario ? Math.min(100, base.investido / necessario * 100) : 0, serie }
  }, [rendaDesejada, aporteIF, taxaReal, base])

  const reservaMeses = base.desp ? base.liquido / base.desp : 0

  const salvar = async (e: FormEvent) => {
    e.preventDefault(); if (!modal) return; setErr(null)
    const f = modal.form; const n = (s: string) => s ? Number(String(s).replace(',', '.')) : null
    const payload = { workspace_id: ws, nome: f.nome.trim(), tipo: f.tipo, valor_alvo: n(f.valor_alvo) ?? 0, valor_atual: n(f.valor_atual) ?? 0, aporte_mensal: n(f.aporte_mensal), data_alvo: f.data_alvo || null, descricao: f.descricao || null }
    const r = modal.id ? await supabase.from('metas').update(payload).eq('id', modal.id) : await supabase.from('metas').insert(payload)
    if (r.error) { setErr(r.error.message); return }
    setModal(null); q.refetch()
  }
  const excluir = async (m: Meta) => { if (!confirm(`Excluir "${m.nome}"?`)) return; const { error } = await supabase.from('metas').delete().eq('id', m.id); if (error) alert(error.message); else q.refetch() }

  /** Aporte mensal necessário para atingir a meta na data alvo. */
  const aporteNecessario = (m: Meta) => {
    if (!m.data_alvo) return null
    const meses = Math.max(1, Math.round((new Date(m.data_alvo).getTime() - Date.now()) / (1000 * 3600 * 24 * 30.44)))
    const falta = Number(m.valor_alvo) - Number(m.valor_atual)
    return { meses, aporte: falta > 0 ? falta / meses : 0 }
  }
  const mesesParaMeta = (m: Meta) => { const falta = Number(m.valor_alvo) - Number(m.valor_atual); if (falta <= 0) return 0; if (!m.aporte_mensal) return null; return Math.ceil(falta / Number(m.aporte_mensal)) }
  const totalMetas = (q.data?.metas ?? []).reduce((a, m) => ({ alvo: a.alvo + Number(m.valor_alvo), atual: a.atual + Number(m.valor_atual), aporte: a.aporte + Number(m.aporte_mensal ?? 0) }), { alvo: 0, atual: 0, aporte: 0 })

  return (
    <div>
      <PageHeader title="Futuro" actions={podeEditar && tab === 'objetivos' && <button className="btn btn-primary" onClick={() => setModal({ form: emptyForm() })}><Plus size={16} /> Novo objetivo</button>}>
        <Tabs tabs={[{ key: 'objetivos', label: 'Meus Objetivos' }, { key: 'independencia', label: 'Independência Financeira' }, { key: 'projecao', label: 'Projeção Patrimonial' }]} value={tab} onChange={setTab} />
      </PageHeader>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <Kpi label="Capacidade de poupança / mês" value={brl(base.rec - base.desp)} tone={base.rec - base.desp >= 0 ? 'pos' : 'neg'} sub={`média dos últimos ${base.meses || 0} meses`} />
        <Kpi label="Reserva de emergência" value={`${reservaMeses.toFixed(1)} meses`} tone={reservaMeses >= 6 ? 'pos' : reservaMeses >= 3 ? 'brand' : 'neg'} sub="disponível / despesa média (meta: 6)" />
        <Kpi label="Comprometido com objetivos" value={brl(totalMetas.aporte)} sub={`${(q.data?.metas ?? []).length} objetivo(s) · ${totalMetas.alvo ? pct(totalMetas.atual / totalMetas.alvo * 100, 0) : '—'} alcançado`} />
        <Kpi label="Independência financeira" value={pct(indep.progresso, 0)} tone="brand" sub={indep.meses != null ? `~${Math.ceil(indep.meses / 12)} anos no ritmo atual` : 'defina renda e aporte'} />
      </div>

      {q.loading ? <Loading /> : q.error ? <ErrorBox msg={q.error} /> : tab === 'objetivos' ? (
        !q.data?.metas.length ? <Empty title="Nenhum objetivo definido" hint="Defina objetivos (viagem, reserva de emergência, troca de carro, aposentadoria), com valor e data alvo. O app calcula o aporte mensal necessário." action={podeEditar && <button className="btn btn-primary" onClick={() => setModal({ form: emptyForm() })}><Plus size={16} /> Novo objetivo</button>} /> : (
          <div className="flex flex-col gap-4">
            {/* linha do tempo */}
            <div className="card p-4 overflow-x-auto">
              <div className="font-black mb-3 flex items-center gap-2"><Flag size={16} className="text-brand" /> Linha do tempo</div>
              <div className="flex gap-3 min-w-max">
                {[...q.data.metas].sort((a, b) => (a.data_alvo ?? '9999').localeCompare(b.data_alvo ?? '9999')).map(m => { const prog = Number(m.valor_alvo) ? Math.min(100, Number(m.valor_atual) / Number(m.valor_alvo) * 100) : 0; return (
                  <div key={m.id} className="w-44 shrink-0 rounded-xl border border-line p-3 bg-surface/40">
                    <div className="text-xs text-muted num">{m.data_alvo ? fmtDate(m.data_alvo) : 'sem data'}</div>
                    <div className="font-bold truncate" title={m.nome}>{m.nome}</div>
                    <div className="text-sm num">{brl(m.valor_alvo)}</div>
                    <div className="h-1.5 rounded-full bg-white overflow-hidden mt-2 border border-line"><div className="h-full bg-brand" style={{ width: `${prog}%` }} /></div>
                  </div>) })}
              </div>
            </div>
            <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
              {q.data.metas.map(m => {
                const prog = Number(m.valor_alvo) ? Math.min(100, (Number(m.valor_atual) / Number(m.valor_alvo)) * 100) : 0
                const mm = mesesParaMeta(m); const nec = aporteNecessario(m); const Icon = m.tipo === 'reserva' ? ShieldCheck : m.tipo === 'projecao' ? Telescope : Target
                const atrasado = nec && m.aporte_mensal != null && Number(m.aporte_mensal) < nec.aporte - 0.5
                return (
                  <div key={m.id} className="card p-4 flex flex-col gap-3">
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-xl bg-brand-soft text-brand flex items-center justify-center shrink-0"><Icon size={18} /></div>
                      <div className="flex-1 min-w-0"><div className="font-black truncate">{m.nome}</div>{m.descricao && <div className="text-xs text-muted">{m.descricao}</div>}</div>
                      <Badge tone={prog >= 100 ? 'green' : atrasado ? 'amber' : 'blue'}>{prog >= 100 ? 'concluído' : atrasado ? 'aporte insuficiente' : m.tipo}</Badge>
                    </div>
                    <div>
                      <div className="flex justify-between text-sm mb-1"><span className="num font-bold">{brl(m.valor_atual)}</span><span className="num text-muted">de {brl(m.valor_alvo)}</span></div>
                      <div className="h-2.5 rounded-full bg-surface overflow-hidden"><div className="h-full rounded-full bg-brand" style={{ width: `${prog}%` }} /></div>
                      <div className="flex justify-between text-xs text-muted mt-1"><span>{pct(prog, 0)}</span><span>{m.data_alvo ? `alvo ${fmtDate(m.data_alvo)}` : ''}</span></div>
                    </div>
                    <div className="text-xs text-muted border-t border-line pt-2 flex flex-col gap-0.5">
                      <div className="flex justify-between"><span>Aporte planejado</span><b className="num">{m.aporte_mensal ? brl(m.aporte_mensal) + '/mês' : '—'}</b></div>
                      {nec && <div className="flex justify-between"><span>Necessário p/ data alvo</span><b className={`num ${atrasado ? 'text-amber-700' : ''}`}>{brl(nec.aporte)}/mês ({nec.meses} m)</b></div>}
                      {mm != null && mm > 0 && <div className="flex justify-between"><span>No ritmo atual</span><b className="num">{mm} meses</b></div>}
                    </div>
                    {podeEditar && <div className="flex justify-end gap-1 no-print -mt-1"><button className="btn btn-ghost p-1" onClick={() => setModal({ id: m.id, form: { nome: m.nome, tipo: m.tipo, valor_alvo: String(m.valor_alvo), valor_atual: String(m.valor_atual), aporte_mensal: m.aporte_mensal != null ? String(m.aporte_mensal) : '', data_alvo: m.data_alvo ?? '', descricao: m.descricao ?? '' } })}><Pencil size={14} /></button><button className="btn btn-ghost p-1 text-neg" onClick={() => excluir(m)}><Trash2 size={14} /></button></div>}
                  </div>
                )
              })}
            </div>
          </div>
        )
      ) : tab === 'independencia' ? (
        <div className="grid lg:grid-cols-[320px_1fr] gap-4">
          <div className="card p-4 flex flex-col gap-4 self-start">
            <div className="font-black flex items-center gap-2"><Sunrise size={16} className="text-brand" /> Premissas</div>
            <Field label="Renda passiva mensal desejada (R$)"><input className="input num" value={indep.renda} onChange={e => setRendaDesejada(Number(e.target.value.replace(/\D/g, '')) || 0)} /><div className="text-[11px] text-muted mt-1">padrão: sua despesa média atual</div></Field>
            <Field label={`Taxa real de retirada/rendimento: ${taxaReal}% a.a.`}><input type="range" min={2} max={8} step={0.5} value={taxaReal} onChange={e => setTaxaReal(Number(e.target.value))} className="w-full accent-brand" /><div className="text-[11px] text-muted mt-1">acima da inflação; 4% é a referência conservadora</div></Field>
            <Field label="Aporte mensal em investimentos (R$)"><input className="input num" value={indep.aporte} onChange={e => setAporteIF(Number(e.target.value.replace(/\D/g, '')) || 0)} /><div className="text-[11px] text-muted mt-1">padrão: sua capacidade de poupança média</div></Field>
            <div className="text-sm border-t border-line pt-3 flex flex-col gap-1">
              <div className="flex justify-between"><span className="text-muted">Patrimônio necessário</span><b className="num">{brl(indep.necessario)}</b></div>
              <div className="flex justify-between"><span className="text-muted">Investido hoje</span><b className="num">{brl(base.investido)}</b></div>
              <div className="flex justify-between"><span className="text-muted">Falta</span><b className="num">{brl(Math.max(0, indep.necessario - base.investido))}</b></div>
              <div className="flex justify-between"><span className="text-muted">Tempo estimado</span><b className="num">{indep.meses != null ? `${Math.floor(indep.meses / 12)} anos e ${indep.meses % 12} meses` : '> 50 anos'}</b></div>
            </div>
          </div>
          <div className="card p-4">
            <div className="font-black mb-1">Caminho até a independência financeira</div>
            <div className="text-xs text-muted mb-2">Patrimônio investido projetado (em valores de hoje) até atingir o montante que gera a renda desejada.</div>
            {indep.serie.length ? <LinhaChart data={indep.serie} height={340} series={[{ key: 'patrimonio', name: 'Patrimônio investido', color: '#104862' }, { key: 'alvo', name: 'Necessário', color: '#eb6834' }]} /> : <div className="text-sm text-muted py-10 text-center">Com os parâmetros atuais a meta já foi alcançada ou não é atingível — ajuste renda, taxa ou aporte.</div>}
          </div>
        </div>
      ) : (
        <div className="grid lg:grid-cols-[300px_1fr] gap-4">
          <div className="card p-4 flex flex-col gap-4 self-start">
            <div className="font-black">Premissas</div>
            <Field label={`Horizonte: ${horizonte} meses`}><input type="range" min={6} max={120} step={6} value={horizonte} onChange={e => setHorizonte(Number(e.target.value))} className="w-full accent-brand" /></Field>
            <Field label={`Rentabilidade: ${taxaAA}% a.a.`}><input type="range" min={0} max={20} step={0.5} value={taxaAA} onChange={e => setTaxaAA(Number(e.target.value))} className="w-full accent-brand" /></Field>
            <Field label={`Ajuste nas despesas: ${ajusteDesp > 0 ? '+' : ''}${ajusteDesp}%`}><input type="range" min={-50} max={50} step={5} value={ajusteDesp} onChange={e => setAjusteDesp(Number(e.target.value))} className="w-full accent-brand" /></Field>
            <div className="text-sm text-muted border-t border-line pt-3 flex flex-col gap-1">
              <div className="flex justify-between"><span>Receita média</span><b className="num">{brl(base.rec)}</b></div>
              <div className="flex justify-between"><span>Despesa ajustada</span><b className="num">{brl(base.desp * (1 + ajusteDesp / 100))}</b></div>
              <div className="flex justify-between"><span>Poupança mensal</span><b className={`num ${projecao.poup < 0 ? 'text-neg' : 'text-pos'}`}>{brl(projecao.poup)}</b></div>
              <div className="flex justify-between"><span>Em {horizonte} meses</span><b className="num text-brand">{brl(projecao.final)}</b></div>
            </div>
          </div>
          <div className="card p-4">
            <div className="font-black mb-1">Evolução projetada da posição líquida</div>
            <div className="text-xs text-muted mb-2">Partindo da posição atual, somando a poupança mensal média e aplicando a rentabilidade escolhida.</div>
            <LinhaChart data={projecao.out} height={340} series={[{ key: 'comRendimento', name: 'Com rendimento', color: '#104862' }, { key: 'semRendimento', name: 'Só poupança', color: '#eb6834' }]} />
          </div>
        </div>
      )}

      <Modal open={!!modal} onClose={() => setModal(null)} title={modal?.id ? 'Editar objetivo' : 'Novo objetivo'}>
        {modal && <form onSubmit={salvar} className="grid grid-cols-2 gap-3">
          <Field label="Nome" className="col-span-2"><input className="input" required value={modal.form.nome} onChange={e => setModal({ ...modal, form: { ...modal.form, nome: e.target.value } })} /></Field>
          <Field label="Tipo"><select className="input" value={modal.form.tipo} onChange={e => setModal({ ...modal, form: { ...modal.form, tipo: e.target.value as Meta['tipo'] } })}><option value="meta">Objetivo</option><option value="reserva">Reserva de emergência</option><option value="projecao">Projeção</option></select></Field>
          <Field label="Data alvo"><input type="date" className="input" value={modal.form.data_alvo} onChange={e => setModal({ ...modal, form: { ...modal.form, data_alvo: e.target.value } })} /></Field>
          <Field label="Valor alvo"><input className="input num" required value={modal.form.valor_alvo} onChange={e => setModal({ ...modal, form: { ...modal.form, valor_alvo: e.target.value } })} /></Field>
          <Field label="Valor já acumulado"><input className="input num" value={modal.form.valor_atual} onChange={e => setModal({ ...modal, form: { ...modal.form, valor_atual: e.target.value } })} /></Field>
          <Field label="Aporte mensal planejado" className="col-span-2"><input className="input num" value={modal.form.aporte_mensal} onChange={e => setModal({ ...modal, form: { ...modal.form, aporte_mensal: e.target.value } })} /></Field>
          <Field label="Descrição" className="col-span-2"><textarea className="input" rows={2} value={modal.form.descricao} onChange={e => setModal({ ...modal, form: { ...modal.form, descricao: e.target.value } })} /></Field>
          <div className="col-span-2"><ErrorBox msg={err} /></div>
          <div className="col-span-2 flex justify-end gap-2"><button type="button" className="btn" onClick={() => setModal(null)}>Cancelar</button><button className="btn btn-primary">Salvar</button></div>
        </form>}
      </Modal>
    </div>
  )
}
