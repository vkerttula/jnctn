import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
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
    <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs">
      {done.map((r) => (
        <span key={r.kind} className="text-ok/90">
          ✓ {ACTION_LABEL[r.kind]} requested
        </span>
      ))}
      {todo.map((kind) => (
        <button
          key={kind}
          disabled={busy}
          onClick={(e) => {
            e.stopPropagation()
            request(kind)
          }}
          className="font-semibold text-white/80 underline decoration-white/30 underline-offset-2 transition-colors hover:text-white disabled:opacity-50"
        >
          {ACTION_LABEL[kind]}
        </button>
      ))}
    </span>
  )
}

// Lives inside the navy sidebar. Calm one-liners — the score ring and the
// overview headline carry the alarm, this list just says where and offers
// the next step. Only rendered when something needs the homeowner.
export default function AttentionFeed({
  items,
  requests,
  onRequested,
}: {
  items: AttentionItem[]
  requests: HelpRequest[]
  onRequested: () => void
}) {
  const navigate = useNavigate()
  if (items.length === 0) return null
  return (
    <section className="flex flex-col gap-3 border-t border-white/10 pt-4">
      <h2 className="font-display text-xs font-semibold tracking-[0.25em] text-white/50 uppercase">
        Needs attention
      </h2>
      <ul className="flex flex-col gap-2.5">
        {items.map((a) => {
          const title = a.message.split(' — ')[0]
          return (
            <li key={a.sensor_id + a.since}>
              <button
                onClick={() => navigate(`/sensors/${a.sensor_id}`)}
                className="flex w-full items-start gap-2.5 text-left"
              >
                <span
                  className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                  style={{ background: SEVERITY_COLOR[a.severity] }}
                />
                <span className="flex flex-col gap-0.5">
                  <span className="text-sm leading-snug text-white/85">
                    {title}
                  </span>
                  <span className="flex flex-wrap items-center gap-x-2.5 text-xs text-white/40">
                    {timeAgo(a.since)}
                    {a.actions.length > 0 && (
                      <Actions
                        item={a}
                        requests={requests}
                        onRequested={onRequested}
                      />
                    )}
                  </span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
