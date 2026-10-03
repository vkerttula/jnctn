import type { SensorStatus, Severity } from './api/types'

// Status hues, muted from the Sense app's own hexes — keep in sync with
// --color-ok/watch/alert in index.css.
export const STATUS_COLOR: Record<SensorStatus, string> = {
  ok: '#43a047',
  watch: '#d9a320',
  alert: '#c0392b',
}

export const SEVERITY_COLOR: Record<Severity, string> = {
  watch: STATUS_COLOR.watch,
  alert: STATUS_COLOR.alert,
}
