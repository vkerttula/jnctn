import { useNavigate } from 'react-router-dom'
import type { AttentionItem } from '../api'
import { SEVERITY_COLOR } from '../theme'

// Lives inside the navy sidebar. Just quiet severity icons — the score
// ring and headline carry the message; hovering an icon names the issue
// and clicking it opens the sensor page. Actions live in Services.
export default function AttentionFeed({ items }: { items: AttentionItem[] }) {
  const navigate = useNavigate()
  if (items.length === 0) return null
  return (
    <div className="flex gap-2 border-t border-white/10 pt-4">
      {items.map((a) => {
        const title = a.message.split(' — ')[0]
        return (
          <button
            key={a.sensor_id + a.since}
            title={title}
            aria-label={title}
            onClick={() => navigate(`/sensors/${a.sensor_id}`)}
            className="flex h-8 w-8 items-center justify-center rounded-full transition-transform hover:scale-110"
            style={{
              background: `${SEVERITY_COLOR[a.severity]}26`,
              color: SEVERITY_COLOR[a.severity],
            }}
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current" aria-hidden>
              <path d="M12 3 1.7 20.2a1 1 0 0 0 .86 1.5h18.88a1 1 0 0 0 .86-1.5L12 3Zm-1 7h2v5h-2v-5Zm0 6.5h2V19h-2v-2.5Z" />
            </svg>
          </button>
        )
      })}
    </div>
  )
}
