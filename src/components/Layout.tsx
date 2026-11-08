import { useEffect, useMemo, useRef, useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import {
  ArrowLeftRight, BarChart3, PieChart, TrendingUp, Telescope, Landmark, Wallet, Plug, FolderCog, Users,
  Search, LogOut, ChevronDown, Menu, X, Gauge, CalendarClock, ClipboardList, ShieldCheck,
} from 'lucide-react'
import clsx from 'clsx'
import { useAuth, type Modulo } from '../hooks/useAuth'
import { PAPEL_LABEL } from '../lib/format'

export const NAV: { to: string; label: string; icon: typeof Wallet; modulo: Modulo; group: string; hint: string }[] = [
  { to: '/status', label: 'Status Atual', icon: Gauge, modulo: 'status', group: 'Visão', hint: 'Posição atualizada das finanças' },
  { to: '/resultados', label: 'Resultados', icon: BarChart3, modulo: 'resultados', group: 'Gestão', hint: 'DRE pessoal, orçado x realizado' },
  { to: '/analise', label: 'Análise', icon: PieChart, modulo: 'analise', group: 'Gestão', hint: 'Indicadores e uso do dinheiro' },
  { to: '/investimentos', label: 'Investimentos', icon: TrendingUp, modulo: 'investimentos', group: 'Gestão', hint: 'Carteira e rentabilidade' },
  { to: '/futuro', label: 'Futuro', icon: Telescope, modulo: 'futuro', group: 'Gestão', hint: 'Objetivos, independência financeira e projeções' },
  { to: '/plano', label: 'Plano', icon: ClipboardList, modulo: 'plano', group: 'Gestão', hint: 'Orçamento mensal planejado x realizado' },
  { to: '/protecao', label: 'Proteção', icon: ShieldCheck, modulo: 'protecao', group: 'Gestão', hint: 'Seguros, apólices e cobertura necessária' },
  { to: '/patrimonio', label: 'Patrimônio', icon: Landmark, modulo: 'patrimonio', group: 'Posição', hint: 'Ativos, passivos e evolução patrimonial' },
  { to: '/contas', label: 'Contas', icon: Wallet, modulo: 'contas', group: 'Posição', hint: 'Contas bancárias e cartões' },
  { to: '/lancamentos', label: 'Lançamentos', icon: ArrowLeftRight, modulo: 'lancamentos', group: 'Movimentação', hint: 'Receitas, despesas e transferências' },
  { to: '/projecoes', label: 'Projeções', icon: CalendarClock, modulo: 'projecoes', group: 'Movimentação', hint: 'Gastos e receitas previstos por mês' },
  { to: '/integracoes', label: 'Integrações', icon: Plug, modulo: 'integracoes', group: 'Configuração', hint: 'Open Finance via agregador' },
  { to: '/cadastros', label: 'Cadastros', icon: FolderCog, modulo: 'cadastros', group: 'Configuração', hint: 'Plano de contas, bancos, fornecedores' },
  { to: '/usuarios', label: 'Usuários', icon: Users, modulo: 'usuarios', group: 'Configuração', hint: 'Acessos, alçadas e permissões' },
]

export default function Layout() {
  const { profile, user, workspace, memberships, setWorkspaceId, papel, signOut, canSee } = useAuth()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState(false)
  const nav = NAV.filter(n => canSee(n.modulo))
  const groups = useMemo(() => Array.from(new Set(nav.map(n => n.group))), [nav])

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setSearch(true) } }
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h)
  }, [])

  const initials = (profile?.nome ?? user?.email ?? 'U').split(/[\s@.]/).filter(Boolean).slice(0, 3).map(s => s[0]?.toUpperCase()).join('')

  return (
    <div className="h-full flex">
      {/* Sidebar */}
      <aside className={clsx('fixed md:static inset-y-0 left-0 z-40 w-[272px] shrink-0 bg-brand text-white flex flex-col transition-transform md:translate-x-0', open ? 'translate-x-0' : '-translate-x-full')}>
        <div className="px-4 pt-4 pb-3 flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-white flex items-center justify-center shrink-0 overflow-hidden">
            <img src="./logo.png" alt="AVL" className="w-10 h-10 object-contain" />
          </div>
          <div className="min-w-0 flex-1">
            {memberships.length > 1 ? (
              <div className="relative">
                <select
                  className="appearance-none bg-transparent font-black text-lg leading-tight pr-6 w-full truncate cursor-pointer outline-none"
                  value={workspace?.id ?? ''} onChange={e => setWorkspaceId(e.target.value)}>
                  {memberships.map(m => <option key={m.workspace_id} value={m.workspace_id} className="text-ink">{m.workspaces.nome}</option>)}
                </select>
                <ChevronDown size={14} className="absolute right-0 top-2 pointer-events-none" />
              </div>
            ) : (
              <div className="font-black text-lg leading-tight truncate" title={workspace?.nome}>{workspace?.nome ?? '—'}</div>
            )}
          </div>
          <button className="md:hidden ml-auto p-1" onClick={() => setOpen(false)}><X size={18} /></button>
        </div>

        <button onClick={() => setSearch(true)} className="mx-4 mb-3 flex items-center gap-2 bg-white/10 hover:bg-white/15 border border-white/15 rounded-lg px-3 py-2 text-sm text-white/80">
          <Search size={15} /> <span className="flex-1 text-left truncate">Buscar tela...</span>
          <kbd className="text-[10px] border border-white/30 rounded px-1 py-0.5 font-mono">Ctrl K</kbd>
        </button>

        <nav className="flex-1 overflow-y-auto px-3 pb-3">
          {groups.map(g => (
            <div key={g} className="mb-3">
              <div className="px-2 pt-2 pb-1 text-[11px] font-bold uppercase tracking-wider text-white/50">{g}</div>
              {nav.filter(n => n.group === g).map(n => (
                <NavLink key={n.to} to={n.to} onClick={() => setOpen(false)}
                  className={({ isActive }) => clsx('flex items-center gap-3 px-3 py-2 rounded-lg text-[15px] font-bold border-l-4 border-transparent transition-colors',
                    isActive ? 'bg-white/15 border-white text-white' : 'text-white/85 hover:bg-white/10')}>
                  <n.icon size={18} className="shrink-0" /> {n.label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="border-t border-white/15 p-3 flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-white/15 flex items-center justify-center font-black text-sm">{initials}</div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-bold truncate">{profile?.nome ?? user?.email}</div>
            <div className="text-xs text-white/60 truncate">{papel ? PAPEL_LABEL[papel] : ''} · AVL Finance v{__APP_VERSION__}</div>
          </div>
          <button onClick={signOut} title="Sair" className="p-2 rounded-lg hover:bg-white/10"><LogOut size={17} /></button>
        </div>
      </aside>
      {open && <div className="fixed inset-0 bg-black/30 z-30 md:hidden" onClick={() => setOpen(false)} />}

      {/* Conteúdo */}
      <div className="flex-1 min-w-0 flex flex-col">
        <div className="md:hidden flex items-center gap-3 px-4 py-3 bg-white border-b border-line no-print">
          <button onClick={() => setOpen(true)}><Menu /></button>
          <div className="font-black">{workspace?.nome ?? 'AVL Finance'}</div>
        </div>
        <main className="flex-1 overflow-y-auto p-5 md:p-8">
          <Outlet />
        </main>
      </div>

      {search && <SearchPalette onClose={() => setSearch(false)} items={nav} />}
    </div>
  )
}

function SearchPalette({ onClose, items }: { onClose: () => void; items: typeof NAV }) {
  const [q, setQ] = useState('')
  const ref = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()
  useEffect(() => { ref.current?.focus() }, [])
  const res = items.filter(i => (i.label + ' ' + i.hint).toLowerCase().includes(q.toLowerCase()))
  return (
    <div className="fixed inset-0 z-50 bg-brand-dark/40 flex items-start justify-center pt-24 p-4" onMouseDown={onClose}>
      <div className="card w-full max-w-lg overflow-hidden" onMouseDown={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-4 py-3 border-b border-line">
          <Search size={16} className="text-muted" />
          <input ref={ref} value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar tela, conta, cadastro..." className="flex-1 outline-none text-sm"
            onKeyDown={e => { if (e.key === 'Enter' && res[0]) { navigate(res[0].to); onClose() } }} />
          <kbd className="text-[10px] border border-line rounded px-1 py-0.5 text-muted">Esc</kbd>
        </div>
        <div className="max-h-80 overflow-auto p-2">
          {res.map(r => (
            <button key={r.to} onClick={() => { navigate(r.to); onClose() }} className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-brand-soft text-left">
              <r.icon size={16} className="text-brand" />
              <div><div className="text-sm font-bold">{r.label}</div><div className="text-xs text-muted">{r.hint}</div></div>
            </button>
          ))}
          {!res.length && <div className="text-sm text-muted px-3 py-4">Nenhum resultado.</div>}
        </div>
      </div>
    </div>
  )
}
