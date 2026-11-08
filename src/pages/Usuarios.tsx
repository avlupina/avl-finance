import { useState, type FormEvent } from 'react'
import { Plus, Pencil, Trash2, Shield, UserCheck, Clock } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { MODULOS, useAuth, type Papel } from '../hooks/useAuth'
import { useQuery } from '../hooks/useQuery'
import { Badge, ErrorBox, Field, Loading, Modal, PageHeader } from '../components/ui'
import { fmtDateTime, PAPEL_LABEL } from '../lib/format'
import type { Membro } from '../lib/types'

type Perm = 'ver' | 'editar' | 'nenhum'
const PAPEIS: { k: Papel; d: string }[] = [
  { k: 'admin', d: 'Acesso total, incluindo gestão de usuários e integrações.' },
  { k: 'editor', d: 'Lança e edita dados nos módulos liberados abaixo.' },
  { k: 'leitor', d: 'Apenas consulta nos módulos liberados abaixo.' },
]
const emptyForm = () => ({ email: '', papel: 'leitor' as Papel, permissoes: Object.fromEntries(MODULOS.filter(m => m.key !== 'usuarios').map(m => [m.key, 'ver'])) as Record<string, Perm>, ativo: true })

export default function Usuarios() {
  const { workspace, isAdmin, user } = useAuth()
  const ws = workspace!.id
  const q = useQuery(async () => {
    const { data, error } = await supabase.from('workspace_members').select('*').eq('workspace_id', ws).order('convidado_em')
    if (error) throw error
    const ids = (data as Membro[]).map(m => m.user_id).filter(Boolean) as string[]
    const { data: profs } = ids.length ? await supabase.from('profiles').select('id, nome').in('id', ids) : { data: [] }
    return { membros: data as Membro[], nomes: Object.fromEntries((profs ?? []).map(p => [p.id, p.nome])) as Record<string, string | null> }
  }, [ws])
  const [modal, setModal] = useState<null | { id?: string; form: ReturnType<typeof emptyForm> }>(null)
  const [err, setErr] = useState<string | null>(null)

  const salvar = async (e: FormEvent) => {
    e.preventDefault(); if (!modal) return; setErr(null)
    const f = modal.form
    const payload = { workspace_id: ws, email: f.email.trim().toLowerCase(), papel: f.papel, permissoes: f.papel === 'admin' ? {} : f.permissoes, ativo: f.ativo }
    const r = modal.id ? await supabase.from('workspace_members').update(payload).eq('id', modal.id) : await supabase.from('workspace_members').insert(payload)
    if (r.error) { setErr(r.error.message.includes('unique') ? 'Este e-mail já foi convidado.' : r.error.message); return }
    setModal(null); q.refetch()
  }
  const remover = async (m: Membro) => {
    if (m.papel === 'owner') return
    if (!confirm(`Remover o acesso de ${m.email}?`)) return
    const { error } = await supabase.from('workspace_members').delete().eq('id', m.id); if (error) alert(error.message); else q.refetch()
  }

  if (!isAdmin) return <div className="card p-8 text-center text-muted">Somente administradores podem gerenciar usuários.</div>

  return (
    <div>
      <PageHeader title="Usuários" actions={<button className="btn btn-primary" onClick={() => setModal({ form: emptyForm() })}><Plus size={16} /> Convidar usuário</button>} />
      <div className="card p-4 mb-4 text-sm text-ink/80 flex gap-3">
        <Shield className="text-brand shrink-0" />
        <div><b>Como funciona o acesso:</b> você convida pelo e-mail e define o papel (alçada) e as permissões por módulo. Quando a pessoa criar a conta no AVL Finance com esse mesmo e-mail, o acesso é vinculado automaticamente. O proprietário sempre tem acesso total e não pode ser removido.</div>
      </div>
      {q.loading ? <Loading /> : <ErrorBox msg={q.error} />}
      {q.data && (
        <div className="card overflow-x-auto">
          <table className="tbl">
            <thead><tr><th>Usuário</th><th>Papel / alçada</th><th>Permissões</th><th>Situação</th><th>Convidado em</th><th></th></tr></thead>
            <tbody>
              {q.data.membros.map(m => (
                <tr key={m.id} className={!m.ativo ? 'opacity-50' : ''}>
                  <td><div className="font-bold">{m.user_id ? (q.data!.nomes[m.user_id] ?? m.email) : m.email}</div><div className="text-xs text-muted">{m.email}{m.user_id === user?.id ? ' (você)' : ''}</div></td>
                  <td><Badge tone={m.papel === 'owner' ? 'blue' : m.papel === 'admin' ? 'green' : m.papel === 'editor' ? 'amber' : 'gray'}>{PAPEL_LABEL[m.papel]}</Badge></td>
                  <td className="text-xs text-muted max-w-xs">
                    {m.papel === 'owner' || m.papel === 'admin' ? 'Todos os módulos' : MODULOS.filter(x => x.key !== 'usuarios').map(x => { const p = (m.permissoes?.[x.key] as Perm | undefined) ?? (m.papel === 'editor' ? 'editar' : 'ver'); return p === 'nenhum' ? null : <span key={x.key} className="inline-block mr-1 mb-1 px-1.5 py-0.5 rounded bg-surface">{x.label}{p === 'editar' ? ' ✎' : ''}</span> })}
                  </td>
                  <td>{m.user_id ? <Badge tone="green"><UserCheck size={12} /> ativo</Badge> : <Badge tone="amber"><Clock size={12} /> aguardando cadastro</Badge>}</td>
                  <td className="num text-muted whitespace-nowrap">{fmtDateTime(m.convidado_em)}</td>
                  <td className="text-right whitespace-nowrap">
                    {m.papel !== 'owner' && <>
                      <button className="btn btn-ghost p-1.5" onClick={() => setModal({ id: m.id, form: { email: m.email, papel: m.papel, permissoes: { ...emptyForm().permissoes, ...(m.permissoes as Record<string, Perm>) }, ativo: m.ativo } })}><Pencil size={15} /></button>
                      <button className="btn btn-ghost p-1.5 text-neg" onClick={() => remover(m)}><Trash2 size={15} /></button>
                    </>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={!!modal} onClose={() => setModal(null)} title={modal?.id ? 'Editar acesso' : 'Convidar usuário'} wide>
        {modal && <form onSubmit={salvar} className="flex flex-col gap-4">
          <Field label="E-mail"><input className="input" type="email" required value={modal.form.email} disabled={!!modal.id} onChange={e => setModal({ ...modal, form: { ...modal.form, email: e.target.value } })} /></Field>
          <div>
            <label className="label">Papel (alçada)</label>
            <div className="grid md:grid-cols-3 gap-2">
              {PAPEIS.map(p => (
                <button type="button" key={p.k} onClick={() => setModal({ ...modal, form: { ...modal.form, papel: p.k } })} className={`text-left p-3 rounded-lg border ${modal.form.papel === p.k ? 'border-brand bg-brand-soft' : 'border-line hover:bg-surface'}`}>
                  <div className="font-bold">{PAPEL_LABEL[p.k]}</div><div className="text-xs text-muted">{p.d}</div>
                </button>
              ))}
            </div>
          </div>
          {modal.form.papel !== 'admin' && (
            <div>
              <label className="label">Permissões por módulo</label>
              <div className="card overflow-hidden">
                <table className="tbl">
                  <thead><tr><th>Módulo</th><th className="text-center">Sem acesso</th><th className="text-center">Consultar</th>{modal.form.papel === 'editor' && <th className="text-center">Editar</th>}</tr></thead>
                  <tbody>
                    {MODULOS.filter(m => m.key !== 'usuarios').map(m => {
                      const v = modal.form.permissoes[m.key] ?? 'ver'
                      const set = (p: Perm) => setModal({ ...modal, form: { ...modal.form, permissoes: { ...modal.form.permissoes, [m.key]: p } } })
                      return <tr key={m.key}><td className="font-bold">{m.label}</td>
                        <td className="text-center"><input type="radio" name={m.key} checked={v === 'nenhum'} onChange={() => set('nenhum')} /></td>
                        <td className="text-center"><input type="radio" name={m.key} checked={v === 'ver'} onChange={() => set('ver')} /></td>
                        {modal.form.papel === 'editor' && <td className="text-center"><input type="radio" name={m.key} checked={v === 'editar'} onChange={() => set('editar')} /></td>}
                      </tr>
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          <label className="text-sm flex items-center gap-2"><input type="checkbox" checked={modal.form.ativo} onChange={e => setModal({ ...modal, form: { ...modal.form, ativo: e.target.checked } })} /> Acesso ativo</label>
          <ErrorBox msg={err} />
          <div className="flex justify-end gap-2"><button type="button" className="btn" onClick={() => setModal(null)}>Cancelar</button><button className="btn btn-primary">Salvar</button></div>
        </form>}
      </Modal>
    </div>
  )
}
