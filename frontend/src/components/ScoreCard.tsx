import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  api,
  type Area,
  type AttentionItem,
  type HelpKind,
  type HelpRequest,
  type HouseState,
  type ScoreWord,
  type SensorStatus,
  type Zone,
} from '../api'
import { STATUS_COLOR } from '../theme'

const WORD_COLOR: Record<ScoreWord, string> = {
  Good: 'var(--color-ok)',
  Fair: 'var(--color-watch)',
  Attention: 'var(--color-alert)',
}

const TREND_LABEL = {
  improving: 'Improving this week',
  stable: 'Steady this week',
  declining: 'Going down this week',
} as const

// Tiny hint behind the ? — the full breakdown lives on the /score page.
function ScoreHint({ onClose }: { onClose: () => void }) {
  return (
    <div className="relative w-full rounded-2xl bg-white/10 px-3.5 py-3 text-left text-xs leading-relaxed text-white/80">
      <button
        onClick={onClose}
        aria-label="Close"
        className="absolute top-1.5 right-2.5 text-base text-white/50 hover:text-white"
      >
        ×
      </button>
      <p className="pr-4">
        Starts at 100 — points come off for the mould index, humidity that
        stays high, and fans that stop.
      </p>
      <Link
        to="/score"
        className="mt-1.5 inline-block font-medium text-white underline underline-offset-2 hover:text-white/80"
      >
        See the details →
      </Link>
    </div>
  )
}

export function ScoreRing({
  score,
  color,
  className = 'h-52 w-52',
}: {
  score: number
  color: string
  className?: string
}) {
  const r = 64
  const c = 2 * Math.PI * r
  return (
    <svg viewBox="0 0 160 160" className={`${className} -rotate-90`}>
      <circle
        cx="80"
        cy="80"
        r={r}
        fill="none"
        stroke="rgba(255,255,255,0.15)"
        strokeWidth="10"
      />
      <circle
        cx="80"
        cy="80"
        r={r}
        fill="none"
        stroke={color}
        strokeWidth="10"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - score / 100)}
        className="transition-all duration-700"
      />
    </svg>
  )
}

export const AREA_WORD: Record<SensorStatus, string> = {
  ok: 'Good',
  watch: 'Watch',
  alert: 'Check',
}

const AREA_OF_ZONE: Record<Zone, Area['id']> = {
  roof_south: 'roof',
  roof_north: 'roof',
  ridge: 'roof',
  crawl_space: 'crawl_space',
}

const ACTION_LABEL: Record<HelpKind, string> = {
  inspection: 'Book an inspection',
  expert: 'Ask a VILPE expert',
}

function AreaActions({
  item,
  requests,
  onRequested,
}: {
  item: AttentionItem
  requests: HelpRequest[]
  onRequested: () => void
}) {
  const [busy, setBusy] = useState(false)
  const done = requests.filter((r) => item.actions.includes(r.kind))
  const todo = item.actions.filter((k) => !requests.some((r) => r.kind === k))

  const request = async (kind: HelpKind) => {
    setBusy(true)
    try {
      await api.requestHelp(kind, item.sensor_id)
      onRequested()
    } finally {
      setBusy(false)
    }
  }

  return (
    <span className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
      {done.map((r) => (
        <span key={r.kind} className="text-xs text-ok/90">
          ✓ {ACTION_LABEL[r.kind]} requested
        </span>
      ))}
      {todo.map((kind, i) => (
        <button
          key={kind}
          disabled={busy}
          onClick={() => request(kind)}
          className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors disabled:opacity-50 ${
            i === 0
              ? 'bg-vilpe-orange text-white hover:bg-vilpe-orange/90'
              : 'border border-white/25 text-white/85 hover:bg-white/10'
          }`}
        >
          {ACTION_LABEL[kind]}
        </button>
      ))}
    </span>
  )
}

// The area chips double as the attention feed. Clicking one never leaves
// the page — it opens a small card saying whether all is well or what's
// going on, like the score explainer above.
function Areas({
  state,
  onRequested,
}: {
  state: HouseState
  onRequested: () => void
}) {
  const navigate = useNavigate()
  const [open, setOpen] = useState<Area['id'] | null>(null)
  const zoneOf = new Map(state.sensors.map((s) => [s.id, s.zone]))
  const hitFor = (id: Area['id']) =>
    state.attention.find((i) => AREA_OF_ZONE[zoneOf.get(i.sensor_id) ?? 'ridge'] === id)
  const openArea = state.areas.find((a) => a.id === open)
  const openHit = open ? hitFor(open) : undefined
  const openSensor = openHit && state.sensors.find((s) => s.id === openHit.sensor_id)
  return (
    <div className="flex w-full flex-col items-center gap-2">
      <div className="flex justify-center gap-2">
        {state.areas.map((a) => (
          <button
            key={a.id}
            onClick={() => setOpen(open === a.id ? null : a.id)}
            aria-expanded={open === a.id}
            className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] whitespace-nowrap transition-colors ${
              open === a.id
                ? 'border-white/40 bg-white/15 text-white'
                : 'border-white/10 bg-white/5 text-white/80 hover:bg-white/10'
            }`}
          >
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: STATUS_COLOR[a.status] }} />
            {a.name}
            <span className="font-semibold text-white">{AREA_WORD[a.status]}</span>
          </button>
        ))}
      </div>
      {openArea && (
        <div className="relative w-full rounded-2xl bg-white/10 p-3.5 text-left text-xs leading-relaxed text-white/80">
          <button
            onClick={() => setOpen(null)}
            aria-label="Close"
            className="absolute top-2 right-3 text-base text-white/50 hover:text-white"
          >
            ×
          </button>
          <p className="pr-4 font-display text-sm font-semibold text-white">
            {openArea.name} —{' '}
            <span style={{ color: STATUS_COLOR[openArea.status] }}>
              {AREA_WORD[openArea.status]}
            </span>
          </p>
          {openHit ? (
            <>
              <p className="mt-1.5">{openHit.message.split(' — ')[1] ?? openHit.message}</p>
              <p className="mt-1.5 text-white/60">
                {openHit.severity === 'alert'
                  ? 'Worth having someone look at it — services are listed below.'
                  : "We're keeping an eye on it — nothing to do yet."}
              </p>
              {openSensor && (
                <button
                  onClick={() => navigate(`/sensors/${openSensor.id}`)}
                  className="mt-2 font-medium text-white underline underline-offset-2 hover:text-white/80"
                >
                  See {openSensor.name} →
                </button>
              )}
              {openHit.actions.length > 0 && (
                <AreaActions
                  item={openHit}
                  requests={state.open_requests}
                  onRequested={onRequested}
                />
              )}
            </>
          ) : (
            <p className="mt-1.5">Dry and healthy — nothing to do here.</p>
          )}
        </div>
      )}
    </div>
  )
}

export default function ScoreCard({
  state,
  onRequested,
}: {
  state: HouseState
  onRequested: () => void
}) {
  const color = WORD_COLOR[state.score_word]
  const [explain, setExplain] = useState(false)
  const navigate = useNavigate()
  return (
    <section className="flex flex-col items-center gap-4 text-center">
      <button
        onClick={() => navigate('/score')}
        aria-label="Open the Home score details"
        className="relative flex cursor-pointer items-center justify-center rounded-full transition-transform hover:scale-[1.02]"
      >
        <ScoreRing score={state.score} color={color} />
        <div className="absolute flex flex-col items-center">
          <span className="font-display text-6xl font-bold text-white">
            {state.score}
          </span>
          <span
            className="font-display text-base font-semibold tracking-wide"
            style={{ color }}
          >
            {state.score_word}
          </span>
        </div>
      </button>
      <div className="flex items-center gap-1.5 text-xs font-medium tracking-wide text-white/60">
        Home score · {TREND_LABEL[state.score_trend]}
        <button
          onClick={() => setExplain((v) => !v)}
          aria-expanded={explain}
          aria-label="What is the Home score?"
          className={`flex h-[18px] w-[18px] items-center justify-center rounded-full border text-[11px] font-bold transition-colors ${
            explain
              ? 'border-white bg-white text-navy'
              : 'border-white/40 text-white/70 hover:border-white hover:text-white'
          }`}
        >
          ?
        </button>
      </div>
      {explain && <ScoreHint onClose={() => setExplain(false)} />}
      <Areas state={state} onRequested={onRequested} />
    </section>
  )
}
