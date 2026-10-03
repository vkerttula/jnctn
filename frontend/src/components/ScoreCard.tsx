import type { Area, HouseState, ScoreWord, SensorStatus } from '../api'
import { STATUS_COLOR } from '../theme'

const WORD_COLOR: Record<ScoreWord, string> = {
  Good: 'var(--color-ok)',
  Fair: 'var(--color-watch)',
  Attention: 'var(--color-alert)',
}

const TREND_LABEL = {
  improving: '↗ improving',
  stable: '→ stable',
  declining: '↘ declining',
} as const

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

// 30-day score line, Oura-style: slow and steady is the point.
function History({ days, color }: { days: HouseState['score_history']; color: string }) {
  const W = 240
  const H = 44
  const scores = days.map((d) => d.score)
  const lo = Math.max(0, Math.min(...scores) - 6)
  const hi = Math.min(100, Math.max(...scores) + 6)
  const pts = scores.map((s, i) => [
    (i / Math.max(1, scores.length - 1)) * W,
    H - ((s - lo) / Math.max(1, hi - lo)) * H,
  ])
  const line = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  const [lx, ly] = pts[pts.length - 1]
  return (
    <div className="flex w-full flex-col gap-1">
      <svg viewBox={`-4 -4 ${W + 8} ${H + 8}`} className="h-12 w-full" preserveAspectRatio="none">
        <polygon points={`0,${H} ${line} ${W},${H}`} fill={color} opacity={0.12} />
        <polyline points={line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        <circle cx={lx} cy={ly} r={3.5} fill={color} />
      </svg>
      <div className="flex justify-between text-[10px] text-white/40">
        <span>30 days ago</span>
        <span>Today</span>
      </div>
    </div>
  )
}

function Areas({ areas }: { areas: Area[] }) {
  return (
    <div className="flex w-full justify-center gap-2">
      {areas.map((a) => (
        <span
          key={a.id}
          className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/80"
        >
          <span className="h-2 w-2 rounded-full" style={{ background: STATUS_COLOR[a.status] }} />
          {a.name}
          <span className="font-semibold text-white">{AREA_WORD[a.status]}</span>
        </span>
      ))}
    </div>
  )
}

export default function ScoreCard({ state }: { state: HouseState }) {
  const color = WORD_COLOR[state.score_word]
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
      <div className="text-xs font-medium tracking-wide text-white/50">
        Home score · {TREND_LABEL[state.score_trend]}
      </div>
      <Areas areas={state.areas} />
      <History days={state.score_history} color={color} />
    </section>
  )
}
