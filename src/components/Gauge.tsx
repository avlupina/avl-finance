/** Velocímetro semicircular 0–100 com 5 faixas coloridas. */
export function Gauge({ value, label, size = 260 }: { value: number; label: string; size?: number }) {
  const r = size / 2 - 14, cx = size / 2, cy = size / 2
  const arc = (a0: number, a1: number) => {
    const p = (a: number) => [cx + r * Math.cos(Math.PI * (1 - a)), cy - r * Math.sin(Math.PI * (1 - a))]
    const [x0, y0] = p(a0), [x1, y1] = p(a1)
    return `M ${x0} ${y0} A ${r} ${r} 0 0 1 ${x1} ${y1}`
  }
  const faixas = [['#c0392b', 0, .2], ['#e67e22', .2, .4], ['#f1c40f', .4, .6], ['#27ae60', .6, .8], ['#2a78d6', .8, 1]] as const
  const v = Math.max(0, Math.min(100, value)) / 100
  const nx = cx + (r - 2) * Math.cos(Math.PI * (1 - v)), ny = cy - (r - 2) * Math.sin(Math.PI * (1 - v))
  return (
    <svg viewBox={`0 0 ${size} ${size / 2 + 40}`} width="100%" style={{ maxWidth: size }} role="img" aria-label={`Score ${value} de 100: ${label}`}>
      {faixas.map(([c, a, b]) => <path key={c} d={arc(a + 0.006, b - 0.006)} stroke={c} strokeWidth={14} fill="none" strokeLinecap="butt" />)}
      <circle cx={nx} cy={ny} r={7} fill="#fff" stroke="#1f2a33" strokeWidth={3} />
      <text x={cx} y={cy - 6} textAnchor="middle" fontSize={size / 5} fontWeight={900} fill="#1f2a33" fontFamily="Overlock">{Math.round(value)}</text>
      <text x={cx} y={cy + 26} textAnchor="middle" fontSize={size / 14} fontWeight={700} fill="#1f2a33" fontFamily="Overlock">{label}</text>
    </svg>
  )
}

export function Anel({ value, size = 96, cor }: { value: number; size?: number; cor: string }) {
  const r = size / 2 - 8, c = 2 * Math.PI * r, v = Math.max(0, Math.min(100, value))
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={size / 2} cy={size / 2} r={r} stroke="#e5e9ee" strokeWidth={8} fill="none" />
      <circle cx={size / 2} cy={size / 2} r={r} stroke={cor} strokeWidth={8} fill="none" strokeLinecap="round" strokeDasharray={`${(v / 100) * c} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      <text x="50%" y="46%" textAnchor="middle" fontSize={size / 3.6} fontWeight={900} fill="#1f2a33" fontFamily="Overlock">{Math.round(v)}</text>
      <text x="50%" y="66%" textAnchor="middle" fontSize={size / 8} fill="#64748b" fontFamily="Overlock">de 100</text>
    </svg>
  )
}
