import { useCallback, useEffect, useState } from 'react'
import { api, type HouseState } from '../api'

// Sensor data changes ~2x/day, so 60 s polling is plenty; while a leak
// simulation runs the UI polls faster so the demo moment stays alive.
const IDLE_POLL_MS = 60_000
const SIM_POLL_MS = 15_000

export function useHouseState() {
  const [state, setState] = useState<HouseState | null>(null)
  const [error, setError] = useState(false)
  const pollMs = state?.simulating ? SIM_POLL_MS : IDLE_POLL_MS

  const refresh = useCallback(() => {
    api
      .getHouseState()
      .then((s) => {
        setState(s)
        setError(false)
      })
      .catch(() => setError(true))
  }, [])

  useEffect(() => {
    refresh()
    const t = setInterval(refresh, pollMs)
    return () => clearInterval(t)
  }, [refresh, pollMs])

  return { state, error, refresh }
}
