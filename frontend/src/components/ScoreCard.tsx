import type { HouseState, ScoreWord } from '../api'

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
        stroke="var(--color-line)"
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

export default function ScoreCard({ state }: { state: HouseState }) {
  const color = WORD_COLOR[state.score_word]
  return (
    <section className="flex flex-col items-center gap-4 rounded-3xl border border-line bg-white p-6 text-center shadow-sm">
      <div className="relative flex items-center justify-center">
        <ScoreRing score={state.score} color={color} />
        <div className="absolute flex flex-col items-center">
          <span className="font-display text-5xl font-bold text-navy">
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
      <div className="text-xs font-medium tracking-wide text-muted">
        {TREND_LABEL[state.score_trend]}
      </div>
      <p className="max-w-xs text-sm leading-relaxed text-navy/80">
        {state.summary}
      </p>
    </section>
  )
}
