import { useNavigate } from 'react-router-dom'
import type { HouseState } from '../api'
import HouseScene from '../components/HouseScene'
import Spinner from '../components/Spinner'
import WeatherIcon from '../components/WeatherIcon'
import { useHouse } from '../hooks/useHouse'

// Room kept free at the top of the canvas for the overlay below.
const OVERLAY_H = 150

const DROPLET = 'M12 2.7s5.5 6 5.5 10a5.5 5.5 0 0 1-11 0c0-4 5.5-10 5.5-10Z'
const UMBRELLA = 'M22 12a10 10 0 0 0-20 0h20ZM12 12v7a2 2 0 0 0 4 0M12 2v1'

function MiniIcon({ d }: { d: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-3 w-3 text-sense"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={d} />
    </svg>
  )
}

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

      <div
        className="flex items-center gap-2 rounded-full border border-white/70 bg-white/80 px-2.5 py-1 shadow-sm backdrop-blur-md"
        title={`${weather.condition} · ${weather.location} · wind ${weather.wind_ms.toFixed(0)} m/s`}
      >
        <WeatherIcon condition={weather.condition} className="h-4 w-4 shrink-0" />
        <span className="text-xs font-semibold text-navy">
          {Math.round(weather.temp_c)} °C
        </span>
        {weather.humidity_pct != null && (
          <span className="flex items-center gap-0.5 text-[11px] text-navy/60">
            <MiniIcon d={DROPLET} />
            {Math.round(weather.humidity_pct)} %
          </span>
        )}
        {weather.rain_chance_pct != null && (
          <span className="flex items-center gap-0.5 text-[11px] text-navy/60">
            <MiniIcon d={UMBRELLA} />
            {Math.round(weather.rain_chance_pct)} %
          </span>
        )}
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
