import { useMemo, useState } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { SeriesRange, SensorSeries } from '../api'

type Row = { t: number; rh_pct: number | null; temp_c: number | null; mold_index: number | null }

function tickFormat(range: SeriesRange) {
  return (t: number) =>
    range === '24h'
      ? new Date(t).toLocaleTimeString('en-GB', {
          hour: '2-digit',
          minute: '2-digit',
        })
      : new Date(t).toLocaleDateString('en-GB', {
          day: 'numeric',
          month: 'short',
        })
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
  const hasMold = series.points.some((p) => p.mold_index != null)
  const [showTemp, setShowTemp] = useState(true)
  const [showMold, setShowMold] = useState(hasMold)

  const rows: Row[] = useMemo(
    () =>
      series.points.map((p) => ({
        t: Date.parse(p.t),
        rh_pct: p.rh_pct,
        temp_c: p.temp_c,
        mold_index: p.mold_index,
      })),
    [series],
  )

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Toggle
          label="Humidity"
          active
          color="var(--color-sense)"
          onClick={() => {}}
        />
        <Toggle
          label="Temperature"
          active={showTemp}
          color="var(--color-vilpe-orange)"
          onClick={() => setShowTemp((v) => !v)}
        />
        {hasMold && (
          <Toggle
            label="Mold index"
            active={showMold}
            color="var(--color-alert)"
            onClick={() => setShowMold((v) => !v)}
          />
        )}
      </div>
      <div className="h-64 w-full">
        <ResponsiveContainer>
          <LineChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: -14 }}>
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
            <YAxis
              yAxisId="rh"
              domain={[0, 100]}
              unit="%"
              stroke="var(--color-muted)"
              tick={{ fontSize: 11 }}
              width={52}
            />
            <YAxis yAxisId="temp" orientation="right" hide />
            <YAxis yAxisId="mold" orientation="right" hide />
            <Tooltip
              contentStyle={{
                background: '#fff',
                border: '1px solid var(--color-line)',
                borderRadius: 12,
                fontSize: 12,
              }}
              labelFormatter={(t) => new Date(Number(t)).toLocaleString('en-GB')}
            />
            <Line
              yAxisId="rh"
              dataKey="rh_pct"
              name="Humidity %"
              stroke="#004f9f"
              strokeWidth={2}
              type="monotone"
              dot={false}
              connectNulls
            />
            {showTemp && (
              <Line
                yAxisId="temp"
                dataKey="temp_c"
                name="Temp °C"
                stroke="#e3530f"
                strokeWidth={1.5}
                type="monotone"
                dot={false}
                connectNulls
              />
            )}
            {hasMold && showMold && (
              <Line
                yAxisId="mold"
                dataKey="mold_index"
                name="Mold index"
                stroke="#df0a15"
                strokeWidth={1.5}
                type="monotone"
                dot={false}
                connectNulls
              />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
