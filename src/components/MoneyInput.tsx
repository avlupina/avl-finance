import { useEffect, useState } from 'react'

/** Converte string digitada (dígitos) em valor numérico com 2 casas. */
const parseDigits = (s: string) => { const d = s.replace(/\D/g, ''); return d ? Number(d) / 100 : 0 }
const fmt = (v: number) => new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v)

/** Input monetário no padrão brasileiro (R$ #.##0,00). value/onChange trabalham com string numérica ("1234.56"). */
export function MoneyInput({ value, onChange, className = '', required, disabled, placeholder = '0,00', autoFocus }: { value: string; onChange: (v: string) => void; className?: string; required?: boolean; disabled?: boolean; placeholder?: string; autoFocus?: boolean }) {
  const toText = (v: string) => { const n = Number(String(v).replace(',', '.')); return v === '' || isNaN(n) ? '' : fmt(n) }
  const [text, setText] = useState(toText(value))
  useEffect(() => { setText(toText(value)) /* eslint-disable-line */ }, [value])
  return (
    <div className={`relative ${className}`}>
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted select-none">R$</span>
      <input
        className="input pl-9 text-right num" inputMode="numeric" required={required} disabled={disabled} placeholder={placeholder} autoFocus={autoFocus}
        value={text}
        onChange={e => { const n = parseDigits(e.target.value); setText(e.target.value === '' ? '' : fmt(n)); onChange(e.target.value === '' ? '' : n.toFixed(2)) }}
      />
    </div>
  )
}
