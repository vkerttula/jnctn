import { useEffect, useState, type FormEvent } from 'react'

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

type Note = { id: string; text: string; created_at: string }

function Notes() {
  const [notes, setNotes] = useState<Note[]>([])
  const [text, setText] = useState('')

  useEffect(() => {
    fetch(`${API_URL}/api/notes`)
      .then((r) => r.json())
      .then(setNotes)
      .catch(() => {})
  }, [])

  const add = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const trimmed = text.trim()
    if (!trimmed) return
    const r = await fetch(`${API_URL}/api/notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: trimmed }),
    })
    if (!r.ok) return
    const note: Note = await r.json()
    setNotes((ns) => [note, ...ns])
    setText('')
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-3">
      <div className="text-sm font-medium text-neutral-100">
        Notes <code className="text-neutral-500">GET/POST /api/notes</code>
      </div>
      <form onSubmit={add} className="flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Add a note…"
          className="min-w-0 flex-1 rounded-md border border-neutral-800 bg-neutral-950 px-2 py-1 text-sm text-neutral-100 outline-none focus:border-neutral-600"
        />
        <button
          type="submit"
          className="rounded-md bg-neutral-100 px-3 py-1 text-sm font-medium text-neutral-900 hover:bg-neutral-300"
        >
          Add
        </button>
      </form>
      {notes.length > 0 && (
        <ul className="flex flex-col gap-1">
          {notes.map((n) => (
            <li key={n.id} className="truncate text-sm text-neutral-300">
              {n.text}
            </li>
          ))}
        </ul>
      )}
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
        <Notes />
      </div>
    </main>
  )
}

export default App
