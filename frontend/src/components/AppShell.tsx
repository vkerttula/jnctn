import { useState } from 'react'
import { Link, NavLink, Outlet } from 'react-router-dom'
import { api } from '../api'
import Clock from './Clock'
import ScoreCard from './ScoreCard'
import ServicesList from './ServicesList'
import { useHouseState } from '../hooks/useHouseState'

const NAV = [
  { to: '/', label: 'Overview', end: true },
  { to: '/sensors', label: 'Sensors', end: false },
]

// Persistent app frame: navy rail with brand, nav and house status; the
// routed view fills the rest of the viewport.
export default function AppShell() {
  const { state, error, refresh } = useHouseState()
  const [busy, setBusy] = useState(false)

  const demo = async (action: 'leak' | 'reset') => {
    setBusy(true)
    try {
      if (action === 'leak') await api.simulateLeak()
      else await api.resetDemo()
      refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-svh flex-col bg-mist lg:h-svh lg:flex-row print:block print:h-auto print:bg-white">
      <aside className="flex w-full shrink-0 flex-col gap-5 bg-navy px-6 py-6 text-white lg:h-svh lg:w-[340px] lg:overflow-y-auto print:hidden">
        <div className="flex items-center gap-3">
          <img src="/vilpe-logo.png" alt="VILPE" className="h-6 w-auto" />
          <span className="h-7 w-px bg-white/25" aria-hidden />
          <span className="font-display text-[13px] leading-tight font-semibold tracking-wide text-white/80">
            Peace of mind
            <br />
            for your home
          </span>
        </div>

        <nav className="flex gap-1 rounded-full border border-white/10 bg-white/5 p-1">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) =>
                `flex-1 rounded-full px-3 py-1.5 text-center text-xs font-medium transition-colors ${
                  isActive
                    ? 'bg-white/15 text-white'
                    : 'text-white/55 hover:text-white'
                }`
              }
            >
              {n.label}
            </NavLink>
          ))}
        </nav>

        {error && (
          <div className="rounded-2xl border border-alert/40 bg-alert/10 p-4 text-sm text-white/90">
            Could not load house state.
          </div>
        )}

        {state && <ScoreCard state={state} />}
        <ServicesList requests={state?.open_requests ?? []} onRequested={refresh} />

        <div className="mt-auto flex flex-col gap-3 border-t border-white/10 pt-4">
          <Clock />
          <div className="flex items-center gap-2">
            {state?.simulating ? (
              <button
                onClick={() => demo('reset')}
                disabled={busy}
                className="rounded-full border border-white/20 bg-white/10 px-4 py-1.5 text-xs font-medium text-white transition-colors hover:bg-white/20 disabled:opacity-50"
              >
                Reset demo
              </button>
            ) : (
              <button
                onClick={() => demo('leak')}
                disabled={busy}
                className="rounded-full border border-white/20 bg-white/10 px-4 py-1.5 text-xs font-medium text-white/70 transition-colors hover:bg-white/20 disabled:opacity-50"
              >
                Simulate leak
              </button>
            )}
            {state?.simulating && (
              <span className="rounded-full bg-watch/20 px-3 py-1.5 text-xs font-semibold text-watch">
                demo running
              </span>
            )}
            <span className="ml-auto flex gap-3">
              <Link
                to="/status"
                className="text-xs text-white/40 underline-offset-2 hover:underline"
              >
                status ↗
              </Link>
              <Link
                to="/data"
                className="text-xs text-white/40 underline-offset-2 hover:underline"
              >
                raw data ↗
              </Link>
            </span>
          </div>
        </div>
      </aside>

      <div className="relative min-h-[55svh] flex-1 overflow-hidden lg:h-full lg:min-h-0 print:h-auto print:overflow-visible">
        <Outlet context={{ state }} />
      </div>
    </div>
  )
}
