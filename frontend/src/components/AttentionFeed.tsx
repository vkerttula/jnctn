import type { AttentionItem } from '../api'
import { SEVERITY_COLOR } from '../theme'

function since(isoDate: string): string {
  const mins = Math.max(0, Math.round((Date.now() - Date.parse(isoDate)) / 60000))
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const h = Math.round(mins / 60)
  if (h < 24) return `${h} h ago`
  return `${Math.round(h / 24)} d ago`
}

export default function AttentionFeed({ items }: { items: AttentionItem[] }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-display text-xs font-semibold tracking-[0.25em] text-muted uppercase">
        Needs attention
      </h2>
      {items.length === 0 && (
        <div className="rounded-3xl border border-white/60 bg-white/75 p-5 text-sm text-muted shadow-lg shadow-navy/5 backdrop-blur-xl">
          Everything looks normal — nothing needs your attention right now.
        </div>
      )}
      {items.map((a) => (
        <article
          key={a.sensor_id + a.since}
          className="flex items-start gap-3 rounded-3xl border border-white/60 bg-white/75 p-5 shadow-lg shadow-navy/5 backdrop-blur-xl"
        >
          <span
            className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ background: SEVERITY_COLOR[a.severity] }}
          />
          <div className="flex flex-col gap-1">
            <p className="text-sm leading-relaxed text-navy/90">{a.message}</p>
            <span className="text-xs text-muted">{since(a.since)}</span>
          </div>
        </article>
      ))}
    </section>
  )
}
