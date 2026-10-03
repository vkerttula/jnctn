import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api, type SensorDetail, type SensorSeries, type SeriesRange } from '../api'
import SensorChart from '../components/SensorChart'
import { KIND_LABEL, ZONE_LABEL } from '../labels'
import { STATUS_COLOR } from '../theme'

const RANGES: { id: SeriesRange; label: string }[] = [
  { id: '24h', label: '24 h' },
  { id: '7d', label: '7 days' },
  { id: '30d', label: '30 days' },
]

function Latest({ detail }: { detail: SensorDetail }) {
  const { latest } = detail
  const cells: [string, string][] = []
  if (latest.temp_c != null) cells.push(['Temperature', `${latest.temp_c.toFixed(1)} °C`])
  if (latest.rh_pct != null) cells.push(['Humidity', `${latest.rh_pct.toFixed(0)} %`])
  if (latest.mold_index != null) cells.push(['Mold index', latest.mold_index.toFixed(1)])
  if (latest.fan_rpm != null) cells.push(['Fan', `${latest.fan_rpm.toFixed(0)} rpm`])
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {cells.map(([label, value]) => (
        <div
          key={label}
          className="rounded-2xl border border-line bg-white px-4 py-3"
        >
          <div className="text-[10px] font-medium tracking-[0.15em] text-muted uppercase">
            {label}
          </div>
          <div className="mt-1 font-display text-lg font-semibold text-navy">
            {value}
          </div>
        </div>
      ))}
    </div>
  )
}

export default function SensorDetailPage() {
  const { id = '' } = useParams()
  const [range, setRange] = useState<SeriesRange>('7d')
  // Results are keyed by request so a stale sensor/range never renders.
  const [loaded, setLoaded] = useState<SensorDetail | null>(null)
  const [failedId, setFailedId] = useState<string>()
  const [series, setSeries] = useState<{ key: string; data: SensorSeries | null }>()
  const detail = loaded?.id === id ? loaded : null
  const error = failedId === id
  const current = series?.key === `${id}/${range}` ? series : undefined

  useEffect(() => {
    api
      .getSensor(id)
      .then(setLoaded)
      .catch(() => setFailedId(id))
  }, [id])

  useEffect(() => {
    const key = `${id}/${range}`
    api
      .getSeries(id, range)
      .then((data) => setSeries({ key, data }))
      .catch(() => setSeries({ key, data: null }))
  }, [id, range])

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-5 py-6">
        <Link
          to="/"
          className="self-start text-sm font-medium text-sense hover:underline"
        >
          ← Back to overview
        </Link>

        {error && !detail && (
          <div className="rounded-2xl border border-alert/30 bg-alert/5 p-4 text-sm text-alert">
            Could not load this sensor.
          </div>
        )}

        {detail && (
          <>
            <section className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="font-display text-2xl font-bold text-navy">
                  {detail.name}
                </h1>
                <span
                  className="rounded-full px-3 py-1 text-xs font-semibold text-white"
                  style={{ background: STATUS_COLOR[detail.status] }}
                >
                  {detail.status}
                </span>
              </div>
              <div className="text-xs tracking-wide text-muted">
                {KIND_LABEL[detail.kind]} · {ZONE_LABEL[detail.zone] ?? detail.zone}
              </div>
              <p className="max-w-2xl text-base leading-relaxed text-navy/85">
                {detail.status_text}
              </p>
            </section>

            <Latest detail={detail} />

            <section className="flex flex-col gap-4 rounded-3xl border border-line bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <h2 className="font-display text-xs font-semibold tracking-[0.25em] text-muted uppercase">
                  Trend
                </h2>
                <div className="flex gap-1 rounded-full border border-line bg-mist p-1">
                  {RANGES.map((r) => (
                    <button
                      key={r.id}
                      onClick={() => setRange(r.id)}
                      className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                        range === r.id
                          ? 'bg-navy text-white shadow-sm'
                          : 'text-muted hover:text-navy'
                      }`}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
              </div>
              {current?.data ? (
                <SensorChart series={current.data} />
              ) : (
                <div className="flex h-64 items-center justify-center text-sm text-muted">
                  {current ? 'Trend data is not available right now.' : 'Loading trend…'}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  )
}
