import { ResponsiveContainer, BarChart, ComposedChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, LineChart, Line, PieChart, Pie, Cell, ReferenceLine } from 'recharts'
import { brl, brlCompact } from '../lib/format'

export const SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948']
export const POS = '#008300', NEG = '#e34948', BRAND = '#104862'

const tick = { fontSize: 12, fill: '#64748b', fontFamily: 'Overlock' }
const tipStyle = { borderRadius: 10, border: '1px solid #e5e9ee', fontFamily: 'Overlock', fontSize: 13 }
const fmt = (v: number) => brl(v)

export function ReceitaDespesaChart({ data }: { data: { mes: string; receitas: number; despesas: number; resultado: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <ComposedChart data={data} barGap={2} margin={{ left: 8, right: 8, top: 8 }}>
        <CartesianGrid vertical={false} stroke="#eef1f4" />
        <XAxis dataKey="mes" tick={tick} axisLine={false} tickLine={false} />
        <YAxis tick={tick} axisLine={false} tickLine={false} tickFormatter={brlCompact} width={70} />
        <Tooltip formatter={(v) => fmt(Number(v))} contentStyle={tipStyle} cursor={{ fill: '#f1f5f9' }} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="receitas" name="Receitas" fill={SERIES[2]} radius={[4, 4, 0, 0]} />
        <Bar dataKey="despesas" name="Despesas" fill={SERIES[1]} radius={[4, 4, 0, 0]} />
        <Line type="monotone" dataKey="resultado" name="Resultado" stroke={BRAND} strokeWidth={2} dot={{ r: 3 }} />
      </ComposedChart>
    </ResponsiveContainer>
  )
}

export function LinhaChart({ data, series, height = 260 }: { data: Record<string, unknown>[]; series: { key: string; name: string; color?: string }[]; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ left: 8, right: 8, top: 8 }}>
        <CartesianGrid vertical={false} stroke="#eef1f4" />
        <XAxis dataKey="mes" tick={tick} axisLine={false} tickLine={false} />
        <YAxis tick={tick} axisLine={false} tickLine={false} tickFormatter={brlCompact} width={70} />
        <Tooltip formatter={(v) => fmt(Number(v))} contentStyle={tipStyle} />
        {series.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
        <ReferenceLine y={0} stroke="#cbd5e1" />
        {series.map((s, i) => <Line key={s.key} type="monotone" dataKey={s.key} name={s.name} stroke={s.color ?? SERIES[i]} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />)}
      </LineChart>
    </ResponsiveContainer>
  )
}

export function BarrasHorizontais({ data, color = SERIES[0], height }: { data: { nome: string; valor: number }[]; color?: string; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height ?? Math.max(160, data.length * 34)}>
      <BarChart data={data} layout="vertical" margin={{ left: 8, right: 40 }}>
        <XAxis type="number" hide />
        <YAxis type="category" dataKey="nome" tick={tick} width={150} axisLine={false} tickLine={false} />
        <Tooltip formatter={(v) => fmt(Number(v))} contentStyle={tipStyle} cursor={{ fill: '#f1f5f9' }} />
        <Bar dataKey="valor" name="Valor" fill={color} radius={[0, 4, 4, 0]} label={{ position: 'right', fontSize: 11, fill: '#64748b', formatter: (v: unknown) => brlCompact(Number(v)) }} />
      </BarChart>
    </ResponsiveContainer>
  )
}

export function Rosca({ data, height = 240 }: { data: { nome: string; valor: number }[]; height?: number }) {
  const total = data.reduce((a, d) => a + d.valor, 0)
  return (
    <div className="flex items-center gap-4 flex-wrap">
      <ResponsiveContainer width={height} height={height}>
        <PieChart>
          <Pie data={data} dataKey="valor" nameKey="nome" innerRadius={height * 0.28} outerRadius={height * 0.42} paddingAngle={2} stroke="#fff" strokeWidth={2}>
            {data.map((_, i) => <Cell key={i} fill={SERIES[i % SERIES.length]} />)}
          </Pie>
          <Tooltip formatter={(v) => fmt(Number(v))} contentStyle={tipStyle} />
        </PieChart>
      </ResponsiveContainer>
      <ul className="text-sm flex-1 min-w-[180px] flex flex-col gap-1.5">
        {data.map((d, i) => (
          <li key={d.nome} className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-sm shrink-0" style={{ background: SERIES[i % SERIES.length] }} />
            <span className="flex-1 truncate">{d.nome}</span>
            <span className="num text-muted">{total ? ((d.valor / total) * 100).toFixed(0) : 0}%</span>
            <span className="num font-bold w-28 text-right">{brl(d.valor)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
