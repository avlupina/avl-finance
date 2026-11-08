import { useMemo, useState, type FormEvent } from 'react'
import { Plus, Pencil, Trash2, ChevronRight, Wand2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useQuery } from '../hooks/useQuery'
import { Badge, ErrorBox, Field, Loading, Modal, PageHeader, Tabs } from '../components/ui'
import type { Banco, Fornecedor, PlanoConta } from '../lib/types'

type Tab = 'plano' | 'bancos' | 'fornecedores' | 'mapeamento'
const TIPO_PLANO = { receita: 'Receita', despesa: 'Despesa', investimento: 'Investimento', transferencia: 'Transferência' }

export default function Cadastros() {
  const [tab, setTab] = useState<Tab>('plano')
  return (
    <div>
      <PageHeader title="Cadastros">
        <Tabs tabs={[{ key: 'plano', label: 'Plano de Contas' }, { key: 'bancos', label: 'Bancos' }, { key: 'fornecedores', label: 'Fornecedores' }, { key: 'mapeamento', label: 'Categorias do Agregador' }]} value={tab} onChange={setTab} />
      </PageHeader>
      {tab === 'plano' ? <PlanoContas /> : tab === 'bancos' ? <Bancos /> : tab === 'fornecedores' ? <Fornecedores /> : <Mapeamento />}
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

/* ---------------- Mapeamento de categorias do agregador ---------------- */
interface Map { id?: string; categoria_origem: string; plano_conta_id: string | null; tipo_override: 'receita' | 'despesa' | 'transferencia' | null; qtd: number; sem_categoria: number }
function Mapeamento() {
  const { workspace, canEditModule } = useAuth()
  const ws = workspace!.id
  const podeEditar = canEditModule('cadastros')
  const [msg, setMsg] = useState<string | null>(null)
  const q = useQuery(async () => {
    const [m, p, l] = await Promise.all([
      supabase.from('categoria_mapeamentos').select('*').eq('workspace_id', ws),
      supabase.from('plano_contas').select('*').eq('workspace_id', ws).eq('ativo', true).order('codigo'),
      supabase.from('lancamentos').select('categoria_origem, plano_conta_id').eq('workspace_id', ws).neq('origem', 'manual').not('categoria_origem', 'is', null).limit(50000),
    ])
    const planos = (p.data ?? []) as PlanoConta[]
    const stats: Record<string, { qtd: number; sem: number }> = {}
    for (const r of (l.data ?? []) as { categoria_origem: string; plano_conta_id: string | null }[]) { stats[r.categoria_origem] ??= { qtd: 0, sem: 0 }; stats[r.categoria_origem].qtd++; if (!r.plano_conta_id) stats[r.categoria_origem].sem++ }
    const maps = (m.data ?? []) as { id: string; categoria_origem: string; plano_conta_id: string | null; tipo_override: Map['tipo_override'] }[]
    const cats = new Set([...Object.keys(stats), ...maps.map(x => x.categoria_origem)])
    const rows: Map[] = [...cats].map(c => { const mm = maps.find(x => x.categoria_origem === c); return { id: mm?.id, categoria_origem: c, plano_conta_id: mm?.plano_conta_id ?? null, tipo_override: mm?.tipo_override ?? null, qtd: stats[c]?.qtd ?? 0, sem_categoria: stats[c]?.sem ?? 0 } })
    rows.sort((a, b) => (b.sem_categoria - a.sem_categoria) || (b.qtd - a.qtd))
    return { rows, planos }
  }, [ws])

  const salvar = async (r: Map, patch: Partial<Map>) => {
    const payload = { workspace_id: ws, provedor: 'pluggy', categoria_origem: r.categoria_origem, plano_conta_id: patch.plano_conta_id !== undefined ? patch.plano_conta_id : r.plano_conta_id, tipo_override: patch.tipo_override !== undefined ? patch.tipo_override : r.tipo_override }
    const { error } = await supabase.from('categoria_mapeamentos').upsert(payload, { onConflict: 'workspace_id,provedor,categoria_origem' })
    if (error) alert(error.message); else q.refetch()
  }
  const aplicar = async () => {
    setMsg(null)
    const { data, error } = await supabase.rpc('aplicar_mapeamento', { ws })
    if (error) alert(error.message); else { setMsg(`${data ?? 0} lançamento(s) categorizados.`); q.refetch() }
  }

  if (q.loading) return <Loading />
  const folhas = (q.data?.planos ?? []).filter(p => p.parent_id)
  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-between items-start gap-4 flex-wrap">
        <p className="text-sm text-muted max-w-2xl">Cada categoria enviada pelo agregador (Pluggy) é traduzida para uma conta do seu plano. Lançamentos importados sem mapeamento ficam marcados como "sem categoria" até você classificá-los aqui ou em Lançamentos. Marque como <b>transferência</b> o que não é receita nem despesa (pagamento de fatura, movimentação entre contas próprias).</p>
        {podeEditar && <button className="btn btn-primary" onClick={aplicar}><Wand2 size={16} /> Aplicar aos lançamentos sem categoria</button>}
      </div>
      {msg && <div className="rounded-lg border border-green-200 bg-green-50 text-green-800 px-3 py-2 text-sm">{msg}</div>}
      <div className="card overflow-x-auto">
        <table className="tbl">
          <thead><tr><th>Categoria do agregador</th><th className="text-right">Lançamentos</th><th className="text-right">Sem categoria</th><th>Conta do plano</th><th>Tratar como</th></tr></thead>
          <tbody>
            {(q.data?.rows ?? []).map(r => (
              <tr key={r.categoria_origem} className={r.sem_categoria ? 'bg-amber-50/50' : ''}>
                <td className="font-bold">{r.categoria_origem}</td>
                <td className="text-right num">{r.qtd}</td>
                <td className={`text-right num ${r.sem_categoria ? 'text-amber-700 font-bold' : 'text-muted'}`}>{r.sem_categoria}</td>
                <td>
                  <select className="input py-1 text-xs max-w-[280px]" disabled={!podeEditar} value={r.plano_conta_id ?? ''} onChange={e => salvar(r, { plano_conta_id: e.target.value || null })}>
                    <option value="">— não mapear —</option>
                    {folhas.map(p => <option key={p.id} value={p.id}>{p.codigo} {p.nome}</option>)}
                  </select>
                </td>
                <td>
                  <select className="input py-1 text-xs" disabled={!podeEditar} value={r.tipo_override ?? ''} onChange={e => salvar(r, { tipo_override: (e.target.value || null) as Map['tipo_override'] })}>
                    <option value="">Como veio do banco</option><option value="transferencia">Transferência</option><option value="despesa">Despesa</option><option value="receita">Receita</option>
                  </select>
                </td>
              </tr>
            ))}
            {!q.data?.rows.length && <tr><td colSpan={5} className="text-muted">Nenhuma categoria importada ainda — conecte uma instituição em Integrações.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/* ---------------- Fornecedores ---------------- */
function Fornecedores() {
  const { workspace, canEditModule } = useAuth()
  const ws = workspace!.id
  const podeEditar = canEditModule('cadastros')
  const [msg, setMsg] = useState<string | null>(null)
  const q = useQuery(async () => {
    const [f, p, l] = await Promise.all([
      supabase.from('fornecedores').select('*, plano_contas(codigo, nome)').eq('workspace_id', ws).order('nome'),
      supabase.from('plano_contas').select('*').eq('workspace_id', ws).eq('ativo', true).order('codigo'),
      supabase.from('lancamentos').select('fornecedor_id').eq('workspace_id', ws).not('fornecedor_id', 'is', null).limit(50000),
    ])
    if (f.error) throw f.error
    const uso: Record<string, number> = {}; for (const r of (l.data ?? []) as { fornecedor_id: string }[]) uso[r.fornecedor_id] = (uso[r.fornecedor_id] ?? 0) + 1
    return { forn: f.data as (Fornecedor & { plano_contas?: { codigo: string; nome: string } | null })[], planos: (p.data ?? []) as PlanoConta[], uso }
  }, [ws])
  const empty = () => ({ nome: '', documento: '', plano_conta_id: '', padrao_descricao: '', tipo_padrao: '' as '' | 'receita' | 'despesa' | 'transferencia', observacao: '', ativo: true })
  const [modal, setModal] = useState<null | { id?: string; form: ReturnType<typeof empty> }>(null)
  const [err, setErr] = useState<string | null>(null)

  const salvar = async (e: FormEvent) => {
    e.preventDefault(); if (!modal) return; setErr(null)
    const f = modal.form
    const payload = { workspace_id: ws, nome: f.nome.trim(), documento: f.documento || null, plano_conta_id: f.plano_conta_id || null, padrao_descricao: f.padrao_descricao.trim() || null, tipo_padrao: f.tipo_padrao || null, observacao: f.observacao || null, ativo: f.ativo }
    const r = modal.id ? await supabase.from('fornecedores').update(payload).eq('id', modal.id) : await supabase.from('fornecedores').insert(payload)
    if (r.error) { setErr(r.error.message.includes('unique') ? 'Já existe um fornecedor com este nome.' : r.error.message); return }
    setModal(null); q.refetch()
  }
  const excluir = async (f: Fornecedor) => { if (!confirm(`Excluir "${f.nome}"?`)) return; const { error } = await supabase.from('fornecedores').delete().eq('id', f.id); if (error) alert(error.message); else q.refetch() }
  const aplicar = async () => { const { data, error } = await supabase.rpc('aplicar_fornecedores', { ws }); if (error) alert(error.message); else { setMsg(`${data ?? 0} lançamento(s) vinculados/categorizados.`); q.refetch() } }

  if (q.loading) return <Loading />
  const folhas = (q.data?.planos ?? []).filter(p => p.parent_id)
  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-between items-start gap-4 flex-wrap">
        <p className="text-sm text-muted max-w-2xl">Fornecedores, estabelecimentos e favorecidos recorrentes, cada um vinculado a uma conta do plano. O <b>padrão de descrição</b> (ex.: "NETFLIX", "PIX JOAO") faz a categorização automática dos lançamentos importados que contenham esse texto — inclusive PIX e boletos que o agregador não classifica.</p>
        {podeEditar && <div className="flex gap-2"><button className="btn" onClick={aplicar}><Wand2 size={16} /> Aplicar regras</button><button className="btn btn-primary" onClick={() => setModal({ form: empty() })}><Plus size={16} /> Novo fornecedor</button></div>}
      </div>
      {msg && <div className="rounded-lg border border-green-200 bg-green-50 text-green-800 px-3 py-2 text-sm">{msg}</div>}
      <div className="card overflow-x-auto">
        <table className="tbl">
          <thead><tr><th>Fornecedor</th><th>CPF/CNPJ</th><th>Conta do plano</th><th>Padrão na descrição</th><th>Tratar como</th><th className="text-right">Lançamentos</th><th>Status</th>{podeEditar && <th></th>}</tr></thead>
          <tbody>
            {(q.data?.forn ?? []).map(f => (
              <tr key={f.id} className={!f.ativo ? 'opacity-50' : ''}>
                <td><div className="font-bold">{f.nome}</div>{f.observacao && <div className="text-xs text-muted">{f.observacao}</div>}</td>
                <td className="num text-muted">{f.documento ?? '—'}</td>
                <td>{f.plano_contas ? `${f.plano_contas.codigo} ${f.plano_contas.nome}` : <span className="text-muted">—</span>}</td>
                <td>{f.padrao_descricao ? <code className="text-xs bg-surface px-1.5 py-0.5 rounded">{f.padrao_descricao}</code> : <span className="text-muted">—</span>}</td>
                <td className="text-muted text-xs">{f.tipo_padrao ?? 'como veio'}</td>
                <td className="text-right num">{q.data?.uso[f.id] ?? 0}</td>
                <td><Badge tone={f.ativo ? 'green' : 'gray'}>{f.ativo ? 'ativo' : 'inativo'}</Badge></td>
                {podeEditar && <td className="text-right whitespace-nowrap">
                  <button className="btn btn-ghost p-1.5" onClick={() => setModal({ id: f.id, form: { nome: f.nome, documento: f.documento ?? '', plano_conta_id: f.plano_conta_id ?? '', padrao_descricao: f.padrao_descricao ?? '', tipo_padrao: f.tipo_padrao ?? '', observacao: f.observacao ?? '', ativo: f.ativo } })}><Pencil size={15} /></button>
                  <button className="btn btn-ghost p-1.5 text-neg" onClick={() => excluir(f)}><Trash2 size={15} /></button>
                </td>}
              </tr>
            ))}
            {!q.data?.forn.length && <tr><td colSpan={8} className="text-muted">Nenhum fornecedor cadastrado.</td></tr>}
          </tbody>
        </table>
      </div>
      <Modal open={!!modal} onClose={() => setModal(null)} title={modal?.id ? 'Editar fornecedor' : 'Novo fornecedor'}>
        {modal && <form onSubmit={salvar} className="grid grid-cols-2 gap-3">
          <Field label="Nome" className="col-span-2"><input className="input" required value={modal.form.nome} onChange={e => setModal({ ...modal, form: { ...modal.form, nome: e.target.value } })} /></Field>
          <Field label="CPF/CNPJ"><input className="input" value={modal.form.documento} onChange={e => setModal({ ...modal, form: { ...modal.form, documento: e.target.value } })} /></Field>
          <Field label="Tratar lançamentos como"><select className="input" value={modal.form.tipo_padrao} onChange={e => setModal({ ...modal, form: { ...modal.form, tipo_padrao: e.target.value as typeof modal.form.tipo_padrao } })}><option value="">Como veio do banco</option><option value="despesa">Despesa</option><option value="receita">Receita</option><option value="transferencia">Transferência</option></select></Field>
          <Field label="Conta do plano (categoria padrão)" className="col-span-2"><select className="input" value={modal.form.plano_conta_id} onChange={e => setModal({ ...modal, form: { ...modal.form, plano_conta_id: e.target.value } })}><option value="">—</option>{folhas.map(p => <option key={p.id} value={p.id}>{p.codigo} {p.nome}</option>)}</select></Field>
          <Field label="Padrão na descrição do extrato" className="col-span-2"><input className="input" placeholder='ex.: "NETFLIX" ou "PIX ENVIADO MARIA"' value={modal.form.padrao_descricao} onChange={e => setModal({ ...modal, form: { ...modal.form, padrao_descricao: e.target.value } })} /><div className="text-[11px] text-muted mt-1">Sem diferenciar maiúsculas. Mínimo 3 caracteres. Aplicado aos lançamentos importados.</div></Field>
          <Field label="Observação" className="col-span-2"><input className="input" value={modal.form.observacao} onChange={e => setModal({ ...modal, form: { ...modal.form, observacao: e.target.value } })} /></Field>
          <label className="col-span-2 text-sm flex items-center gap-2"><input type="checkbox" checked={modal.form.ativo} onChange={e => setModal({ ...modal, form: { ...modal.form, ativo: e.target.checked } })} /> Ativo</label>
          <div className="col-span-2"><ErrorBox msg={err} /></div>
          <div className="col-span-2 flex justify-end gap-2"><button type="button" className="btn" onClick={() => setModal(null)}>Cancelar</button><button className="btn btn-primary">Salvar</button></div>
        </form>}
      </Modal>
    </div>
  )
}
