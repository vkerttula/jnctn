import { useState } from 'react'
import { api, type AttentionItem, type HelpKind, type HelpRequest } from '../api'
import { timeAgo } from '../labels'
import { SEVERITY_COLOR } from '../theme'

const ACTION_LABEL: Record<HelpKind, string> = {
  inspection: 'Book an inspection',
  expert: 'Ask a VILPE expert',
}

function Actions({
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
    <div className="flex flex-col gap-2">
      {done.map((r) => (
        <p
          key={r.kind}
          className="flex items-start gap-2 rounded-xl bg-white/10 px-3 py-2 text-xs leading-relaxed text-white/85"
        >
          <span className="mt-0.5 text-ok">✓</span>
          {ACTION_LABEL[r.kind]} requested · {r.status_text}
        </p>
      ))}
      {todo.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {todo.map((kind, i) => (
            <button
              key={kind}
              disabled={busy}
              onClick={() => request(kind)}
              className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50 ${
                i === 0
                  ? 'bg-vilpe-orange text-white hover:bg-vilpe-orange/90'
                  : 'border border-white/25 text-white/85 hover:bg-white/10'
              }`}
            >
              {ACTION_LABEL[kind]}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// Lives inside the navy sidebar. Only rendered when something needs the
// homeowner — the overview headline already says when all is well.
export default function AttentionFeed({
  items,
  requests,
  onRequested,
}: {
  items: AttentionItem[]
  requests: HelpRequest[]
  onRequested: () => void
}) {
  if (items.length === 0) return null
  return (
    <section className="flex flex-col gap-3 border-t border-white/10 pt-4">
      <h2 className="font-display text-xs font-semibold tracking-[0.25em] text-white/50 uppercase">
        Needs attention
      </h2>
      {items.map((a) => (
        <article
          key={a.sensor_id + a.since}
          className="flex items-start gap-3 rounded-2xl border-l-4 bg-white/5 p-4"
          style={{ borderLeftColor: SEVERITY_COLOR[a.severity] }}
        >
          <span
            className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ background: SEVERITY_COLOR[a.severity] }}
          />
          <div className="flex flex-col gap-2">
            <p className="text-sm leading-relaxed text-white/85">{a.message}</p>
            <span className="text-xs text-white/40">{timeAgo(a.since)}</span>
            {a.actions.length > 0 && (
              <Actions item={a} requests={requests} onRequested={onRequested} />
            )}
          </div>
        </article>
      ))}
    </section>
  )
}
