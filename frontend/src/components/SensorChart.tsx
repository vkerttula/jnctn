import { useMemo, useState } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { SeriesPoint, SeriesRange, SensorSeries } from '../api'

type Field = Exclude<keyof SeriesPoint, 't'>

// Every reading a device may report; only the ones present in the series
// are offered. Each gets its own (hidden) axis so scales don't fight.
// `minSpan` keeps an auto-scaled axis from stretching a few degrees of
// normal day/night variation across the whole chart — calm, not scary.
type LineDef = {
  key: Field
  label: string
  color: string
  unit: string
  domain?: [number, number]
  minSpan?: number
  floor?: number
}
const LINES: LineDef[] = [
  { key: 'rh_pct', label: 'Humidity', color: '#004f9f', unit: '%', domain: [0, 100] },
  { key: 'temp_c', label: 'Temperature', color: '#e3530f', unit: '°C', minSpan: 30 },
  { key: 'fan_rpm', label: 'Fan speed', color: '#01273e', unit: ' rpm', minSpan: 3000, floor: 0 },
  { key: 'mold_index', label: 'Mold index', color: '#df0a15', unit: '', minSpan: 2, floor: 0 },
]

function domainOf(l: LineDef, points: SeriesPoint[]): [number, number] {
  if (l.domain) return l.domain
  const vals = points.map((p) => p[l.key]).filter((v): v is number => v != null)
  const lo = Math.min(...vals)
  const hi = Math.max(...vals)
  const pad = Math.max(0, (l.minSpan ?? 0) - (hi - lo)) / 2
  let min = lo - pad
  let max = hi + pad
  if (l.floor != null && min < l.floor) {
    max += l.floor - min
    min = l.floor
  }
  return [Math.floor(min), Math.ceil(max)]
}

function tickFormat(range: SeriesRange) {
  return (t: number) =>
    range === '24h'
      ? new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
      : range === '1y'
        ? new Date(t).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' })
        : new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

function Toggle({
  label,
  active,
  color,
  onClick,
}: {
  label: string
  active: boolean
  color: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
        active
          ? 'border-navy/20 bg-white text-navy shadow-sm'
          : 'border-transparent text-muted hover:text-navy'
      }`}
    >
      <span
        className="h-2 w-2 rounded-full"
        style={{ background: active ? color : 'var(--color-line)' }}
      />
      {label}
    </button>
  )
}

export default function SensorChart({ series }: { series: SensorSeries }) {
  const available = useMemo(
    () => LINES.filter((l) => series.points.some((p) => p[l.key] != null)),
    [series],
  )
  const [hidden, setHidden] = useState<Set<Field>>(new Set())
  const shown = available.filter((l) => !hidden.has(l.key))
  const axis = shown[0]

  const rows = useMemo(
    () => series.points.map((p) => ({ ...p, t: Date.parse(p.t) })),
    [series],
  )

  const toggle = (key: Field) =>
    setHidden((h) => {
      const next = new Set(h)
      if (next.has(key)) next.delete(key)
      else if (shown.length > 1) next.add(key) // keep at least one line
      return next
    })

  if (!available.length)
    return (
      <div className="flex h-64 items-center justify-center text-sm text-muted">
        No readings in this period.
      </div>
    )

  return (
    <div className="flex flex-col gap-3">
      {available.length > 1 && (
        <div className="flex flex-wrap items-center gap-2">
          {available.map((l) => (
            <Toggle
              key={l.key}
              label={l.label}
              color={l.color}
              active={!hidden.has(l.key)}
              onClick={() => toggle(l.key)}
            />
          ))}
        </div>
      )}
      <div className="h-64 w-full">
        <ResponsiveContainer>
          <LineChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: -6 }}>
            <CartesianGrid stroke="var(--color-line)" strokeDasharray="3 3" />
            <XAxis
              dataKey="t"
              type="number"
              domain={['dataMin', 'dataMax']}
              tickFormatter={tickFormat(series.range)}
              stroke="var(--color-muted)"
              tick={{ fontSize: 11 }}
              minTickGap={48}
            />
            {shown.map((l) => (
              <YAxis
                key={l.key}
                yAxisId={l.key}
                hide={l !== axis}
                domain={domainOf(l, series.points)}
                unit={l.unit}
                stroke="var(--color-muted)"
                tick={{ fontSize: 11 }}
                width={60}
              />
            ))}
            <Tooltip
              contentStyle={{
                background: '#fff',
                border: '1px solid var(--color-line)',
                borderRadius: 12,
                fontSize: 12,
              }}
              labelFormatter={(t) => new Date(Number(t)).toLocaleString('en-GB')}
            />
            {series.normal && shown.some((l) => l.key === 'rh_pct') && (
              <ReferenceArea
                yAxisId="rh_pct"
                y1={series.normal.rh_pct[0]}
                y2={series.normal.rh_pct[1]}
                fill="#50c92f"
                fillOpacity={0.1}
                stroke="none"
                label={{
                  value: series.normal.label,
                  position: 'insideTopLeft',
                  fontSize: 11,
                  fill: '#3a8f22',
                }}
              />
            )}
            {shown.map((l) => (
              <Line
                key={l.key}
                yAxisId={l.key}
                dataKey={l.key}
                name={l.label}
                unit={l.unit}
                stroke={l.color}
                strokeWidth={l === axis ? 2 : 1.5}
                type="monotone"
                dot={false}
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
