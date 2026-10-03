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

// Lives inside the navy sidebar — light-on-dark styling, no card chrome.
export default function AttentionFeed({ items }: { items: AttentionItem[] }) {
  return (
    <section className="flex flex-col gap-3 border-t border-white/10 pt-4">
      <h2 className="font-display text-xs font-semibold tracking-[0.25em] text-white/50 uppercase">
        Needs attention
      </h2>
      {items.length === 0 && (
        <p className="text-sm text-white/50">
          Everything looks normal — nothing needs your attention right now.
        </p>
      )}
      {items.map((a) => (
        <article key={a.sensor_id + a.since} className="flex items-start gap-3">
          <span
            className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ background: SEVERITY_COLOR[a.severity] }}
          />
          <div className="flex flex-col gap-1">
            <p className="text-sm leading-relaxed text-white/85">{a.message}</p>
            <span className="text-xs text-white/40">{since(a.since)}</span>
          </div>
        </article>
      ))}
    </section>
  )
}
