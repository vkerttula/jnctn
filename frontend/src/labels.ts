import type { SensorKind, SensorLatest, Zone } from './api/types'

export const KIND_LABEL: Record<SensorKind, string> = {
  leak_sensor: 'Roof moisture sensor',
  fan: 'Roof fan',
  climate_sensor: 'Humidity sensor',
  ventilation_unit: 'Ventilation unit',
}

export const ZONE_LABEL: Record<Zone, string> = {
  roof_south: 'Roof',
  roof_north: 'Roof',
  ridge: 'Roof',
  crawl_space: 'Crawl space',
  indoor: 'Indoor air',
}

// The few readings worth showing at a glance, in homeowner order.
export function keyValues(l: SensorLatest): string[] {
  const out: string[] = []
  if (l.rh_pct != null) out.push(`${Math.round(l.rh_pct)} %`)
  if (l.temp_c != null) out.push(`${l.temp_c.toFixed(1)} °C`)
  if (l.fan_rpm != null) out.push(`${Math.round(l.fan_rpm)} rpm`)
  return out
}
