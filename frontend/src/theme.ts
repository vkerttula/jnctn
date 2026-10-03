import type { SensorStatus, Severity } from './api/types'

// VILPE Sense status colors — same hexes the real Sense app uses.
export const STATUS_COLOR: Record<SensorStatus, string> = {
  ok: '#50c92f',
  watch: '#f5be23',
  alert: '#df0a15',
}

export const SEVERITY_COLOR: Record<Severity, string> = {
  watch: STATUS_COLOR.watch,
  alert: STATUS_COLOR.alert,
}
