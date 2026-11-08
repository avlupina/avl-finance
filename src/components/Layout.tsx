import { useMemo, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import {
  ArrowLeftRight, BarChart3, PieChart, TrendingUp, Telescope, Landmark, Wallet, Plug, FolderCog, Users,
  LogOut, ChevronDown, Menu, X, Gauge, CalendarClock, ClipboardList, ShieldCheck, CalendarDays,
} from 'lucide-react'
import clsx from 'clsx'
import { useAuth, type Modulo } from '../hooks/useAuth'
import { PAPEL_LABEL } from '../lib/format'

export const NAV: { to: string; label: string; icon: typeof Wallet; modulo: Modulo; group: string; hint: string }[] = [
  { to: '/status', label: 'Status Atual', icon: Gauge, modulo: 'status', group: 'Visão', hint: 'Posição atualizada das finanças' },
  { to: '/agenda', label: 'Agenda', icon: CalendarDays, modulo: 'agenda', group: 'Visão', hint: 'Programação financeira dos próximos 30, 60 e 90 dias' },
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
  const nav = NAV.filter(n => canSee(n.modulo))
  const groups = useMemo(() => Array.from(new Set(nav.map(n => n.group))), [nav])

  const [fechados, setFechados] = useState<Record<string, boolean>>(() => { try { return JSON.parse(localStorage.getItem('avl.menu') ?? '{}') } catch { return {} } })
  const toggleGrupo = (g: string) => setFechados(f => { const n = { ...f, [g]: !f[g] }; localStorage.setItem('avl.menu', JSON.stringify(n)); return n })
  const { pathname } = useLocation()

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


        <nav className="flex-1 overflow-y-auto px-3 pb-3">
          {groups.map(g => { const itens = nav.filter(n => n.group === g); const ativo = itens.some(n => pathname.startsWith(n.to)); const aberto = !fechados[g] || ativo; return (
            <div key={g} className="mb-1">
              <button onClick={() => toggleGrupo(g)} className="w-full flex items-center justify-between px-2 pt-2 pb-1 text-[11px] font-bold uppercase tracking-wider text-white/50 hover:text-white/80">
                <span>{g}</span><ChevronDown size={13} className={`transition-transform ${aberto ? '' : '-rotate-90'}`} />
              </button>
              {aberto && itens.map(n => (
                <NavLink key={n.to} to={n.to} onClick={() => setOpen(false)}
                  className={({ isActive }) => clsx('flex items-center gap-3 px-3 py-2 rounded-lg text-[15px] font-bold border-l-4 border-transparent transition-colors',
                    isActive ? 'bg-white/15 border-white text-white' : 'text-white/85 hover:bg-white/10')}>
                  <n.icon size={18} className="shrink-0" /> {n.label}
                </NavLink>
              ))}
            </div>
          ) })}
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

    </div>
  )
}

