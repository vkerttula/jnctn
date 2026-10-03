import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from 'react'

// Empty in dev — the Vite proxy forwards /api to the backend. See .env.example.
const API_URL = import.meta.env.VITE_API_URL ?? ''

type Stats = {
  page_views: number
  notes: number
  mongo: string
  uptime_seconds: number
}

type Note = { id: string; text: string; created_at: string }

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${seconds % 60}s`
  return `${seconds}s`
}

function StatCard({
  label,
  value,
  sub,
}: {
  label: string
  value: string
  sub?: string
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 backdrop-blur-sm transition-colors hover:border-fuchsia-400/40">
      <div className="text-[0.65rem] font-medium uppercase tracking-[0.25em] text-white/50">
        {label}
      </div>
      <div className="mt-2 font-zen text-2xl text-white sm:text-3xl">
        {value}
      </div>
      {sub && <div className="mt-1 text-xs text-white/40">{sub}</div>}
    </div>
  )
}

function DbPing({ onSent }: { onSent: () => void }) {
  const [text, setText] = useState('')
  const [last, setLast] = useState<Note | null>(null)
  const [state, setState] = useState<'idle' | 'sending' | 'error'>('idle')

  const send = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const trimmed = text.trim()
    if (!trimmed || state === 'sending') return
    setState('sending')
    try {
      const r = await fetch(`${API_URL}/api/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: trimmed }),
      })
      if (!r.ok) throw new Error(String(r.status))
      setLast(await r.json())
      setText('')
      setState('idle')
      onSent()
    } catch {
      setState('error')
    }
  }

  return (
    <form
      onSubmit={send}
      className="flex w-full max-w-md flex-col gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-5 backdrop-blur-sm"
    >
      <div className="text-[0.65rem] font-medium uppercase tracking-[0.25em] text-white/50">
        Write to MongoDB
      </div>
      <div className="flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Leave a note in the database…"
          className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none placeholder:text-white/30 focus:border-fuchsia-400/60"
        />
        <button
          type="submit"
          disabled={state === 'sending'}
          className="rounded-lg bg-fuchsia-400 px-4 py-2 text-sm font-bold uppercase tracking-wider text-black transition-colors hover:bg-fuchsia-300 disabled:opacity-50"
        >
          Send
        </button>
      </div>
      {state === 'error' && (
        <div className="text-xs text-red-400">Could not reach the API.</div>
      )}
      {last && (
        <div className="truncate font-mono text-xs text-white/40">
          saved → notes/{last.id} · “{last.text}”
        </div>
      )}
    </form>
  )
}

function StatusPage() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [apiOk, setApiOk] = useState<boolean | null>(null)
  const tracked = useRef(false)

  const loadStats = useCallback(() => {
    fetch(`${API_URL}/api/stats`)
      .then(async (r) => {
        setApiOk(r.ok)
        if (r.ok) setStats(await r.json())
      })
      .catch(() => setApiOk(false))
  }, [])

  useEffect(() => {
    if (!tracked.current) {
      tracked.current = true
      fetch(`${API_URL}/api/stats/track`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: window.location.pathname }),
      }).catch(() => {})
    }
    loadStats()
    const t = setInterval(loadStats, 5000)
    return () => clearInterval(t)
  }, [loadStats])

  return (
    <main className="relative min-h-svh overflow-hidden bg-[#050505] text-white">
      <div className="stars pointer-events-none absolute inset-0 opacity-60" />
      <div className="pointer-events-none absolute -top-40 -left-40 h-[34rem] w-[34rem] rounded-full bg-fuchsia-500/20 blur-[120px]" />
      <div className="pointer-events-none absolute top-1/3 -right-40 h-[30rem] w-[30rem] rounded-full bg-violet-500/15 blur-[120px]" />
      <div className="pointer-events-none absolute -bottom-48 left-1/4 h-[28rem] w-[28rem] rounded-full bg-cyan-400/10 blur-[120px]" />

      <div className="relative mx-auto flex min-h-svh w-full max-w-4xl flex-col items-center justify-center gap-10 px-6 py-16">
        <header className="flex flex-col items-center gap-3 text-center">
          <div className="font-zen text-sm tracking-[0.5em] text-white/70">
            JUNCTION&nbsp;✕
          </div>
          <h1 className="font-zen text-6xl text-fuchsia-300 drop-shadow-[0_0_25px_rgba(232,121,249,0.5)] sm:text-8xl">
            VAASA
          </h1>
          <div className="font-zen text-2xl tracking-[0.3em] sm:text-3xl">
            HACKATHON
          </div>
          <div className="font-zen text-sm tracking-[0.35em] text-fuchsia-300 drop-shadow-[0_0_12px_rgba(232,121,249,0.6)]">
            3–4.10.2026
          </div>
        </header>

        <section className="grid w-full grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard
            label="Page views"
            value={stats ? String(stats.page_views) : '—'}
            sub="tracked in MongoDB"
          />
          <StatCard
            label="Notes stored"
            value={stats ? String(stats.notes) : '—'}
            sub="notes collection"
          />
          <StatCard
            label="MongoDB"
            value={
              stats ? stats.mongo.toUpperCase() : apiOk === false ? 'DOWN' : '—'
            }
            sub="/api/stats"
          />
          <StatCard
            label="API uptime"
            value={stats ? formatUptime(stats.uptime_seconds) : '—'}
            sub="FastAPI process"
          />
        </section>

        <DbPing onSent={loadStats} />

        <footer className="font-mono text-xs text-white/30">
          live from MongoDB · inspect at mongo-express :8081 ·{' '}
          <a href="/data" className="underline hover:text-white/60">
            /data explorer
          </a>
        </footer>
      </div>
    </main>
  )
}

export default StatusPage
