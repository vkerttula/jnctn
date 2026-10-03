import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api'
import AttentionFeed from '../components/AttentionFeed'
import HouseScene from '../components/HouseScene'
import ScoreCard from '../components/ScoreCard'
import { useHouseState } from '../hooks/useHouseState'

function WeatherChip({
  temp,
  condition,
  location,
}: {
  temp: number
  condition: string
  location: string
}) {
  return (
    <div className="flex items-center gap-2 rounded-full border border-line bg-white/80 px-4 py-1.5 text-xs text-muted shadow-sm backdrop-blur-xl">
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
    <main className="relative min-h-svh bg-mist">
      {/* 3D house fills the viewport; dashboard panels float on top */}
      <div className="h-[55svh] lg:absolute lg:inset-0 lg:h-full">
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

      <div className="relative z-10 flex flex-col gap-4 p-4 sm:p-6 lg:pointer-events-none lg:h-svh">
        <header className="flex items-center justify-between gap-3">
          <img
            src="/vilpe-logo.png"
            alt="VILPE"
            className="pointer-events-auto h-6 w-auto"
          />
          <div className="pointer-events-auto flex items-center gap-2">
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
          <div className="pointer-events-auto rounded-2xl border border-alert/30 bg-alert/5 p-4 text-sm text-alert">
            Could not load house state.
          </div>
        )}

        {/* floating panels */}
        <div className="flex flex-1 flex-col justify-between gap-4 lg:flex-row lg:items-stretch">
          <div className="pointer-events-auto lg:self-center">
            {state && <ScoreCard state={state} />}
          </div>
          <div className="pointer-events-auto w-full lg:w-80 lg:self-end">
            {state && <AttentionFeed items={state.attention} />}
          </div>
        </div>

        <footer className="flex items-center justify-between gap-3">
          <span className="pointer-events-auto hidden text-xs text-muted/80 lg:block">
            drag to rotate · click a dot for details
          </span>
          <div className="pointer-events-auto flex items-center gap-2">
            <span className="hidden text-xs text-muted/70 sm:block">
              updated{' '}
              {state ? new Date(state.updated_at).toLocaleString('en-GB') : '—'}
            </span>
            {state?.simulating ? (
              <button
                onClick={() => demo('reset')}
                disabled={busy}
                className="rounded-full border border-line bg-white/80 px-4 py-1.5 text-xs font-medium text-navy shadow-sm backdrop-blur-xl transition-colors hover:border-navy/30 disabled:opacity-50"
              >
                Reset demo
              </button>
            ) : (
              <button
                onClick={() => demo('leak')}
                disabled={busy}
                className="rounded-full border border-vilpe-orange/40 bg-white/80 px-4 py-1.5 text-xs font-medium text-vilpe-orange shadow-sm backdrop-blur-xl transition-colors hover:bg-vilpe-orange/10 disabled:opacity-50"
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
