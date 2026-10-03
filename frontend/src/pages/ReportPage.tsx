import { useEffect, useState } from 'react'
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Link } from 'react-router-dom'
import { api, type Report, type ReportStructure } from '../api'
import Spinner from '../components/Spinner'

// Moisture History Report — the sellable "structures healthy for N years"
// document from the vision (e.g. for house sales). Mirrors the concept
// mockup in docs/; print/PDF via the browser.

const ROOF = '#004f9f'
const CRAWL = '#e3530f'

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function fmtMonth(ym: string) {
  return new Date(`${ym}-01`).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] font-semibold tracking-[0.18em] text-muted uppercase">{label}</span>
      <span className="text-xs font-medium text-navy">{value}</span>
    </div>
  )
}

// Neutral period verdict, derived from the structures table — never the
// live dashboard narrative.
function verdict(report: Report) {
  const months = report.months.length
  const risks = report.structures.reduce((a, s) => a + s.risk_periods, 0)
  const peak = report.structures.reduce((a, s) =>
    s.peak_mold_index > a.peak_mold_index ? s : a,
  )
  const base = `Monitoring covered ${months} months across ${report.structures.length} structures.`
  if (risks === 0) return `${base} No mold-risk periods detected.`
  return `${base} ${risks} mold-risk period${risks === 1 ? '' : 's'} detected — highest index ${peak.peak_mold_index.toFixed(1)} in ${peak.name} (${fmtMonth(peak.peak_month)}).`
}

// Red only when mold growth was actually reached (index >= threshold);
// elevated-but-sub-threshold readings stay amber.
function statusTone(s: ReportStructure, threshold: number) {
  if (s.status === 'Dry') return 'ok'
  return s.peak_mold_index >= threshold ? 'alert' : 'watch'
}

const TONE_BG = { ok: 'bg-ok/15', watch: 'bg-watch/15', alert: 'bg-alert/15' } as const
const TONE_TEXT = { ok: 'text-ok', watch: 'text-watch', alert: 'text-alert' } as const

export default function ReportPage() {
  const [report, setReport] = useState<Report | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    api
      .getReport()
      .then(setReport)
      .catch(() => setFailed(true))
  }, [])

  return (
    <div className="h-full overflow-y-auto print:h-auto print:overflow-visible">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 px-5 py-6 print:max-w-none print:p-0">
        <Link
          to="/"
          className="self-start text-sm font-medium text-sense hover:underline print:hidden"
        >
          ← Back to overview
        </Link>
        <div className="flex items-center justify-between print:hidden">
          <h1 className="font-display text-xl font-bold text-navy">Moisture History Report</h1>
          {report && (
            <button
              onClick={() => window.print()}
              className="rounded-full bg-navy px-4 py-2 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-navy/90"
            >
              Download PDF
            </button>
          )}
        </div>

        {failed && <p className="text-sm text-alert">The report is not available right now.</p>}
        {!report && !failed && <Spinner label="Loading report…" />}

        {report && (
          <article className="flex flex-col gap-7 rounded-3xl border border-line bg-white p-8 shadow-sm print:gap-4 print:rounded-none print:border-0 print:p-0 print:shadow-none">
            <header className="flex flex-wrap items-start justify-between gap-4 border-b border-line pb-5 print:pb-3">
              <div className="flex flex-col gap-1">
                <span className="text-[11px] font-semibold tracking-[0.2em] text-sense uppercase">
                  VILPE Sense · Data service
                </span>
                <h2 className="font-display text-3xl font-bold text-navy print:text-2xl">
                  Moisture History Report
                </h2>
                <span className="text-sm text-muted">{report.address}</span>
              </div>
              <div className="flex items-center gap-3 rounded-xl bg-navy px-4 py-3">
                <img src="/vilpe-logo.png" alt="VILPE" className="h-6 w-auto" />
                <span className="h-6 w-px bg-white/25" aria-hidden />
                <span className="font-display text-[11px] leading-tight font-semibold tracking-wide text-white/80">
                  Peace of mind
                  <br />
                  for your home
                </span>
              </div>
            </header>

            <section className="grid grid-cols-3 gap-4 sm:grid-cols-6">
              <Meta label="Property" value={report.property} />
              <Meta label="Building" value={report.building} />
              <Meta label="Sensors" value={report.sensors} />
              <Meta
                label="Report period"
                value={`${fmtDate(report.period.from)} – ${fmtDate(report.period.to)}`}
              />
              <Meta label="Report ID" value={report.id} />
              <Meta label="Issued" value={fmtDate(report.issued)} />
            </section>

            <section className="flex flex-wrap items-center gap-x-5 gap-y-3 rounded-2xl border border-line p-4 print:p-3">
              <div className="flex min-w-60 flex-1 flex-col gap-1.5">
                <span className="text-[10px] font-semibold tracking-[0.18em] text-muted uppercase">
                  Verdict
                </span>
                <p className="text-sm leading-relaxed text-navy">{verdict(report)}</p>
                <div className="flex flex-wrap gap-1.5">
                  {report.structures.map((s) => {
                    const tone = statusTone(s, report.mold_threshold)
                    return (
                      <span
                        key={s.name}
                        className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${TONE_BG[tone]} ${TONE_TEXT[tone]}`}
                      >
                        {s.name} · {s.status}
                      </span>
                    )
                  })}
                </div>
              </div>
              <span className="flex items-center gap-2 rounded-full bg-navy px-3.5 py-1.5">
                <img src="/vilpe-logo.png" alt="VILPE" className="h-3 w-auto" />
                <span className="text-[11px] font-semibold text-white/85">
                  Sensor verified {report.verified}
                </span>
              </span>
            </section>

            <section className="flex flex-col gap-3 print:gap-2">
              <h3 className="font-display text-sm font-semibold tracking-[0.15em] text-navy uppercase">
                Mold index by month
              </h3>
              <div className="h-64 w-full print:h-52">
                <ResponsiveContainer>
                  <LineChart data={report.months} margin={{ top: 8, right: 12, bottom: 0, left: -18 }}>
                    <CartesianGrid stroke="var(--color-line)" strokeDasharray="3 3" />
                    <ReferenceArea y1={report.mold_threshold} y2={2} fill="var(--color-alert)" fillOpacity={0.06} />
                    <ReferenceLine
                      y={report.mold_threshold}
                      stroke="var(--color-alert)"
                      strokeDasharray="4 4"
                      label={{
                        value: 'Mold growth possible',
                        position: 'insideTopRight',
                        fontSize: 11,
                        fill: 'var(--color-alert)',
                      }}
                    />
                    <XAxis
                      dataKey="month"
                      tickFormatter={(m: string) => m.slice(0, 4)}
                      interval={11}
                      stroke="var(--color-muted)"
                      tick={{ fontSize: 11 }}
                    />
                    <YAxis domain={[0, 2]} ticks={[0, 0.5, 1, 1.5, 2]} stroke="var(--color-muted)" tick={{ fontSize: 11 }} />
                    <Tooltip
                      labelFormatter={(m) => fmtMonth(String(m))}
                      contentStyle={{ borderRadius: 12, fontSize: 12, border: '1px solid var(--color-line)' }}
                    />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Line dataKey="roof" name="Roof" stroke={ROOF} strokeWidth={2} dot={false} type="monotone" isAnimationActive={false} />
                    <Line dataKey="crawl_space" name="Crawl space" stroke={CRAWL} strokeWidth={2} dot={false} type="monotone" isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <p className="text-xs leading-relaxed text-muted print:hidden">
                Mold index (VTT model): 0 = no growth, 1 = first microscopic growth, 6 = heavy
                growth. Highest value of each month shown.
              </p>
            </section>

            <section className="flex flex-col gap-3 print:gap-2">
              <h3 className="font-display text-sm font-semibold tracking-[0.15em] text-navy uppercase">
                Structure summary
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-[10px] tracking-[0.15em] text-muted uppercase">
                    <tr className="border-b border-line">
                      <th className="py-2 pr-4 font-semibold">Structure</th>
                      <th className="py-2 pr-4 font-semibold">Avg. humidity</th>
                      <th className="py-2 pr-4 font-semibold">Peak mold index</th>
                      <th className="py-2 pr-4 font-semibold">Risk periods</th>
                      <th className="py-2 pr-4 font-semibold">Data coverage</th>
                      <th className="py-2 font-semibold">Status</th>
                    </tr>
                  </thead>
                  <tbody className="text-navy">
                    {report.structures.map((s) => (
                      <tr key={s.name} className="border-b border-line/70">
                        <td className="py-2 pr-4 font-medium">{s.name}</td>
                        <td className="py-2 pr-4 tabular-nums">{s.avg_rh_pct} % RH</td>
                        <td className="py-2 pr-4 tabular-nums">
                          {s.peak_mold_index.toFixed(1)}{' '}
                          <span className="text-xs text-muted">{fmtMonth(s.peak_month)}</span>
                        </td>
                        <td className="py-2 pr-4 tabular-nums">{s.risk_periods}</td>
                        <td className="py-2 pr-4 tabular-nums">{s.coverage_pct.toFixed(1)} %</td>
                        <td className="py-2">
                          <span
                            className={`rounded-full px-2.5 py-1 text-xs font-semibold text-navy ${TONE_BG[statusTone(s, report.mold_threshold)]}`}
                          >
                            {s.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="grid grid-cols-2 gap-4 border-t border-line pt-5 sm:grid-cols-4 print:pt-3">
              <Meta
                label="Measurements"
                value={`${report.measurements.toLocaleString('en-GB')} · ${report.interval}`}
              />
              <Meta label="Data gaps" value={report.data_gaps} />
              <Meta label="Weather context" value={report.weather_context} />
              <Meta label="Last sensor check" value={fmtMonth(report.last_sensor_check)} />
            </section>

            <footer className="flex flex-col gap-0.5 text-xs leading-relaxed text-muted">
              <p>Measurements are stored by VILPE and cannot be edited by the owner.</p>
              <p>
                Covers the monitored structures only. Not a condition inspection or a guarantee of
                the whole building.
              </p>
            </footer>
          </article>
        )}
      </div>
    </div>
  )
}
