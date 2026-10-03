import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api, type SensorDetail, type SensorSeries, type SeriesRange } from '../api'
import SensorChart from '../components/SensorChart'
import { STATUS_COLOR } from '../theme'

const RANGES: { id: SeriesRange; label: string }[] = [
  { id: '24h', label: '24 h' },
  { id: '7d', label: '7 days' },
  { id: '30d', label: '30 days' },
]

const KIND_LABEL = { fan: 'Ventilation fan', leak_sensor: 'Humidity sensor' }
const ZONE_LABEL: Record<string, string> = {
  flat_roof: 'Flat roof',
  green_roof: 'Green roof',
  ridge: 'Roof ridge',
  crawl_space: 'Crawl space',
  wall: 'South wall',
}

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
  const [detail, setDetail] = useState<SensorDetail | null>(null)
  const [range, setRange] = useState<SeriesRange>('7d')
  const [series, setSeries] = useState<SensorSeries | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    api
      .getSensor(id)
      .then(setDetail)
      .catch(() => setError(true))
  }, [id])

  useEffect(() => {
    let dead = false
    api
      .getSeries(id, range)
      .then((s) => !dead && setSeries(s))
      .catch(() => !dead && setError(true))
    return () => {
      dead = true
    }
  }, [id, range])

  return (
    <main className="min-h-svh bg-mist">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-5 py-6">
        <header className="flex items-center justify-between">
          <Link
            to="/"
            className="text-sm font-medium text-sense hover:underline"
          >
            ← Back to your house
          </Link>
          <img src="/vilpe-logo.png" alt="VILPE" className="h-5 w-auto" />
        </header>

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
              {series && series.range === range ? (
                <SensorChart series={series} />
              ) : (
                <div className="flex h-64 items-center justify-center text-sm text-muted">
                  Loading trend…
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </main>
  )
}
