import { useEffect, useState } from 'react'

// Live local time at the foot of the sidebar.
export default function Clock() {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 10_000)
    return () => clearInterval(t)
  }, [])

  return (
    <div className="flex items-baseline gap-2">
      <span className="font-display text-2xl font-semibold text-white tabular-nums">
        {now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
      </span>
      <span className="text-xs text-white/55">
        {now.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
      </span>
    </div>
  )
}
