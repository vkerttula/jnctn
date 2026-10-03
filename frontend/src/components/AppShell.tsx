import { useState } from 'react'
import { Link, NavLink, Outlet } from 'react-router-dom'
import { getUser, signOut } from '../auth'
import Clock from './Clock'
import Spinner from './Spinner'
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
  const [signingOut, setSigningOut] = useState(false)
  const user = getUser()

  // Same brief staged beat as the login card before the page swap.
  const leave = () => {
    setSigningOut(true)
    window.setTimeout(signOut, 1200)
  }

  return (
    <div className="flex min-h-svh flex-col bg-mist lg:h-svh lg:flex-row print:block print:h-auto print:bg-white">
      <aside className="flex w-full shrink-0 flex-col gap-5 bg-navy px-6 py-6 text-white lg:h-svh lg:w-[340px] lg:overflow-y-auto print:hidden">
        <div className="flex items-center gap-3">
          <img src="/vilpe-logo.png" alt="VILPE" className="h-8 w-auto" />
          <span className="h-9 w-px bg-white/25" aria-hidden />
          <span className="font-display text-sm leading-tight font-semibold tracking-wide text-white/80">
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

        {state && <ScoreCard state={state} onRequested={refresh} />}
        <ServicesList requests={state?.open_requests ?? []} onRequested={refresh} />

        <div className="mt-auto flex flex-col gap-3 border-t border-white/10 pt-4">
          {user && (
            <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-3 py-2.5">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sense text-xs font-semibold">
                {user.initials}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{user.name}</p>
                <p className="truncate text-xs text-white/50">{user.home}</p>
              </div>
              <button
                onClick={leave}
                className="shrink-0 text-xs text-white/50 underline-offset-2 transition-colors hover:text-white hover:underline"
              >
                Log out
              </button>
            </div>
          )}
          <div className="flex items-center gap-2.5">
            <Clock />
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
        <Outlet context={{ state, refresh }} />
      </div>

      {signingOut && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy">
          <div className="flex flex-col items-center gap-4 text-white">
            <Spinner dark />
            <p className="font-display text-base font-semibold">
              Signing you out…
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
