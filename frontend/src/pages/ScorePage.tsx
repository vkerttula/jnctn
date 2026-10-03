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
import { AREA_WORD, ScoreRing } from '../components/ScoreCard'
import { useHouse } from '../hooks/useHouse'
import { factorText } from '../labels'
import { STATUS_COLOR } from '../theme'

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
      .getSeries(id, '1y')
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
        <span className="text-xs text-muted">mould index · 12 months</span>
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
                    month: 'short',
                    year: '2-digit',
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
            <section className="flex items-center gap-6 rounded-3xl bg-navy p-6 text-white shadow-sm">
              <div className="relative flex h-28 w-28 shrink-0 items-center justify-center">
                <ScoreRing
                  score={state.score}
                  color={WORD_COLOR[state.score_word]}
                  className="h-28 w-28"
                />
                <div className="absolute flex flex-col items-center">
                  <span className="font-display text-3xl leading-none font-bold">
                    {state.score}
                  </span>
                  <span
                    className="text-[10px] font-semibold tracking-wide"
                    style={{ color: WORD_COLOR[state.score_word] }}
                  >
                    {state.score_word}
                  </span>
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <h1 className="font-display text-xl font-bold">Home score</h1>
                <span className="text-sm text-white/70">
                  {TREND_LABEL[state.score_trend]} — one number for your roof
                  and crawl space.
                </span>
                <div className="flex gap-2">
                  {state.areas.map((a) => (
                    <span
                      key={a.id}
                      className="flex items-center gap-1.5 rounded-full border border-white/15 bg-white/10 px-2.5 py-1 text-[11px] whitespace-nowrap"
                    >
                      <span
                        className="h-1.5 w-1.5 rounded-full"
                        style={{ background: STATUS_COLOR[a.status] }}
                      />
                      {a.name}
                      <span className="font-semibold">{AREA_WORD[a.status]}</span>
                    </span>
                  ))}
                </div>
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

            <section className="flex flex-col gap-5 rounded-3xl border border-line bg-white p-6 text-sm leading-relaxed text-navy/80 shadow-sm">
              <h2 className="font-display text-xs font-semibold tracking-[0.25em] text-muted uppercase">
                How it's worked out
              </h2>

              <div className="grid gap-6 sm:grid-cols-2">
                <div className="flex flex-col gap-3">
                  <p className="font-semibold text-navy">
                    The score starts at 100 — and only real findings move it.
                  </p>
                  <p>
                    Points come off for what the sensors actually detect:
                    humidity that stays high after we've accounted for the
                    outdoor air, a mould index that climbs, and fans that stop
                    or go quiet. Repeated episodes of the same issue count
                    once, at their worst — the score won't spiral from old
                    history.
                  </p>
                  <div className="flex gap-1.5">
                    {(
                      [
                        ['75–100', 'Good', 'var(--color-ok)'],
                        ['60–74', 'Fair', 'var(--color-watch)'],
                        ['0–59', 'Attention', 'var(--color-alert)'],
                      ] as const
                    ).map(([range, word, c]) => (
                      <span
                        key={word}
                        className="flex flex-1 flex-col items-center rounded-lg bg-mist py-1.5"
                      >
                        <span className="font-semibold" style={{ color: c }}>
                          {word}
                        </span>
                        <span className="text-[10px] text-muted">{range}</span>
                      </span>
                    ))}
                  </div>
                  <p className="text-xs text-muted">
                    It changes slowly — one damp day won't move it.
                  </p>
                </div>

                <div className="flex flex-col gap-3">
                  <p>
                    The heaviest input is the{' '}
                    <span className="font-semibold text-navy">mould index</span>{' '}
                    — the Finnish Mould Growth Model, developed by Tampere
                    University of Technology and VTT. It estimates how
                    favourable conditions are for mould growth from
                    temperature, humidity and time.
                  </p>
                  <div className="rounded-2xl border border-line bg-mist/60 px-4 py-3.5">
                    <div className="relative pt-5 pb-1">
                      <span className="absolute top-0 left-0 text-[10px] text-muted">
                        0 · no growth
                      </span>
                      <span className="absolute top-0 right-0 text-[10px] text-muted">
                        6 · very rich growth
                      </span>
                      <div className="h-2 w-full rounded-full bg-gradient-to-r from-ok via-watch to-alert" />
                      <div
                        className="absolute top-3.5 flex -translate-x-1/2 flex-col items-center"
                        style={{ left: `${(2.5 / 6) * 100}%` }}
                      >
                        <div className="h-3 w-px bg-alert" />
                        <span className="mt-0.5 text-[10px] font-semibold text-alert">
                          automatic alert at 2.5
                        </span>
                      </div>
                    </div>
                    <p className="mt-4 text-xs text-muted">
                      In VILPE Sense the index runs 0–6 and the system alerts
                      automatically once it passes 2.5. It's rarely exactly
                      zero — what matters is when it rises.
                    </p>
                  </div>
                  <a
                    href="https://www.vilpe.com/en/vilpe-sense-mould-index/"
                    target="_blank"
                    rel="noreferrer"
                    className="self-start text-xs font-medium text-sense underline-offset-2 hover:underline"
                  >
                    VILPE Sense — the mould growth model ↗
                  </a>
                </div>
              </div>
            </section>
          </>
        ) : (
          <p className="text-sm text-muted">Loading…</p>
        )}
      </div>
    </div>
  )
}
