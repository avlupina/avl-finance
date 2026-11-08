import { useMemo, useState, type FormEvent } from 'react'
import { Plus, Download, Printer, Pencil, Trash2, Filter } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useQuery } from '../hooks/useQuery'
import { Badge, Empty, ErrorBox, Field, Kpi, Loading, Modal, MoneyCell, PageHeader } from '../components/ui'
import { brl, downloadCSV, firstDayOfMonth, fmtDate, todayISO } from '../lib/format'
import type { Conta, Lancamento, PlanoConta } from '../lib/types'

const TIPOS = [{ k: 'receita', l: 'Receita' }, { k: 'despesa', l: 'Despesa' }, { k: 'transferencia', l: 'Transferência' }] as const
const empty = () => ({ data: todayISO(), descricao: '', valor: '', tipo: 'despesa' as Lancamento['tipo'], conta_id: '', conta_destino_id: '', plano_conta_id: '', status: 'efetivado' as Lancamento['status'], observacao: '' })

export default function Lancamentos() {
  const { workspace, canEditModule, user } = useAuth()
  const ws = workspace!.id
  const podeEditar = canEditModule('lancamentos')
  const [ini, setIni] = useState(firstDayOfMonth())
  const [fim, setFim] = useState(todayISO())
  const [tipo, setTipo] = useState('')
  const [contaF, setContaF] = useState('')
  const [planoF, setPlanoF] = useState('')
  const [busca, setBusca] = useState('')
  const [modal, setModal] = useState<null | { id?: string; form: ReturnType<typeof empty> }>(null)
  const [err, setErr] = useState<string | null>(null)

  const aux = useQuery(async () => {
    const [c, p] = await Promise.all([
      supabase.from('contas').select('*').eq('workspace_id', ws).eq('ativa', true).order('nome'),
      supabase.from('plano_contas').select('*').eq('workspace_id', ws).eq('ativo', true).order('codigo'),
    ])
    return { contas: (c.data ?? []) as Conta[], planos: (p.data ?? []) as PlanoConta[] }
  }, [ws])

  const q = useQuery(async () => {
    let qb = supabase.from('lancamentos').select('*, contas:conta_id(nome), plano_contas(nome, codigo)').eq('workspace_id', ws).gte('data', ini).lte('data', fim).order('data', { ascending: false }).order('created_at', { ascending: false }).limit(2000)
    if (tipo) qb = qb.eq('tipo', tipo)
    if (contaF) qb = qb.eq('conta_id', contaF)
    if (planoF) qb = qb.eq('plano_conta_id', planoF)
    const { data, error } = await qb
    if (error) throw error
    return data as Lancamento[]
  }, [ws, ini, fim, tipo, contaF, planoF])

  const rows = useMemo(() => (q.data ?? []).filter(l => !busca || l.descricao.toLowerCase().includes(busca.toLowerCase()) || (l.categoria_origem ?? '').toLowerCase().includes(busca.toLowerCase())), [q.data, busca])
  const tot = useMemo(() => rows.reduce((a, l) => { if (l.status === 'pendente') return a; if (l.tipo === 'receita') a.r += Number(l.valor); else if (l.tipo === 'despesa') a.d += Number(l.valor); return a }, { r: 0, d: 0 }), [rows])
  const semCategoria = rows.filter(r => !r.plano_conta_id).length

  const planosFolha = (t?: string) => (aux.data?.planos ?? []).filter(p => p.parent_id && (!t || p.tipo === t || (t === 'transferencia' && p.tipo === 'transferencia') || (t === 'despesa' && p.tipo === 'investimento')))

  const salvar = async (e: FormEvent) => {
    e.preventDefault(); if (!modal) return; setErr(null)
    const f = modal.form
    const payload = {
      workspace_id: ws, data: f.data, descricao: f.descricao.trim(), valor: Math.abs(Number(String(f.valor).replace(',', '.'))), tipo: f.tipo,
      conta_id: f.conta_id || null, conta_destino_id: f.tipo === 'transferencia' ? (f.conta_destino_id || null) : null,
      plano_conta_id: f.plano_conta_id || null, status: f.status, observacao: f.observacao || null, created_by: user!.id,
    }
    if (!payload.valor) { setErr('Informe um valor válido.'); return }
    const r = modal.id ? await supabase.from('lancamentos').update(payload).eq('id', modal.id) : await supabase.from('lancamentos').insert(payload)
    if (r.error) { setErr(r.error.message); return }
    setModal(null); q.refetch()
  }

  const excluir = async (l: Lancamento) => {
    if (!confirm(`Excluir "${l.descricao}"?`)) return
    const { error } = await supabase.from('lancamentos').delete().eq('id', l.id)
    if (error) alert(error.message); else q.refetch()
  }

  const categorizar = async (l: Lancamento, plano: string) => {
    await supabase.from('lancamentos').update({ plano_conta_id: plano || null }).eq('id', l.id); q.refetch()
  }

  const exportar = () => downloadCSV(`lancamentos_${ini}_${fim}.csv`, rows.map(l => ({
    data: fmtDate(l.data), descricao: l.descricao, tipo: l.tipo, valor: Number(l.valor).toFixed(2).replace('.', ','), conta: l.contas?.nome ?? '', categoria: l.plano_contas ? `${l.plano_contas.codigo} ${l.plano_contas.nome}` : '', status: l.status, origem: l.origem,
  })))

  return (
    <div>
      <PageHeader title="Lançamentos" actions={<>
        <button className="btn" onClick={exportar}><Download size={16} /> Exportar</button>
        <button className="btn" onClick={() => window.print()}><Printer size={16} /> Imprimir</button>
        {podeEditar && <button className="btn btn-primary" onClick={() => setModal({ form: empty() })}><Plus size={16} /> Novo lançamento</button>}
      </>}>
        <div className="card p-3 flex flex-wrap gap-2 items-end no-print">
          <div className="flex items-center gap-1 text-muted text-xs font-bold uppercase pr-2"><Filter size={14} /> Filtros</div>
          <Field label="De"><input type="date" className="input" value={ini} onChange={e => setIni(e.target.value)} /></Field>
          <Field label="Até"><input type="date" className="input" value={fim} onChange={e => setFim(e.target.value)} /></Field>
          <Field label="Tipo"><select className="input" value={tipo} onChange={e => setTipo(e.target.value)}><option value="">Todos</option>{TIPOS.map(t => <option key={t.k} value={t.k}>{t.l}</option>)}</select></Field>
          <Field label="Conta"><select className="input" value={contaF} onChange={e => setContaF(e.target.value)}><option value="">Todas</option>{aux.data?.contas.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}</select></Field>
          <Field label="Categoria"><select className="input" value={planoF} onChange={e => setPlanoF(e.target.value)}><option value="">Todas</option>{planosFolha().map(p => <option key={p.id} value={p.id}>{p.codigo} {p.nome}</option>)}</select></Field>
          <Field label="Buscar" className="flex-1 min-w-[180px]"><input className="input" placeholder="Descrição..." value={busca} onChange={e => setBusca(e.target.value)} /></Field>
        </div>
      </PageHeader>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <Kpi label="Receitas" value={brl(tot.r)} tone="pos" />
        <Kpi label="Despesas" value={brl(tot.d)} tone="neg" />
        <Kpi label="Resultado" value={brl(tot.r - tot.d)} tone={tot.r - tot.d >= 0 ? 'brand' : 'neg'} />
        <Kpi label="Lançamentos" value={String(rows.length)} sub={semCategoria ? <span className="text-amber-700">{semCategoria} sem categoria</span> : 'todos categorizados'} />
      </div>

      {q.loading ? <Loading /> : q.error ? <ErrorBox msg={q.error} /> : !rows.length ? (
        <Empty title="Nenhum lançamento no período" hint="Conecte um banco em Integrações para importar o extrato automaticamente, ou registre manualmente." action={podeEditar && <button className="btn btn-primary" onClick={() => setModal({ form: empty() })}><Plus size={16} /> Novo lançamento</button>} />
      ) : (
        <div className="card overflow-x-auto">
          <table className="tbl">
            <thead><tr><th>Data</th><th>Descrição</th><th>Conta</th><th>Categoria</th><th>Status</th><th className="text-right">Valor</th>{podeEditar && <th className="no-print"></th>}</tr></thead>
            <tbody>
              {rows.map(l => (
                <tr key={l.id}>
                  <td className="num whitespace-nowrap">{fmtDate(l.data)}</td>
                  <td>
                    <div className="font-bold">{l.descricao}</div>
                    {l.origem !== 'manual' && <div className="text-xs text-muted">via {l.origem}{l.categoria_origem ? ` · ${l.categoria_origem}` : ''}</div>}
                  </td>
                  <td className="text-muted">{l.contas?.nome ?? '—'}</td>
                  <td>
                    {podeEditar ? (
                      <select className={`input py-1 text-xs max-w-[220px] ${!l.plano_conta_id ? 'border-amber-300 bg-amber-50' : ''}`} value={l.plano_conta_id ?? ''} onChange={e => categorizar(l, e.target.value)}>
                        <option value="">— categorizar —</option>
                        {planosFolha(l.tipo).map(p => <option key={p.id} value={p.id}>{p.codigo} {p.nome}</option>)}
                      </select>
                    ) : (l.plano_contas ? `${l.plano_contas.codigo} ${l.plano_contas.nome}` : <span className="text-amber-700">Sem categoria</span>)}
                  </td>
                  <td><Badge tone={l.status === 'conciliado' ? 'green' : l.status === 'pendente' ? 'amber' : 'gray'}>{l.status}</Badge></td>
                  <td className="text-right"><MoneyCell v={Number(l.valor)} tipo={l.tipo} /></td>
                  {podeEditar && <td className="no-print whitespace-nowrap text-right">
                    <button className="btn btn-ghost p-1.5" title="Editar" onClick={() => setModal({ id: l.id, form: { data: l.data, descricao: l.descricao, valor: String(l.valor), tipo: l.tipo, conta_id: l.conta_id ?? '', conta_destino_id: l.conta_destino_id ?? '', plano_conta_id: l.plano_conta_id ?? '', status: l.status, observacao: l.observacao ?? '' } })}><Pencil size={15} /></button>
                    <button className="btn btn-ghost p-1.5 text-neg" title="Excluir" onClick={() => excluir(l)}><Trash2 size={15} /></button>
                  </td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={!!modal} onClose={() => setModal(null)} title={modal?.id ? 'Editar lançamento' : 'Novo lançamento'}>
        {modal && <form onSubmit={salvar} className="grid grid-cols-2 gap-3">
          <Field label="Tipo" className="col-span-2">
            <div className="grid grid-cols-3 gap-2">{TIPOS.map(t => <button type="button" key={t.k} className={`btn justify-center ${modal.form.tipo === t.k ? 'btn-primary' : ''}`} onClick={() => setModal({ ...modal, form: { ...modal.form, tipo: t.k, plano_conta_id: '' } })}>{t.l}</button>)}</div>
          </Field>
          <Field label="Data"><input type="date" className="input" required value={modal.form.data} onChange={e => setModal({ ...modal, form: { ...modal.form, data: e.target.value } })} /></Field>
          <Field label="Valor (R$)"><input className="input num" required inputMode="decimal" placeholder="0,00" value={modal.form.valor} onChange={e => setModal({ ...modal, form: { ...modal.form, valor: e.target.value } })} /></Field>
          <Field label="Descrição" className="col-span-2"><input className="input" required value={modal.form.descricao} onChange={e => setModal({ ...modal, form: { ...modal.form, descricao: e.target.value } })} /></Field>
          <Field label={modal.form.tipo === 'transferencia' ? 'Conta de origem' : 'Conta'}><select className="input" value={modal.form.conta_id} onChange={e => setModal({ ...modal, form: { ...modal.form, conta_id: e.target.value } })}><option value="">—</option>{aux.data?.contas.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}</select></Field>
          {modal.form.tipo === 'transferencia'
            ? <Field label="Conta de destino"><select className="input" value={modal.form.conta_destino_id} onChange={e => setModal({ ...modal, form: { ...modal.form, conta_destino_id: e.target.value } })}><option value="">—</option>{aux.data?.contas.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}</select></Field>
            : <Field label="Status"><select className="input" value={modal.form.status} onChange={e => setModal({ ...modal, form: { ...modal.form, status: e.target.value as Lancamento['status'] } })}><option value="efetivado">Efetivado</option><option value="pendente">Pendente</option><option value="conciliado">Conciliado</option></select></Field>}
          <Field label="Categoria (plano de contas)" className="col-span-2"><select className="input" value={modal.form.plano_conta_id} onChange={e => setModal({ ...modal, form: { ...modal.form, plano_conta_id: e.target.value } })}><option value="">—</option>{planosFolha(modal.form.tipo).map(p => <option key={p.id} value={p.id}>{p.codigo} {p.nome}</option>)}</select></Field>
          <Field label="Observação" className="col-span-2"><textarea className="input" rows={2} value={modal.form.observacao} onChange={e => setModal({ ...modal, form: { ...modal.form, observacao: e.target.value } })} /></Field>
          <div className="col-span-2"><ErrorBox msg={err} /></div>
          <div className="col-span-2 flex justify-end gap-2"><button type="button" className="btn" onClick={() => setModal(null)}>Cancelar</button><button className="btn btn-primary">Salvar</button></div>
        </form>}
      </Modal>
    </div>
  )
}
