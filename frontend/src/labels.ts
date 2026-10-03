import type { SensorKind, SensorLatest, Zone } from './api/types'

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

// The few readings worth showing at a glance, in homeowner order.
export function keyValues(l: SensorLatest): string[] {
  const out: string[] = []
  if (l.rh_pct != null) out.push(`${Math.round(l.rh_pct)} %`)
  if (l.temp_c != null) out.push(`${l.temp_c.toFixed(1)} °C`)
  if (l.fan_rpm != null) out.push(`${Math.round(l.fan_rpm)} rpm`)
  return out
}

export function timeAgo(isoDate: string): string {
  const mins = Math.max(0, Math.round((Date.now() - Date.parse(isoDate)) / 60000))
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const h = Math.round(mins / 60)
  if (h < 24) return `${h} h ago`
  return `${Math.round(h / 24)} d ago`
}

export function formatDateTime(isoDate: string): string {
  return new Date(isoDate).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}
