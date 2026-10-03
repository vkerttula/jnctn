import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api'
import AttentionFeed from '../components/AttentionFeed'
import HouseScene from '../components/HouseScene'
import ScoreCard from '../components/ScoreCard'
import { useHouseState } from '../hooks/useHouseState'

function WeatherChip({ temp, condition, location }: { temp: number; condition: string; location: string }) {
  return (
    <div className="flex items-center gap-2 rounded-full border border-line bg-white px-4 py-1.5 text-xs text-muted shadow-sm">
      <span className="font-semibold text-navy">{temp.toFixed(0)}°C</span>
      <span>{condition}</span>
      <span className="text-navy/60">· {location}</span>
    </div>
  )
}

export default function HomePage() {
  const { state, error, refresh } = useHouseState()
  const navigate = useNavigate()
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
    <main className="min-h-svh bg-mist">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-5 py-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-baseline gap-3">
            <span className="font-display text-2xl font-bold tracking-tight text-navy">
              jnctn
            </span>
            <span className="text-xs font-medium tracking-[0.2em] text-muted uppercase">
              powered by VILPE Sense
            </span>
          </div>
          <div className="flex items-center gap-2">
            {state?.simulating && (
              <span className="rounded-full bg-watch/15 px-3 py-1.5 text-xs font-semibold text-navy">
                demo running
              </span>
            )}
            {state && (
              <WeatherChip
                temp={state.weather.temp_c}
                condition={state.weather.condition}
                location={state.weather.location}
              />
            )}
          </div>
        </header>

        {error && (
          <div className="rounded-2xl border border-alert/30 bg-alert/5 p-4 text-sm text-alert">
            Could not load house state.
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
          <div className="relative overflow-hidden rounded-3xl border border-line bg-gradient-to-b from-white to-mist shadow-sm">
            <div className="h-[420px] lg:h-[560px]">
              {state ? (
                <HouseScene
                  sensors={state.sensors}
                  onSelect={(s) => navigate(`/sensors/${s.id}`)}
                />
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-muted">
                  Loading your house…
                </div>
              )}
            </div>
            <div className="pointer-events-none absolute bottom-4 left-5 text-xs text-muted">
              drag to rotate · click a dot for details
            </div>
          </div>

          <div className="flex flex-col gap-6">
            {state && <ScoreCard state={state} />}
            {state && <AttentionFeed items={state.attention} />}
          </div>
        </div>

        <footer className="flex items-center justify-between">
          <span className="text-xs text-muted">
            updated{' '}
            {state ? new Date(state.updated_at).toLocaleString('en-GB') : '—'}
          </span>
          <div className="flex items-center gap-2">
            {state?.simulating ? (
              <button
                onClick={() => demo('reset')}
                disabled={busy}
                className="rounded-full border border-line bg-white px-4 py-1.5 text-xs font-medium text-navy shadow-sm transition-colors hover:border-navy/30 disabled:opacity-50"
              >
                Reset demo
              </button>
            ) : (
              <button
                onClick={() => demo('leak')}
                disabled={busy}
                className="rounded-full border border-vilpe-orange/40 bg-vilpe-orange/10 px-4 py-1.5 text-xs font-medium text-vilpe-orange transition-colors hover:bg-vilpe-orange/20 disabled:opacity-50"
              >
                Simulate leak
              </button>
            )}
            <Link
              to="/status"
              className="text-xs text-muted underline-offset-2 hover:underline"
            >
              status ↗
            </Link>
            <Link
              to="/data"
              className="text-xs text-muted underline-offset-2 hover:underline"
            >
              raw data ↗
            </Link>
          </div>
        </footer>
      </div>
    </main>
  )
}
