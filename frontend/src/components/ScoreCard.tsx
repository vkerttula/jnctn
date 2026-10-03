import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Area, HouseState, ScoreWord, SensorStatus, Zone } from '../api'
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

// Plain-language explainer behind the ⓘ. Grounded in how VILPE Sense
// itself works: the Finnish mould growth model (VTT / Tampere University),
// a 0–6 mould index with an automatic alert above 2.5, and fan control from
// structure vs. outdoor absolute humidity.
function ScoreExplainer({ onClose }: { onClose: () => void }) {
  return (
    <div className="relative flex w-full flex-col gap-3 rounded-2xl bg-white/10 p-4 text-left text-xs leading-relaxed text-white/80">
      <button
        onClick={onClose}
        aria-label="Close"
        className="absolute top-2.5 right-3 text-base text-white/50 hover:text-white"
      >
        ×
      </button>
      <p className="pr-4 font-display text-sm font-semibold text-white">What is the Home score?</p>
      <p>
        One number for how your home's hidden structures — the roof and the crawl space — are
        doing. 100 means dry and healthy.
      </p>
      <div className="flex gap-1.5">
        {(
          [
            ['75–100', 'Good', 'var(--color-ok)'],
            ['60–74', 'Fair', 'var(--color-watch)'],
            ['0–59', 'Attention', 'var(--color-alert)'],
          ] as const
        ).map(([range, word, c]) => (
          <span key={word} className="flex flex-1 flex-col items-center rounded-lg bg-white/5 py-1.5">
            <span className="font-semibold" style={{ color: c }}>
              {word}
            </span>
            <span className="text-[10px] text-white/50">{range}</span>
          </span>
        ))}
      </div>
      <p>
        <span className="font-semibold text-white">How it's worked out:</span> we combine the
        humidity and temperature inside your structures with the outdoor weather and the season,
        using the Finnish mould growth model developed by VTT. It changes slowly — one damp day
        won't move it.
      </p>
      <p>
        <span className="font-semibold text-white">When we tell you:</span> if conditions start
        to favour mould, or moisture rises suddenly like after a leak, you'll hear from us right
        away — with what to do next.
      </p>
      <a
        href="https://www.vilpe.com/en/vilpe-sense-mould-index/"
        target="_blank"
        rel="noreferrer"
        className="font-medium text-white underline-offset-2 hover:underline"
      >
        About the mould growth model ↗
      </a>
    </div>
  )
}

function ScoreRing({ score, color }: { score: number; color: string }) {
  const r = 64
  const c = 2 * Math.PI * r
  return (
    <svg viewBox="0 0 160 160" className="h-40 w-40 -rotate-90">
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

const AREA_WORD: Record<SensorStatus, string> = { ok: 'Good', watch: 'Watch', alert: 'Check' }

const AREA_OF_ZONE: Record<Zone, Area['id']> = {
  roof_south: 'roof',
  roof_north: 'roof',
  ridge: 'roof',
  crawl_space: 'crawl_space',
}

// The area chips double as the attention feed. Clicking one never leaves
// the page — it opens a small card saying whether all is well or what's
// going on, like the score explainer above.
function Areas({ state }: { state: HouseState }) {
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
            className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] whitespace-nowrap transition-colors ${
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
            </>
          ) : (
            <p className="mt-1.5">Dry and healthy — nothing to do here.</p>
          )}
        </div>
      )}
    </div>
  )
}

export default function ScoreCard({ state }: { state: HouseState }) {
  const color = WORD_COLOR[state.score_word]
  const [explain, setExplain] = useState(false)
  return (
    <section className="flex flex-col items-center gap-4 text-center">
      <div className="relative flex items-center justify-center">
        <ScoreRing score={state.score} color={color} />
        <div className="absolute flex flex-col items-center">
          <span className="font-display text-5xl font-bold text-white">
            {state.score}
          </span>
          <span
            className="font-display text-sm font-semibold tracking-wide"
            style={{ color }}
          >
            {state.score_word}
          </span>
        </div>
      </div>
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
      {explain && <ScoreExplainer onClose={() => setExplain(false)} />}
      <Areas state={state} />
    </section>
  )
}
