import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { api, type SensorSeries } from '../api'
import { useHouse } from '../hooks/useHouse'
import { factorText } from '../labels'

const WORD_COLOR = {
  Good: 'var(--color-ok)',
  Fair: 'var(--color-watch)',
  Attention: 'var(--color-alert)',
} as const

const FACTOR_SEV_COLOR = {
  info: 'var(--color-muted)',
  watch: 'var(--color-watch)',
  attention: 'var(--color-alert)',
} as const

const TREND_LABEL = {
  improving: 'Improving this week',
  stable: 'Steady this week',
  declining: 'Going down this week',
} as const

// Where mould index starts to matter (VILPE mould growth model — same
// level the report page draws).
const MOLD_RISK_LEVEL = 1

function MoldChart({ id, name }: { id: string; name: string }) {
  const [series, setSeries] = useState<SensorSeries | null>(null)
  useEffect(() => {
    api
      .getSeries(id, '30d')
      .then(setSeries)
      .catch(() => setSeries(null))
  }, [id])

  const rows = (series?.points ?? [])
    .filter((p) => p.mold_index != null)
    .map((p) => ({ t: Date.parse(p.t), v: p.mold_index }))
  const max = Math.max(MOLD_RISK_LEVEL + 1, ...rows.map((r) => r.v ?? 0))

  return (
    <section className="flex flex-col gap-3 rounded-3xl border border-line bg-white p-5 shadow-sm">
      <div className="flex items-baseline justify-between">
        <h3 className="font-display text-sm font-semibold text-navy">{name}</h3>
        <span className="text-xs text-muted">mould index · 30 days</span>
      </div>
      {series === null ? (
        <div className="flex h-40 items-center justify-center text-sm text-muted">
          Loading…
        </div>
      ) : rows.length === 0 ? (
        <div className="flex h-40 items-center justify-center text-sm text-muted">
          No mould index readings in this period.
        </div>
      ) : (
        <div className="h-40 w-full">
          <ResponsiveContainer>
            <LineChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
              <CartesianGrid stroke="var(--color-line)" strokeDasharray="3 3" />
              <XAxis
                dataKey="t"
                type="number"
                domain={['dataMin', 'dataMax']}
                tickFormatter={(t) =>
                  new Date(Number(t)).toLocaleDateString('en-GB', {
                    day: 'numeric',
                    month: 'short',
                  })
                }
                stroke="var(--color-muted)"
                tick={{ fontSize: 11 }}
                minTickGap={48}
              />
              <YAxis
                domain={[0, Math.ceil(max)]}
                stroke="var(--color-muted)"
                tick={{ fontSize: 11 }}
                width={44}
              />
              <Tooltip
                contentStyle={{
                  background: '#fff',
                  border: '1px solid var(--color-line)',
                  borderRadius: 12,
                  fontSize: 12,
                }}
                labelFormatter={(t) => new Date(Number(t)).toLocaleString('en-GB')}
                formatter={(v) => [Number(v).toFixed(2), 'mould index']}
              />
              <ReferenceLine
                y={MOLD_RISK_LEVEL}
                stroke="var(--color-alert)"
                strokeDasharray="4 4"
                label={{
                  value: 'risk level',
                  position: 'insideTopRight',
                  fontSize: 10,
                  fill: 'var(--color-alert)',
                }}
              />
              <Line
                dataKey="v"
                stroke="#df0a15"
                strokeWidth={2}
                type="monotone"
                dot={false}
                connectNulls
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  )
}

// The score's own page — what the number is built from (real findings +
// mould index trends) and how it's computed. Opened by tapping the ring.
export default function ScorePage() {
  const { state } = useHouse()
  const molds = state?.sensors.filter((s) => s.latest.mold_index != null) ?? []

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-5 py-6">
        <Link
          to="/"
          className="self-start text-sm font-medium text-sense hover:underline"
        >
          ← Back to overview
        </Link>

        {state ? (
          <>
            <section className="flex items-center gap-5">
              <span className="font-display text-6xl font-bold text-navy">
                {state.score}
              </span>
              <div className="flex flex-col">
                <h1 className="font-display text-xl font-bold text-navy">
                  Home score
                </h1>
                <span
                  className="text-sm font-semibold"
                  style={{ color: WORD_COLOR[state.score_word] }}
                >
                  {state.score_word} · {TREND_LABEL[state.score_trend]}
                </span>
              </div>
            </section>

            <section className="flex flex-col gap-3 rounded-3xl border border-line bg-white p-5 shadow-sm">
              <h2 className="font-display text-xs font-semibold tracking-[0.25em] text-muted uppercase">
                What is shaping it right now
              </h2>
              {state.score_factors.length > 0 ? (
                <ul className="flex flex-col gap-2">
                  {state.score_factors.map((f, i) => (
                    <li
                      key={i}
                      className="flex items-start gap-2.5 text-sm leading-relaxed text-navy/85"
                    >
                      <span
                        className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                        style={{ background: FACTOR_SEV_COLOR[f.severity] }}
                      />
                      {factorText(f)}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm leading-relaxed text-navy/75">
                  Nothing is pulling the score down — every reading is in its
                  normal range.
                </p>
              )}
            </section>

            {molds.length > 0 && (
              <div className="grid gap-4 sm:grid-cols-2">
                {molds.map((s) => (
                  <MoldChart key={s.id} id={s.id} name={s.name} />
                ))}
              </div>
            )}

            <section className="flex flex-col gap-3 rounded-3xl border border-line bg-white p-5 text-sm leading-relaxed text-navy/80 shadow-sm">
              <h2 className="font-display text-xs font-semibold tracking-[0.25em] text-muted uppercase">
                How it's worked out
              </h2>
              <p>
                The score starts at 100 and points come off for what the
                sensors actually find. The{' '}
                <span className="font-semibold text-navy">mould index</span> —
                the Finnish mould growth model developed by VTT, which weighs
                humidity, temperature and time — carries the most weight.
              </p>
              <p>
                Humidity that stays high after we've accounted for the outdoor
                air (the structure holding moisture rather than just mirroring
                the weather) deducts a little, as do fans that stop or go
                quiet. Repeated episodes of the same issue count once, at
                their worst — the score won't spiral from old history.
              </p>
              <p className="text-muted">
                Bands: <span className="text-ok">75–100 Good</span> ·{' '}
                <span className="text-watch">60–74 Fair</span> ·{' '}
                <span className="text-alert">0–59 Attention</span>. It changes
                slowly — one damp day won't move it.{' '}
                <a
                  href="https://www.vilpe.com/en/vilpe-sense-mould-index/"
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-sense underline-offset-2 hover:underline"
                >
                  About the mould growth model ↗
                </a>
              </p>
            </section>
          </>
        ) : (
          <p className="text-sm text-muted">Loading…</p>
        )}
      </div>
    </div>
  )
}
