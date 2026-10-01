import { useEffect, useState } from 'react'

// Empty in dev — the Vite proxy forwards /api to the backend. See .env.example.
const API_URL = import.meta.env.VITE_API_URL ?? ''

type Status = 'loading' | 'ok' | 'error'

function useCheck(path: string) {
  const [status, setStatus] = useState<Status>('loading')
  const [detail, setDetail] = useState('')

  useEffect(() => {
    fetch(`${API_URL}${path}`)
      .then(async (r) => {
        setDetail(JSON.stringify(await r.json()))
        setStatus(r.ok ? 'ok' : 'error')
      })
      .catch((e) => {
        setDetail(String(e))
        setStatus('error')
      })
  }, [path])

  return { status, detail }
}

const DOT: Record<Status, string> = {
  loading: 'bg-amber-400 animate-pulse',
  ok: 'bg-emerald-400',
  error: 'bg-red-400',
}

function Row({ label, path }: { label: string; path: string }) {
  const { status, detail } = useCheck(path)
  return (
    <div className="flex items-center gap-3 rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-3">
      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${DOT[status]}`} />
      <div className="min-w-0">
        <div className="text-sm font-medium text-neutral-100">
          {label} <code className="text-neutral-500">{path}</code>
        </div>
        {detail && (
          <div className="truncate font-mono text-xs text-neutral-500">
            {detail}
          </div>
        )}
      </div>
    </div>
  )
}

function App() {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-6 bg-neutral-950 p-8">
      <h1 className="text-3xl font-semibold text-neutral-100">
        jnctn — status
      </h1>
      <div className="flex w-full max-w-md flex-col gap-3">
        <Row label="API" path="/api/health" />
        <Row label="MongoDB" path="/api/db-ping" />
      </div>
    </main>
  )
}

export default App
