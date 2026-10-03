import type {
  HouseSensor,
  ScoreFactor,
  SensorKind,
  SensorLatest,
  Zone,
} from './api/types'

export const KIND_LABEL: Record<SensorKind, string> = {
  leak_sensor: 'Roof moisture sensor',
  fan: 'Ventilation fan',
  climate_sensor: 'Humidity sensor',
}

export const ZONE_LABEL: Record<Zone, string> = {
  roof_south: 'Roof',
  roof_north: 'Roof',
  ridge: 'Roof',
  crawl_space: 'Crawl space',
}

export const AREA_WORD = {
  ok: 'Good',
  watch: 'Watch',
  alert: 'Check',
} as const

// The few readings worth showing at a glance, in homeowner order.
export function keyValues(l: SensorLatest): string[] {
  const out: string[] = []
  if (l.rh_pct != null) out.push(`${Math.round(l.rh_pct)} %`)
  if (l.temp_c != null) out.push(`${l.temp_c.toFixed(1)} °C`)
  if (l.fan_rpm != null) out.push(`${Math.round(l.fan_rpm)} rpm`)
  return out
}

// What a 3D callout shows: fans read as their state + speed (details live on
// the sensor page), sensors as humidity + temperature.
export function calloutValues(s: HouseSensor): string[] {
  if (s.kind === 'fan') {
    const rpm = s.latest.fan_rpm != null ? `${Math.round(s.latest.fan_rpm)} rpm` : null
    return [s.state_label, rpm].filter((v): v is string => !!v)
  }
  return keyValues(s.latest)
}

export function timeAgo(isoDate: string): string {
  const mins = Math.max(0, Math.round((Date.now() - Date.parse(isoDate)) / 60000))
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const h = Math.round(mins / 60)
  if (h < 24) return `${h} h ago`
  return `${Math.round(h / 24)} d ago`
}

// Plain-language line for one score factor, keeping the real number the
// analysis detected (mould index peak, hours, %). Shared by the score
// card popup and the /score page.
export function factorText(f: ScoreFactor): string {
  const loc = f.location ? ` in ${f.location}` : ''
  const d = f.detail
  switch (f.code) {
    case 'MOLD_INDEX_ELEVATED':
      return `Mould index reached ${typeof d.peak === 'number' ? d.peak.toFixed(1) : 'a high level'}${loc}`
    case 'RH_SUSTAINED_HIGH':
      return `Humidity stayed high${loc}${typeof d.duration_hours === 'number' ? ` for about ${Math.round(d.duration_hours)} h` : ''}`
    case 'AH_INVERSION':
      return `The structure is holding more moisture than the outdoor air${loc}`
    case 'LEAK_SIMULATED':
    case 'SENSOR_LEAK_SIMULATED':
      return `Sudden moisture rise${loc} — looks like a leak`
    case 'FAN_STOPPED':
      return `A ventilation fan stopped${loc}`
    case 'FAN_NO_DATA':
      return `A ventilation fan isn't reporting${loc}`
    case 'SENSOR_OFFLINE':
      return `A sensor went offline${loc}`
    case 'GRID_HUMID':
      return typeof d.pct_sensors_high === 'number'
        ? `${Math.round(d.pct_sensors_high)}% of structure sensors are very humid`
        : `Structure sensors are very humid`
    default:
      return f.code.replace(/_/g, ' ').toLowerCase() + loc
  }
}

export function formatDateTime(isoDate: string): string {
  return new Date(isoDate).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}
