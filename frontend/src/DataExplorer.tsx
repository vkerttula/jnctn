import { useCallback, useEffect, useState } from 'react'
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import Spinner from './components/Spinner'

const API_URL = import.meta.env.VITE_API_URL ?? ''

type LatestValue = { value: number; timestamp?: string; timestamp_ms?: number }

type Fan = {
  id: string
  name: string
  location: string
  status: string
  is_alert: boolean
  latest: Record<string, LatestValue | undefined>
}

type SensorMeta = {
  sensor_id: number
  serial_number: string
  is_online: boolean
  is_alert: boolean
  latest: {
    temperature?: LatestValue
    relative_humidity?: LatestValue
  }
}

type Summary = {
  site: { name: string; description_fi?: string; fetched_at?: string }
  devices: Fan[]
  sensors: SensorMeta[]
}

type Row = Record<string, number | string | null> & { t: number }

type Series = { key: string; name: string; color: string; unit?: string }

function withTime(rows: Record<string, number | string | null>[]): Row[] {
  return rows.map((r) => ({
    ...r,
    t: new Date(String(r.timestamp)).getTime(),
  }))
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
      <div className="text-[0.65rem] font-medium uppercase tracking-[0.25em] text-white/50">
        {label}
      </div>
      <div className="mt-2 font-display text-2xl text-white sm:text-3xl">
        {value}
      </div>
    </div>
  )
}

function SeriesChart({
  title,
  rows,
  series,
  unit,
}: {
  title: string
  rows: Row[]
  series: Series[]
  unit?: string
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
      <div className="mb-3 text-[0.65rem] font-medium uppercase tracking-[0.25em] text-white/50">
        {title}
      </div>
      <div className="h-56 w-full">
        <ResponsiveContainer>
          <LineChart data={rows} margin={{ top: 4, right: 8, bottom: 0, left: -18 }}>
            <CartesianGrid stroke="#ffffff14" strokeDasharray="3 3" />
            <XAxis
              dataKey="t"
              type="number"
              domain={['dataMin', 'dataMax']}
              tickFormatter={(t: number) =>
                new Date(t).toLocaleDateString('en-GB', {
                  day: 'numeric',
                  month: 'short',
                })
              }
              stroke="#ffffff55"
              tick={{ fontSize: 11 }}
              minTickGap={48}
            />
            <YAxis
              stroke="#ffffff55"
              tick={{ fontSize: 11 }}
              unit={unit}
              width={56}
            />
            <Tooltip
              contentStyle={{
                background: '#0a0a0a',
                border: '1px solid #ffffff22',
                borderRadius: 12,
                fontSize: 12,
              }}
              labelFormatter={(t) => new Date(Number(t)).toLocaleString('en-GB')}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            {series.map((s) => (
              <Line
                key={s.key}
                dataKey={s.key}
                name={s.name}
                stroke={s.color}
                dot={false}
                strokeWidth={1.5}
                connectNulls
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

function FanSection({ fans }: { fans: Fan[] }) {
  const [fanId, setFanId] = useState<string>(fans[0]?.id ?? '')
  const [rows, setRows] = useState<Row[] | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!fanId) return
    setRows(null)
    setError(false)
    fetch(`${API_URL}/api/dataset/fans/${fanId}/readings`)
      .then(async (r) => {
        if (!r.ok) throw new Error(String(r.status))
        setRows(withTime(await r.json()))
      })
      .catch(() => setError(true))
  }, [fanId])

  return (
    <section className="flex flex-col gap-4">
      <h2 className="font-display text-lg tracking-[0.2em] text-fuchsia-300">
        FANS
      </h2>
      <div className="flex flex-wrap gap-2">
        {fans.map((f) => (
          <button
            key={f.id}
            onClick={() => setFanId(f.id)}
            className={`rounded-lg border px-3 py-1.5 text-xs transition-colors ${
              f.id === fanId
                ? 'border-fuchsia-400/60 bg-fuchsia-400/10 text-fuchsia-200'
                : 'border-white/10 bg-white/[0.04] text-white/60 hover:border-white/30'
            }`}
          >
            {f.name.replace('VILPE Vantaa, ', '')}
            <span className="ml-1.5 text-white/30">{f.location}</span>
          </button>
        ))}
      </div>
      {error && (
        <div className="text-xs text-red-400">Failed to load readings.</div>
      )}
      {rows && (
        <div className="grid gap-4 lg:grid-cols-2">
          <SeriesChart
            title="Temperature"
            rows={rows}
            unit="°C"
            series={[
              { key: 'indoor_temp_c', name: 'indoor', color: '#22d3ee' },
              { key: 'outdoor_temp_c', name: 'outdoor', color: '#a78bfa' },
            ]}
          />
          <SeriesChart
            title="Relative humidity"
            rows={rows}
            unit="%"
            series={[
              { key: 'indoor_rh_pct', name: 'indoor', color: '#e879f9' },
              { key: 'outdoor_rh_pct', name: 'outdoor', color: '#34d399' },
            ]}
          />
          <SeriesChart
            title="Absolute humidity"
            rows={rows}
            unit=" g/m³"
            series={[
              {
                key: 'indoor_abs_humidity_g_m3',
                name: 'indoor',
                color: '#fbbf24',
              },
              {
                key: 'outdoor_abs_humidity_g_m3',
                name: 'outdoor',
                color: '#38bdf8',
              },
            ]}
          />
          <SeriesChart
            title="Fan speed"
            rows={rows}
            unit=" rpm"
            series={[{ key: 'rpm', name: 'rpm', color: '#fbbf24' }]}
          />
          {rows.some((r) => r.mold_index != null) && (
            <SeriesChart
              title="Mold index"
              rows={rows}
              series={[
                { key: 'mold_index', name: 'mold index', color: '#a3e635' },
              ]}
            />
          )}
        </div>
      )}
      {!rows && !error && <Spinner dark label="Loading readings…" />}
    </section>
  )
}

function SensorSection({ sensors }: { sensors: SensorMeta[] }) {
  const [sensorId, setSensorId] = useState<number | null>(null)
  const [rows, setRows] = useState<Row[] | null>(null)
  const [error, setError] = useState(false)

  const select = useCallback((id: number) => {
    setSensorId(id)
    setRows(null)
    setError(false)
    fetch(`${API_URL}/api/dataset/sensors/${id}/readings`)
      .then(async (r) => {
        if (!r.ok) throw new Error(String(r.status))
        setRows(withTime(await r.json()))
      })
      .catch(() => setError(true))
  }, [])

  return (
    <section className="flex flex-col gap-4">
      <h2 className="font-display text-lg tracking-[0.2em] text-fuchsia-300">
        LEAK SENSORS
      </h2>
      <div className="max-h-96 overflow-auto rounded-2xl border border-white/10">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-[#0b0b0b] text-[0.65rem] uppercase tracking-[0.2em] text-white/50">
            <tr>
              <th className="px-4 py-2">Serial</th>
              <th className="px-4 py-2">ID</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2 text-right">Temp</th>
              <th className="px-4 py-2 text-right">RH</th>
            </tr>
          </thead>
          <tbody>
            {sensors.map((s) => (
              <tr
                key={s.sensor_id}
                onClick={() => select(s.sensor_id)}
                className={`cursor-pointer border-t border-white/5 transition-colors hover:bg-white/[0.06] ${
                  s.sensor_id === sensorId ? 'bg-fuchsia-400/10' : ''
                }`}
              >
                <td className="px-4 py-1.5 font-mono">{s.serial_number}</td>
                <td className="px-4 py-1.5 text-white/50">{s.sensor_id}</td>
                <td className="px-4 py-1.5">
                  {s.is_alert ? (
                    <span className="text-red-400">alert</span>
                  ) : s.is_online ? (
                    <span className="text-emerald-400">online</span>
                  ) : (
                    <span className="text-white/40">offline</span>
                  )}
                </td>
                <td className="px-4 py-1.5 text-right">
                  {s.latest.temperature?.value.toFixed(1) ?? '—'}°C
                </td>
                <td className="px-4 py-1.5 text-right">
                  {s.latest.relative_humidity?.value.toFixed(1) ?? '—'}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {error && (
        <div className="text-xs text-red-400">Failed to load readings.</div>
      )}
      {sensorId !== null && !rows && !error && (
        <Spinner dark label="Loading readings…" />
      )}
      {rows && (
        <div className="grid gap-4 lg:grid-cols-2">
          <SeriesChart
            title={`Temperature · sensor ${sensorId}`}
            rows={rows}
            unit="°C"
            series={[
              { key: 'temperature_c', name: 'temp', color: '#22d3ee' },
            ]}
          />
          <SeriesChart
            title="Humidity"
            rows={rows}
            unit="%"
            series={[
              {
                key: 'relative_humidity_pct',
                name: 'RH',
                color: '#e879f9',
              },
              {
                key: 'absolute_humidity_g_m3',
                name: 'abs g/m³',
                color: '#fbbf24',
              },
            ]}
          />
        </div>
      )}
    </section>
  )
}

function DataExplorer() {
  const [summary, setSummary] = useState<Summary | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    fetch(`${API_URL}/api/dataset`)
      .then(async (r) => {
        if (!r.ok) throw new Error(String(r.status))
        setSummary(await r.json())
      })
      .catch(() => setError(true))
  }, [])

  const online = summary?.sensors.filter((s) => s.is_online).length ?? 0

  return (
    <main className="relative min-h-svh bg-[#050505] text-white">
      <div className="stars pointer-events-none absolute inset-0 opacity-40" />
      <div className="pointer-events-none absolute -top-40 -left-40 h-[30rem] w-[30rem] rounded-full bg-fuchsia-500/15 blur-[120px]" />

      <div className="relative mx-auto flex w-full max-w-6xl flex-col gap-10 px-6 py-10">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="font-display text-xs tracking-[0.5em] text-white/50">
              JUNCTION&nbsp;✕&nbsp;VAASA
            </div>
            <h1 className="mt-2 font-display text-4xl text-fuchsia-300 drop-shadow-[0_0_20px_rgba(232,121,249,0.4)]">
              DATA EXPLORER
            </h1>
            <div className="mt-1 text-xs text-white/40">
              {summary ? summary.site.name : 'VILPE Sense sample dataset'} · dev
              tool
            </div>
          </div>
          <a
            href="/"
            className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-white/60 transition-colors hover:border-white/30"
          >
            ← back to stats
          </a>
        </header>

        {error && (
          <div className="rounded-2xl border border-red-400/30 bg-red-400/10 p-5 text-sm text-red-300">
            Could not load <code>/api/dataset</code> — is the backend running
            and has the dataset been ingested (
            <code>uv run python -m app.ingest</code>)?
          </div>
        )}

        {summary && (
          <>
            <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatCard label="Fans" value={String(summary.devices.length)} />
              <StatCard
                label="Sensors"
                value={`${online}/${summary.sensors.length}`}
              />
              <StatCard
                label="Alerts"
                value={String(
                  summary.sensors.filter((s) => s.is_alert).length +
                    summary.devices.filter((d) => d.is_alert).length,
                )}
              />
              <StatCard
                label="Fetched"
                value={
                  summary.site.fetched_at
                    ? new Date(summary.site.fetched_at).toLocaleDateString(
                        'en-GB',
                        { day: 'numeric', month: 'short' },
                      )
                    : '—'
                }
              />
            </section>

            <FanSection fans={summary.devices} />
            <SensorSection sensors={summary.sensors} />
          </>
        )}

        {!summary && !error && <Spinner dark label="Loading dataset…" />}
      </div>
    </main>
  )
}

export default DataExplorer
