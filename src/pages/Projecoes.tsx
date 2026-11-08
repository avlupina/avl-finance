import { useMemo, useState, type FormEvent } from 'react'
import { Plus, Pencil, Trash2, Copy, CheckCircle2, ChevronLeft, ChevronRight, Repeat } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useQuery } from '../hooks/useQuery'
import { Badge, Empty, ErrorBox, Field, Kpi, Loading, Modal, MoneyCell, PageHeader } from '../components/ui'
import { brl, competenciaISO, fmtDate, MESES, pct } from '../lib/format'
import type { Fornecedor, PlanoConta, Projecao } from '../lib/types'

const emptyForm = (comp: string) => ({ competencia: comp, data_prevista: '', descricao: '', plano_conta_id: '', fornecedor_id: '', tipo: 'despesa' as Projecao['tipo'], valor: '', recorrente: false, observacao: '' })

export default function Projecoes() {
  const { workspace, canEditModule, user } = useAuth()
  const ws = workspace!.id
  const podeEditar = canEditModule('projecoes')
  const hoje = new Date()
  const [ano, setAno] = useState(hoje.getFullYear())
  const [mes, setMes] = useState(hoje.getMonth() + 1)
  const comp = competenciaISO(ano, mes)
  const [modal, setModal] = useState<null | { id?: string; form: ReturnType<typeof emptyForm> }>(null)
  const [err, setErr] = useState<string | null>(null)

  const aux = useQuery(async () => {
    const [p, f] = await Promise.all([
      supabase.from('plano_contas').select('*').eq('workspace_id', ws).eq('ativo', true).order('codigo'),
      supabase.from('fornecedores').select('*').eq('workspace_id', ws).eq('ativo', true).order('nome'),
    ])
    return { planos: (p.data ?? []) as PlanoConta[], forn: (f.data ?? []) as Fornecedor[] }
  }, [ws])

  const q = useQuery(async () => {
    const fim = new Date(ano, mes, 0).toISOString().slice(0, 10)
    const [pr, re] = await Promise.all([
      supabase.from('projecoes').select('*, plano_contas(nome, codigo), fornecedores(nome)').eq('workspace_id', ws).eq('competencia', comp).order('data_prevista', { nullsFirst: false }).order('valor', { ascending: false }),
      supabase.from('lancamentos').select('plano_conta_id, valor, tipo').eq('workspace_id', ws).gte('data', comp).lte('data', fim).neq('status', 'pendente').neq('tipo', 'transferencia').limit(20000),
    ])
    if (pr.error) throw pr.error
    const realPorPlano: Record<string, number> = {}; let realD = 0, realR = 0
    for (const l of (re.data ?? []) as { plano_conta_id: string | null; valor: number; tipo: string }[]) { const v = Number(l.valor); if (l.tipo === 'receita') realR += v; else realD += v; if (l.plano_conta_id) realPorPlano[l.plano_conta_id] = (realPorPlano[l.plano_conta_id] ?? 0) + (l.tipo === 'despesa' ? v : -v) }
    return { rows: pr.data as (Projecao & { plano_contas?: { nome: string; codigo: string } | null; fornecedores?: { nome: string } | null })[], realPorPlano, realD, realR }
  }, [ws, comp])

  const tot = useMemo(() => (q.data?.rows ?? []).filter(r => r.status !== 'cancelada').reduce((a, r) => { if (r.tipo === 'despesa') a.d += Number(r.valor); else if (r.tipo === 'receita') a.r += Number(r.valor); return a }, { d: 0, r: 0 }), [q.data])

  const navMes = (d: number) => { const nd = new Date(ano, mes - 1 + d, 1); setAno(nd.getFullYear()); setMes(nd.getMonth() + 1) }

  const salvar = async (e: FormEvent) => {
    e.preventDefault(); if (!modal) return; setErr(null)
    const f = modal.form
    const payload = { workspace_id: ws, competencia: f.competencia, data_prevista: f.data_prevista || null, descricao: f.descricao.trim(), plano_conta_id: f.plano_conta_id || null, fornecedor_id: f.fornecedor_id || null, tipo: f.tipo, valor: Math.abs(Number(String(f.valor).replace(',', '.'))), recorrente: f.recorrente, observacao: f.observacao || null, created_by: user!.id }
    if (!payload.valor) { setErr('Informe um valor válido.'); return }
    const r = modal.id ? await supabase.from('projecoes').update(payload).eq('id', modal.id) : await supabase.from('projecoes').insert(payload)
    if (r.error) { setErr(r.error.message); return }
    setModal(null); q.refetch()
  }
  const excluir = async (p: Projecao) => { if (!confirm(`Excluir "${p.descricao}"?`)) return; const { error } = await supabase.from('projecoes').delete().eq('id', p.id); if (error) alert(error.message); else q.refetch() }
  const marcar = async (p: Projecao, status: Projecao['status']) => { await supabase.from('projecoes').update({ status }).eq('id', p.id); q.refetch() }

  /** Copia as projeções recorrentes do mês anterior (ou todas, se não houver recorrentes) para o mês atual. */
  const copiarAnterior = async () => {
    const ant = new Date(ano, mes - 2, 1); const compAnt = competenciaISO(ant.getFullYear(), ant.getMonth() + 1)
    const { data } = await supabase.from('projecoes').select('*').eq('workspace_id', ws).eq('competencia', compAnt).neq('status', 'cancelada')
    const src = (data ?? []) as Projecao[]
    const rec = src.filter(p => p.recorrente); const lista = rec.length ? rec : src
    if (!lista.length) { alert('Não há projeções no mês anterior para copiar.'); return }
    if (!confirm(`Copiar ${lista.length} projeção(ões) de ${MESES[ant.getMonth()]}/${ant.getFullYear()} para ${MESES[mes - 1]}/${ano}?`)) return
    const existentes = new Set((q.data?.rows ?? []).map(r => r.descricao.toLowerCase()))
    const novas = lista.filter(p => !existentes.has(p.descricao.toLowerCase())).map(p => ({ workspace_id: ws, competencia: comp, data_prevista: p.data_prevista ? `${comp.slice(0, 8)}${String(Math.min(Number(p.data_prevista.slice(8, 10)), new Date(ano, mes, 0).getDate())).padStart(2, '0')}` : null, descricao: p.descricao, plano_conta_id: p.plano_conta_id, fornecedor_id: p.fornecedor_id, tipo: p.tipo, valor: p.valor, recorrente: p.recorrente, observacao: p.observacao, created_by: user!.id }))
    if (!novas.length) { alert('Todas já existem neste mês.'); return }
    const { error } = await supabase.from('projecoes').insert(novas); if (error) alert(error.message); else q.refetch()
  }

  const folhas = (aux.data?.planos ?? []).filter(p => p.parent_id)
  const realD = q.data?.realD ?? 0

  return (
    <div>
      <PageHeader title="Projeções" actions={<>
        <div className="flex items-center gap-1 card px-1 py-0.5">
          <button className="btn btn-ghost p-1.5" onClick={() => navMes(-1)}><ChevronLeft size={16} /></button>
          <span className="font-black w-28 text-center">{MESES[mes - 1]}/{ano}</span>
          <button className="btn btn-ghost p-1.5" onClick={() => navMes(1)}><ChevronRight size={16} /></button>
        </div>
        {podeEditar && <button className="btn" onClick={copiarAnterior}><Copy size={16} /> Copiar do mês anterior</button>}
        {podeEditar && <button className="btn btn-primary" onClick={() => setModal({ form: emptyForm(comp) })}><Plus size={16} /> Nova projeção</button>}
      </>} />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <Kpi label="Gastos previstos" value={brl(tot.d)} tone="neg" />
        <Kpi label="Receitas previstas" value={brl(tot.r)} tone="pos" />
        <Kpi label="Saldo previsto" value={brl(tot.r - tot.d)} tone={tot.r - tot.d >= 0 ? 'brand' : 'neg'} />
        <Kpi label="Realizado até agora" value={brl(realD)} sub={tot.d ? `${pct(realD / tot.d * 100, 0)} dos gastos previstos` : 'sem previsão de gastos'} />
      </div>

      {q.loading ? <Loading /> : q.error ? <ErrorBox msg={q.error} /> : !q.data?.rows.length ? (
        <Empty title={`Nenhuma projeção para ${MESES[mes - 1]}/${ano}`} hint="Cadastre os gastos e receitas previstos do mês (contas fixas, parcelas, impostos, viagens). Marque como recorrente o que se repete todo mês para copiar com um clique." action={podeEditar && <button className="btn btn-primary" onClick={() => setModal({ form: emptyForm(comp) })}><Plus size={16} /> Nova projeção</button>} />
      ) : (
        <div className="card overflow-x-auto">
          <table className="tbl">
            <thead><tr><th>Data prevista</th><th>Descrição</th><th>Categoria</th><th>Fornecedor</th><th className="text-right">Previsto</th><th className="text-right">Realizado (categoria)</th><th>Status</th>{podeEditar && <th></th>}</tr></thead>
            <tbody>{q.data.rows.map(p => {
              const real = p.plano_conta_id ? q.data!.realPorPlano[p.plano_conta_id] : undefined
              return (
                <tr key={p.id} className={p.status === 'cancelada' ? 'opacity-50 line-through' : ''}>
                  <td className="num whitespace-nowrap">{p.data_prevista ? fmtDate(p.data_prevista) : <span className="text-muted">no mês</span>}</td>
                  <td><div className="font-bold flex items-center gap-1">{p.descricao}{p.recorrente && <Repeat size={12} className="text-brand" />}</div>{p.observacao && <div className="text-xs text-muted">{p.observacao}</div>}</td>
                  <td className="text-muted">{p.plano_contas ? `${p.plano_contas.codigo} ${p.plano_contas.nome}` : '—'}</td>
                  <td className="text-muted">{p.fornecedores?.nome ?? '—'}</td>
                  <td className="text-right"><MoneyCell v={Number(p.valor)} tipo={p.tipo} /></td>
                  <td className={`text-right num ${real != null && real > Number(p.valor) ? 'text-neg font-bold' : 'text-muted'}`}>{real != null ? brl(real) : '—'}</td>
                  <td><Badge tone={p.status === 'realizada' ? 'green' : p.status === 'cancelada' ? 'gray' : 'amber'}>{p.status}</Badge></td>
                  {podeEditar && <td className="text-right whitespace-nowrap">
                    {p.status === 'prevista' && <button className="btn btn-ghost p-1.5 text-pos" title="Marcar como realizada" onClick={() => marcar(p, 'realizada')}><CheckCircle2 size={15} /></button>}
                    <button className="btn btn-ghost p-1.5" onClick={() => setModal({ id: p.id, form: { competencia: p.competencia, data_prevista: p.data_prevista ?? '', descricao: p.descricao, plano_conta_id: p.plano_conta_id ?? '', fornecedor_id: p.fornecedor_id ?? '', tipo: p.tipo, valor: String(p.valor), recorrente: p.recorrente, observacao: p.observacao ?? '' } })}><Pencil size={15} /></button>
                    <button className="btn btn-ghost p-1.5 text-neg" onClick={() => excluir(p)}><Trash2 size={15} /></button>
                  </td>}
                </tr>
              )
            })}</tbody>
          </table>
        </div>
      )}

      <Modal open={!!modal} onClose={() => setModal(null)} title={modal?.id ? 'Editar projeção' : 'Nova projeção'}>
        {modal && <form onSubmit={salvar} className="grid grid-cols-2 gap-3">
          <Field label="Tipo" className="col-span-2"><div className="grid grid-cols-2 gap-2">{(['despesa', 'receita'] as const).map(t => <button type="button" key={t} className={`btn justify-center ${modal.form.tipo === t ? 'btn-primary' : ''}`} onClick={() => setModal({ ...modal, form: { ...modal.form, tipo: t, plano_conta_id: '' } })}>{t === 'despesa' ? 'Gasto previsto' : 'Receita prevista'}</button>)}</div></Field>
          <Field label="Mês de competência"><input type="month" className="input" required value={modal.form.competencia.slice(0, 7)} onChange={e => setModal({ ...modal, form: { ...modal.form, competencia: `${e.target.value}-01` } })} /></Field>
          <Field label="Data prevista (opcional)"><input type="date" className="input" value={modal.form.data_prevista} onChange={e => setModal({ ...modal, form: { ...modal.form, data_prevista: e.target.value } })} /></Field>
          <Field label="Descrição" className="col-span-2"><input className="input" required value={modal.form.descricao} onChange={e => setModal({ ...modal, form: { ...modal.form, descricao: e.target.value } })} /></Field>
          <Field label="Valor (R$)"><input className="input num" required inputMode="decimal" value={modal.form.valor} onChange={e => setModal({ ...modal, form: { ...modal.form, valor: e.target.value } })} /></Field>
          <Field label="Categoria"><select className="input" value={modal.form.plano_conta_id} onChange={e => setModal({ ...modal, form: { ...modal.form, plano_conta_id: e.target.value } })}><option value="">—</option>{folhas.filter(p => p.tipo === modal.form.tipo || (modal.form.tipo === 'despesa' && p.tipo === 'investimento')).map(p => <option key={p.id} value={p.id}>{p.codigo} {p.nome}</option>)}</select></Field>
          <Field label="Fornecedor" className="col-span-2"><select className="input" value={modal.form.fornecedor_id} onChange={e => { const f = aux.data?.forn.find(x => x.id === e.target.value); setModal({ ...modal, form: { ...modal.form, fornecedor_id: e.target.value, plano_conta_id: modal.form.plano_conta_id || f?.plano_conta_id || '' } }) }}><option value="">—</option>{aux.data?.forn.map(f => <option key={f.id} value={f.id}>{f.nome}</option>)}</select></Field>
          <label className="col-span-2 text-sm flex items-center gap-2"><input type="checkbox" checked={modal.form.recorrente} onChange={e => setModal({ ...modal, form: { ...modal.form, recorrente: e.target.checked } })} /> Recorrente (repete todo mês)</label>
          <Field label="Observação" className="col-span-2"><textarea className="input" rows={2} value={modal.form.observacao} onChange={e => setModal({ ...modal, form: { ...modal.form, observacao: e.target.value } })} /></Field>
          <div className="col-span-2"><ErrorBox msg={err} /></div>
          <div className="col-span-2 flex justify-end gap-2"><button type="button" className="btn" onClick={() => setModal(null)}>Cancelar</button><button className="btn btn-primary">Salvar</button></div>
        </form>}
      </Modal>
    </div>
  )
}
