import { useOutletContext } from 'react-router-dom'
import type { HouseState } from '../api'

// Pages rendered inside AppShell get the polled house state via outlet context.
export function useHouse() {
  return useOutletContext<{ state: HouseState | null; refresh: () => void }>()
}
