import { useMemo, useState, type FormEvent } from 'react'
import { Plus, Pencil, Trash2, ChevronRight } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useQuery } from '../hooks/useQuery'
import { Badge, ErrorBox, Field, Loading, Modal, PageHeader, Tabs } from '../components/ui'
import type { Banco, PlanoConta } from '../lib/types'

type Tab = 'plano' | 'bancos'
const TIPO_PLANO = { receita: 'Receita', despesa: 'Despesa', investimento: 'Investimento', transferencia: 'Transferência' }

export default function Cadastros() {
  const [tab, setTab] = useState<Tab>('plano')
  return (
    <div>
      <PageHeader title="Cadastros">
        <Tabs tabs={[{ key: 'plano', label: 'Plano de Contas' }, { key: 'bancos', label: 'Bancos' }]} value={tab} onChange={setTab} />
      </PageHeader>
      {tab === 'plano' ? <PlanoContas /> : <Bancos />}
    </div>
  )
}

/* ---------------- Plano de contas ---------------- */
function PlanoContas() {
  const { workspace, canEditModule } = useAuth()
  const ws = workspace!.id
  const podeEditar = canEditModule('cadastros')
  const q = useQuery(async () => { const { data, error } = await supabase.from('plano_contas').select('*').eq('workspace_id', ws).order('codigo'); if (error) throw error; return data as PlanoConta[] }, [ws])
  const [modal, setModal] = useState<null | { id?: string; form: { codigo: string; nome: string; tipo: PlanoConta['tipo']; natureza: 'fixa' | 'variavel'; parent_id: string; ativo: boolean } }>(null)
  const [err, setErr] = useState<string | null>(null)
  const raizes = useMemo(() => (q.data ?? []).filter(p => !p.parent_id), [q.data])
  const filhos = (id: string) => (q.data ?? []).filter(p => p.parent_id === id)

  const novo = (parent?: PlanoConta) => {
    const irmaos = parent ? filhos(parent.id) : raizes
    const next = parent ? `${parent.codigo}.${String(irmaos.length + 1).padStart(2, '0')}` : String(raizes.length + 1)
    setModal({ form: { codigo: next, nome: '', tipo: parent?.tipo ?? 'despesa', natureza: 'variavel', parent_id: parent?.id ?? '', ativo: true } })
  }
  const salvar = async (e: FormEvent) => {
    e.preventDefault(); if (!modal) return; setErr(null)
    const f = modal.form
    const payload = { workspace_id: ws, codigo: f.codigo.trim(), nome: f.nome.trim(), tipo: f.tipo, natureza: f.natureza, parent_id: f.parent_id || null, ativo: f.ativo }
    const r = modal.id ? await supabase.from('plano_contas').update(payload).eq('id', modal.id) : await supabase.from('plano_contas').insert(payload)
    if (r.error) { setErr(r.error.message.includes('unique') ? 'Já existe uma conta com este código.' : r.error.message); return }
    setModal(null); q.refetch()
  }
  const excluir = async (p: PlanoConta) => {
    if (!confirm(`Excluir "${p.codigo} ${p.nome}"? Lançamentos vinculados ficarão sem categoria.`)) return
    const { error } = await supabase.from('plano_contas').delete().eq('id', p.id); if (error) alert(error.message); else q.refetch()
  }

  if (q.loading) return <Loading />
  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted">Estrutura hierárquica usada para categorizar lançamentos e montar a DRE pessoal.</p>
        {podeEditar && <button className="btn btn-primary" onClick={() => novo()}><Plus size={16} /> Novo grupo</button>}
      </div>
      <ErrorBox msg={q.error} />
      <div className="grid md:grid-cols-2 gap-4">
        {raizes.map(r => (
          <div key={r.id} className="card">
            <div className="flex items-center justify-between px-4 py-3 border-b border-line bg-surface/60 rounded-t-xl">
              <div className="flex items-center gap-2"><span className="num font-black text-brand">{r.codigo}</span><span className="font-black">{r.nome}</span><Badge tone={r.tipo === 'receita' ? 'green' : r.tipo === 'despesa' ? 'red' : 'blue'}>{TIPO_PLANO[r.tipo]}</Badge></div>
              {podeEditar && <div className="flex gap-1">
                <button className="btn btn-ghost p-1.5" title="Nova subconta" onClick={() => novo(r)}><Plus size={14} /></button>
                <button className="btn btn-ghost p-1.5" onClick={() => setModal({ id: r.id, form: { codigo: r.codigo, nome: r.nome, tipo: r.tipo, natureza: r.natureza ?? 'variavel', parent_id: '', ativo: r.ativo } })}><Pencil size={14} /></button>
              </div>}
            </div>
            <ul>
              {filhos(r.id).map(f => (
                <li key={f.id} className={`flex items-center gap-2 px-4 py-2 border-b border-line/60 last:border-0 text-sm ${!f.ativo ? 'opacity-50' : ''}`}>
                  <ChevronRight size={14} className="text-muted" /><span className="num text-muted w-12">{f.codigo}</span><span className="flex-1 font-bold">{f.nome}</span>
                  <Badge>{f.natureza ?? 'variável'}</Badge>
                  {podeEditar && <>
                    <button className="btn btn-ghost p-1" onClick={() => setModal({ id: f.id, form: { codigo: f.codigo, nome: f.nome, tipo: f.tipo, natureza: f.natureza ?? 'variavel', parent_id: f.parent_id ?? '', ativo: f.ativo } })}><Pencil size={13} /></button>
                    <button className="btn btn-ghost p-1 text-neg" onClick={() => excluir(f)}><Trash2 size={13} /></button>
                  </>}
                </li>
              ))}
              {!filhos(r.id).length && <li className="px-4 py-3 text-sm text-muted">Sem subcontas.</li>}
            </ul>
          </div>
        ))}
      </div>

      <Modal open={!!modal} onClose={() => setModal(null)} title={modal?.id ? 'Editar conta do plano' : 'Nova conta do plano'}>
        {modal && <form onSubmit={salvar} className="grid grid-cols-2 gap-3">
          <Field label="Código"><input className="input num" required value={modal.form.codigo} onChange={e => setModal({ ...modal, form: { ...modal.form, codigo: e.target.value } })} /></Field>
          <Field label="Tipo"><select className="input" value={modal.form.tipo} onChange={e => setModal({ ...modal, form: { ...modal.form, tipo: e.target.value as PlanoConta['tipo'] } })}>{Object.entries(TIPO_PLANO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          <Field label="Nome" className="col-span-2"><input className="input" required value={modal.form.nome} onChange={e => setModal({ ...modal, form: { ...modal.form, nome: e.target.value } })} /></Field>
          <Field label="Grupo (pai)"><select className="input" value={modal.form.parent_id} onChange={e => setModal({ ...modal, form: { ...modal.form, parent_id: e.target.value } })}><option value="">— (grupo raiz)</option>{raizes.filter(r => r.id !== modal.id).map(r => <option key={r.id} value={r.id}>{r.codigo} {r.nome}</option>)}</select></Field>
          <Field label="Natureza"><select className="input" value={modal.form.natureza} onChange={e => setModal({ ...modal, form: { ...modal.form, natureza: e.target.value as 'fixa' | 'variavel' } })}><option value="fixa">Fixa</option><option value="variavel">Variável</option></select></Field>
          <label className="col-span-2 text-sm flex items-center gap-2"><input type="checkbox" checked={modal.form.ativo} onChange={e => setModal({ ...modal, form: { ...modal.form, ativo: e.target.checked } })} /> Ativa</label>
          <div className="col-span-2"><ErrorBox msg={err} /></div>
          <div className="col-span-2 flex justify-end gap-2"><button type="button" className="btn" onClick={() => setModal(null)}>Cancelar</button><button className="btn btn-primary">Salvar</button></div>
        </form>}
      </Modal>
    </div>
  )
}

/* ---------------- Bancos ---------------- */
function Bancos() {
  const { workspace, canEditModule } = useAuth()
  const ws = workspace!.id
  const podeEditar = canEditModule('cadastros')
  const q = useQuery(async () => { const { data, error } = await supabase.from('bancos').select('*').eq('workspace_id', ws).order('nome'); if (error) throw error; return data as Banco[] }, [ws])
  const [modal, setModal] = useState<null | { id?: string; form: { nome: string; codigo_compe: string; ispb: string; cor: string; pluggy_connector_id: string; ativo: boolean } }>(null)
  const [err, setErr] = useState<string | null>(null)

  const salvar = async (e: FormEvent) => {
    e.preventDefault(); if (!modal) return; setErr(null)
    const f = modal.form
    const payload = { workspace_id: ws, nome: f.nome.trim(), codigo_compe: f.codigo_compe || null, ispb: f.ispb || null, cor: f.cor || '#104862', pluggy_connector_id: f.pluggy_connector_id ? Number(f.pluggy_connector_id) : null, ativo: f.ativo }
    const r = modal.id ? await supabase.from('bancos').update(payload).eq('id', modal.id) : await supabase.from('bancos').insert(payload)
    if (r.error) { setErr(r.error.message); return }
    setModal(null); q.refetch()
  }
  const excluir = async (b: Banco) => { if (!confirm(`Excluir "${b.nome}"?`)) return; const { error } = await supabase.from('bancos').delete().eq('id', b.id); if (error) alert(error.message); else q.refetch() }

  if (q.loading) return <Loading />
  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted">Instituições financeiras disponíveis para vincular às contas. O <b>ID do conector Pluggy</b> permite associar automaticamente as contas importadas.</p>
        {podeEditar && <button className="btn btn-primary" onClick={() => setModal({ form: { nome: '', codigo_compe: '', ispb: '', cor: '#104862', pluggy_connector_id: '', ativo: true } })}><Plus size={16} /> Novo banco</button>}
      </div>
      <div className="card overflow-x-auto">
        <table className="tbl">
          <thead><tr><th></th><th>Banco</th><th>COMPE</th><th>ISPB</th><th>Conector Pluggy</th><th>Status</th>{podeEditar && <th></th>}</tr></thead>
          <tbody>
            {(q.data ?? []).map(b => (
              <tr key={b.id} className={!b.ativo ? 'opacity-50' : ''}>
                <td><span className="inline-block w-5 h-5 rounded-md border border-line" style={{ background: b.cor ?? '#104862' }} /></td>
                <td className="font-bold">{b.nome}</td>
                <td className="num">{b.codigo_compe ?? '—'}</td>
                <td className="num text-muted">{b.ispb ?? '—'}</td>
                <td className="num">{b.pluggy_connector_id ?? <span className="text-muted">—</span>}</td>
                <td><Badge tone={b.ativo ? 'green' : 'gray'}>{b.ativo ? 'ativo' : 'inativo'}</Badge></td>
                {podeEditar && <td className="text-right whitespace-nowrap">
                  <button className="btn btn-ghost p-1.5" onClick={() => setModal({ id: b.id, form: { nome: b.nome, codigo_compe: b.codigo_compe ?? '', ispb: b.ispb ?? '', cor: b.cor ?? '#104862', pluggy_connector_id: b.pluggy_connector_id ? String(b.pluggy_connector_id) : '', ativo: b.ativo } })}><Pencil size={15} /></button>
                  <button className="btn btn-ghost p-1.5 text-neg" onClick={() => excluir(b)}><Trash2 size={15} /></button>
                </td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Modal open={!!modal} onClose={() => setModal(null)} title={modal?.id ? 'Editar banco' : 'Novo banco'}>
        {modal && <form onSubmit={salvar} className="grid grid-cols-2 gap-3">
          <Field label="Nome" className="col-span-2"><input className="input" required value={modal.form.nome} onChange={e => setModal({ ...modal, form: { ...modal.form, nome: e.target.value } })} /></Field>
          <Field label="Código COMPE"><input className="input" value={modal.form.codigo_compe} onChange={e => setModal({ ...modal, form: { ...modal.form, codigo_compe: e.target.value } })} /></Field>
          <Field label="ISPB"><input className="input" value={modal.form.ispb} onChange={e => setModal({ ...modal, form: { ...modal.form, ispb: e.target.value } })} /></Field>
          <Field label="Cor"><input className="input h-10 p-1" type="color" value={modal.form.cor} onChange={e => setModal({ ...modal, form: { ...modal.form, cor: e.target.value } })} /></Field>
          <Field label="ID conector Pluggy"><input className="input num" value={modal.form.pluggy_connector_id} onChange={e => setModal({ ...modal, form: { ...modal.form, pluggy_connector_id: e.target.value } })} /></Field>
          <label className="col-span-2 text-sm flex items-center gap-2"><input type="checkbox" checked={modal.form.ativo} onChange={e => setModal({ ...modal, form: { ...modal.form, ativo: e.target.checked } })} /> Ativo</label>
          <div className="col-span-2"><ErrorBox msg={err} /></div>
          <div className="col-span-2 flex justify-end gap-2"><button type="button" className="btn" onClick={() => setModal(null)}>Cancelar</button><button className="btn btn-primary">Salvar</button></div>
        </form>}
      </Modal>
    </div>
  )
}
