import { type ReactNode, useEffect } from 'react'
import { X, Loader2, Inbox } from 'lucide-react'
import clsx from 'clsx'

export function Loading({ label = 'Carregando...' }: { label?: string }) {
  return <div className="flex items-center gap-2 text-muted py-6"><Loader2 className="animate-spin" size={18} /> {label}</div>
}

export function Empty({ title = 'Nada por aqui ainda', hint, action }: { title?: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="card p-10 flex flex-col items-center text-center gap-2">
      <Inbox className="text-brand/40" size={36} />
      <div className="font-bold text-lg">{title}</div>
      {hint && <div className="text-muted text-sm max-w-md">{hint}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

export function ErrorBox({ msg }: { msg: string | null }) {
  if (!msg) return null
  return <div className="rounded-lg border border-neg/30 bg-red-50 text-neg px-3 py-2 text-sm">{msg}</div>
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-brand-dark/40 p-4" onMouseDown={onClose}>
      <div className={clsx('card w-full max-h-[90vh] overflow-auto', wide ? 'max-w-3xl' : 'max-w-lg')} onMouseDown={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-line sticky top-0 bg-white rounded-t-xl">
          <h3 className="font-black text-lg">{title}</h3>
          <button className="btn btn-ghost p-1.5" onClick={onClose} aria-label="Fechar"><X size={18} /></button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  )
}

export function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return <div className={className}><label className="label">{label}</label>{children}</div>
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { key: T; label: string }[]; value: T; onChange: (k: T) => void }) {
  return (
    <div className="inline-flex gap-1 p-1 rounded-xl border border-line bg-white overflow-x-auto max-w-full">
      {tabs.map(t => (
        <button key={t.key} className={clsx('tab', value === t.key && 'tab-active')} onClick={() => onChange(t.key)}>{t.label}</button>
      ))}
    </div>
  )
}

export function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: ReactNode; tone?: 'pos' | 'neg' | 'brand' }) {
  return (
    <div className="kpi">
      <div className="l">{label}</div>
      <div className={clsx('v num', tone === 'pos' && 'text-pos', tone === 'neg' && 'text-neg', tone === 'brand' && 'text-brand')}>{value}</div>
      {sub && <div className="text-xs text-muted">{sub}</div>}
    </div>
  )
}

export function Badge({ children, tone = 'gray' }: { children: ReactNode; tone?: 'gray' | 'green' | 'red' | 'blue' | 'amber' }) {
  const map = { gray: 'bg-slate-100 text-slate-700', green: 'bg-green-50 text-green-800', red: 'bg-red-50 text-red-700', blue: 'bg-brand-soft text-brand', amber: 'bg-amber-50 text-amber-800' }
  return <span className={clsx('badge', map[tone])}>{children}</span>
}

export function PageHeader({ crumb = 'Início', title, actions, children }: { crumb?: string; title: string; actions?: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="text-xs text-muted">{crumb}</div>
          <h1 className="text-2xl font-black tracking-tight">{title}</h1>
        </div>
        {actions && <div className="flex items-center gap-2 no-print">{actions}</div>}
      </div>
      {children && <div className="mt-4">{children}</div>}
    </div>
  )
}

export function MoneyCell({ v, signed = false, tipo }: { v: number; signed?: boolean; tipo?: 'receita' | 'despesa' | 'transferencia' }) {
  const neg = tipo === 'despesa' || (signed && v < 0)
  const pos = tipo === 'receita' || (signed && v > 0)
  const s = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Math.abs(v))
  return <span className={clsx('num font-bold', neg && 'text-neg', pos && 'text-pos')}>{neg ? '− ' : pos && signed ? '+ ' : ''}{s}</span>
}
