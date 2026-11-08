import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'

export type Papel = 'owner' | 'admin' | 'editor' | 'leitor'
export type Modulo = 'lancamentos' | 'resultados' | 'analise' | 'investimentos' | 'futuro' | 'patrimonio' | 'contas' | 'integracoes' | 'cadastros' | 'usuarios'
export const MODULOS: { key: Modulo; label: string }[] = [
  { key: 'lancamentos', label: 'Lançamentos' }, { key: 'resultados', label: 'Resultados' },
  { key: 'analise', label: 'Análise' }, { key: 'investimentos', label: 'Investimentos' },
  { key: 'futuro', label: 'Futuro' }, { key: 'patrimonio', label: 'Patrimônio' },
  { key: 'contas', label: 'Contas' }, { key: 'integracoes', label: 'Integrações' },
  { key: 'cadastros', label: 'Cadastros' }, { key: 'usuarios', label: 'Usuários' },
]

export interface Workspace { id: string; nome: string; owner_id: string; moeda: string }
export interface Membership { id: string; workspace_id: string; papel: Papel; permissoes: Record<string, 'ver' | 'editar' | 'nenhum'>; workspaces: Workspace }
export interface Profile { id: string; nome: string | null; email: string | null }

interface AuthCtx {
  session: Session | null
  user: User | null
  profile: Profile | null
  memberships: Membership[]
  workspace: Workspace | null
  membership: Membership | null
  papel: Papel | null
  loading: boolean
  canEdit: boolean
  isAdmin: boolean
  canSee: (m: Modulo) => boolean
  canEditModule: (m: Modulo) => boolean
  setWorkspaceId: (id: string) => void
  refresh: () => Promise<void>
  signOut: () => Promise<void>
}

const Ctx = createContext<AuthCtx | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [memberships, setMemberships] = useState<Membership[]>([])
  const [workspaceId, setWorkspaceIdState] = useState<string | null>(localStorage.getItem('avl.ws'))
  const [loading, setLoading] = useState(true)

  const load = useCallback(async (s: Session | null) => {
    if (!s?.user) { setProfile(null); setMemberships([]); setLoading(false); return }
    const [{ data: p }, { data: m }] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', s.user.id).maybeSingle(),
      supabase.from('workspace_members').select('id, workspace_id, papel, permissoes, workspaces(*)').eq('user_id', s.user.id).eq('ativo', true),
    ])
    setProfile(p as Profile | null)
    const ms = ((m ?? []) as unknown as Membership[]).filter(x => x.workspaces)
    setMemberships(ms)
    setWorkspaceIdState(prev => (prev && ms.some(x => x.workspace_id === prev)) ? prev : (ms[0]?.workspace_id ?? null))
    setLoading(false)
  }, [])

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); load(data.session) })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => { setSession(s); load(s) })
    return () => sub.subscription.unsubscribe()
  }, [load])

  const membership = useMemo(() => memberships.find(m => m.workspace_id === workspaceId) ?? null, [memberships, workspaceId])
  const papel = membership?.papel ?? null
  const isAdmin = papel === 'owner' || papel === 'admin'
  const canEdit = isAdmin || papel === 'editor'

  const canSee = useCallback((m: Modulo) => {
    if (!membership) return false
    if (isAdmin) return true
    if (m === 'usuarios') return false
    const p = membership.permissoes?.[m]
    return p !== 'nenhum'
  }, [membership, isAdmin])

  const canEditModule = useCallback((m: Modulo) => {
    if (!membership) return false
    if (isAdmin) return true
    if (papel !== 'editor') return false
    const p = membership.permissoes?.[m]
    return p === undefined || p === 'editar'
  }, [membership, isAdmin, papel])

  const value: AuthCtx = {
    session, user: session?.user ?? null, profile, memberships,
    workspace: membership?.workspaces ?? null, membership, papel, loading, canEdit, isAdmin, canSee, canEditModule,
    setWorkspaceId: (id) => { localStorage.setItem('avl.ws', id); setWorkspaceIdState(id) },
    refresh: async () => { const { data } = await supabase.auth.getSession(); await load(data.session) },
    signOut: async () => { await supabase.auth.signOut(); localStorage.removeItem('avl.ws') },
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth() {
  const c = useContext(Ctx)
  if (!c) throw new Error('useAuth fora do AuthProvider')
  return c
}
