import { useNavigate } from 'react-router-dom'
import type { HouseState } from '../api'
import HouseScene from '../components/HouseScene'
import Spinner from '../components/Spinner'
import { useHouse } from '../hooks/useHouse'

// Room kept free at the top of the canvas for the overlay below.
const OVERLAY_H = 150

function Overview({ state }: { state: HouseState }) {
  const { home, weather } = state
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex flex-wrap items-start justify-between gap-4 bg-gradient-to-b from-mist via-mist/80 to-transparent px-8 pt-7 pb-10">
      <div className="flex max-w-xl flex-col gap-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold tracking-[0.18em] text-muted uppercase">
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-current" aria-hidden>
            <path d="M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7Zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5Z" />
          </svg>
          {home.address}, {home.city}
        </div>
        <h1 className="font-display text-3xl leading-tight font-bold text-navy">
          {state.headline}
        </h1>
        <p className="text-base leading-relaxed text-navy/75">
          {state.summary}{' '}
          {state.narrative_source === 'llm' && (
            <span className="text-[9px] font-medium tracking-[0.14em] text-navy/30 uppercase">
              AI insight
            </span>
          )}
        </p>
      </div>

      <div className="flex flex-col items-end gap-1 rounded-2xl border border-white/70 bg-white/80 px-5 py-3 shadow-lg shadow-navy/5 backdrop-blur-md">
        <span className="text-[10px] font-semibold tracking-[0.18em] text-muted uppercase">
          Outdoors in {weather.location}
        </span>
        <span className="font-display text-3xl font-bold text-navy">
          {weather.temp_c.toFixed(1)} °C
        </span>
        <span className="text-xs text-navy/70">
          {weather.condition} · humidity {Math.round(weather.humidity_pct)} % · wind{' '}
          {weather.wind_ms.toFixed(0)} m/s
        </span>
      </div>
    </div>
  )
}

export default function HomePage() {
  const { state } = useHouse()
  const navigate = useNavigate()

  return (
    <div className="relative h-full min-h-[55svh] lg:min-h-0">
      {state ? (
        <>
          <HouseScene
            sensors={state.sensors}
            insetTop={OVERLAY_H}
            onSelect={(s) => navigate(`/sensors/${s.id}`)}
          />
          <Overview state={state} />
        </>
      ) : (
        <div className="flex h-full items-center justify-center">
          <Spinner label="Loading your house…" />
        </div>
      )}
    </div>
  )
}
