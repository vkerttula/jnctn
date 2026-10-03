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
    <div className="flex items-center justify-center gap-2 rounded-full border border-white/15 bg-white/10 px-4 py-1.5 text-xs text-white/70">
      <span className="font-semibold text-white">{temp.toFixed(0)}°C</span>
      <span>{condition}</span>
      <span className="text-white/50">· {location}</span>
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
    <main className="flex min-h-svh flex-col bg-mist lg:h-svh lg:flex-row">
      {/* unified navy sidebar — VILPE logo on top, house status below */}
      <aside className="flex w-full flex-col gap-5 bg-navy px-6 py-6 text-white lg:h-svh lg:w-[340px] lg:shrink-0 lg:overflow-y-auto">
        <img src="/vilpe-logo.png" alt="VILPE" className="h-6 w-auto self-start" />

        {error && (
          <div className="rounded-2xl border border-alert/40 bg-alert/10 p-4 text-sm text-white/90">
            Could not load house state.
          </div>
        )}

        {state && <ScoreCard state={state} />}
        {state && (
          <WeatherChip
            temp={state.weather.temp_c}
            condition={state.weather.condition}
            location={state.weather.location}
          />
        )}
        {state && <AttentionFeed items={state.attention} />}

        <div className="mt-auto flex flex-col gap-3 pt-4">
          {state?.simulating && (
            <span className="self-start rounded-full bg-watch/20 px-3 py-1.5 text-xs font-semibold text-watch">
              demo running
            </span>
          )}
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
                className="rounded-full border border-vilpe-orange/60 bg-vilpe-orange/15 px-4 py-1.5 text-xs font-medium text-vilpe-orange transition-colors hover:bg-vilpe-orange/25 disabled:opacity-50"
              >
                Simulate leak
              </button>
            )}
            <span className="text-xs text-white/40">
              updated{' '}
              {state ? new Date(state.updated_at).toLocaleString('en-GB') : '—'}
            </span>
          </div>
          <div className="flex items-center gap-3">
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
          </div>
        </div>
      </aside>

      {/* 3D house fills the rest of the viewport */}
      <div className="relative h-[55svh] lg:h-full lg:flex-1">
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
        <div className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 text-xs text-muted/80">
          drag to rotate · click a dot for details
        </div>
      </div>
    </main>
  )
}
