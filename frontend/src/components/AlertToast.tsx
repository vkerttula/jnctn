import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { AttentionItem } from '../api'

const SHOW_MS = 9000

// Phone-notification-style preview of the push the homeowner would get the
// moment an alert appears — the vision's "hear first when you're not fine".
// Fires once per new alert item.
export default function AlertToast({
  items,
  headline,
}: {
  items: AttentionItem[]
  headline: string
}) {
  const navigate = useNavigate()
  const seen = useRef(new Set<string>())
  const [toast, setToast] = useState<AttentionItem | null>(null)

  const timers = useRef<ReturnType<typeof setTimeout>[]>([])

  // Polls hand in a new array each time; the seen-set makes each alert toast
  // once, and timers are not cleared per poll so the toast hides on schedule.
  useEffect(() => {
    const fresh = items.find((a) => a.severity === 'alert' && !seen.current.has(a.sensor_id + a.since))
    if (!fresh) return
    seen.current.add(fresh.sensor_id + fresh.since)
    timers.current.push(
      setTimeout(() => setToast(fresh), 0),
      setTimeout(() => setToast((t) => (t === fresh ? null : t)), SHOW_MS),
    )
  }, [items])

  useEffect(() => () => timers.current.forEach(clearTimeout), [])

  if (!toast) return null

  return (
    <button
      onClick={() => {
        setToast(null)
        navigate(`/sensors/${toast.sensor_id}`)
      }}
      className="toast-in fixed top-5 right-5 z-50 flex w-[360px] items-start gap-3 rounded-2xl border border-white/60 bg-white/90 p-4 text-left shadow-2xl shadow-navy/20 backdrop-blur-xl print:hidden"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-navy">
        <img src="/vilpe-logo.png" alt="" className="w-6" />
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="flex items-center justify-between text-[11px] text-muted">
          <span className="font-semibold tracking-wide uppercase">VILPE Sense</span>
          <span>now</span>
        </span>
        <span className="text-sm font-semibold text-navy">{headline}</span>
        <span className="line-clamp-2 text-xs leading-relaxed text-navy/70">{toast.message}</span>
      </span>
    </button>
  )
}
