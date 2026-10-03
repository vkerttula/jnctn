import { useEffect, useState } from 'react'

// Live local time — one compact line, shares the sidebar footer's row with
// the demo controls and dev links.
export default function Clock() {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 10_000)
    return () => clearInterval(t)
  }, [])

  return (
    <span className="flex items-baseline gap-1.5 whitespace-nowrap tabular-nums">
      <span className="font-display text-sm font-semibold text-white">
        {now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
      </span>
      <span className="text-[11px] text-white/45">
        {now.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
      </span>
    </span>
  )
}
