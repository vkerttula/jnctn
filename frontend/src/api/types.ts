// API contract types — mirror of docs/specs/2026-10-03-frontend-design.md.
// The backend is designed from these once the mock has settled the shape.

export type SensorStatus = 'ok' | 'watch' | 'alert'
export type Severity = 'watch' | 'alert'
export type SensorKind = 'leak_sensor' | 'fan' | 'climate_sensor'
export type Zone = 'roof_south' | 'roof_north' | 'ridge' | 'crawl_space'
export type SeriesRange = '24h' | '7d' | '30d'
export type ScoreWord = 'Good' | 'Fair' | 'Attention'
export type ScoreTrend = 'improving' | 'stable' | 'declining'

export interface Home {
  address: string
  city: string
}

export interface Weather {
  temp_c: number
  condition: string
  humidity_pct: number
  wind_ms: number
  location: string
}

export interface AttentionItem {
  sensor_id: string
  severity: Severity
  message: string
  since: string
}

export interface SensorLatest {
  temp_c: number | null
  rh_pct: number | null
  mold_index: number | null
  fan_rpm: number | null
}

interface SensorBase {
  id: string
  name: string
  kind: SensorKind
  zone: Zone
  status: SensorStatus
  latest: SensorLatest
  // device id this one is installed together with (e.g. crawl space
  // sensor + the fan that dries it)
  works_with: string | null
  last_reading_at: string
}

export interface HouseSensor extends SensorBase {
  primary: boolean
}

export interface HouseState {
  home: Home
  score: number
  score_word: ScoreWord
  score_trend: ScoreTrend
  headline: string
  summary: string
  weather: Weather
  attention: AttentionItem[]
  sensors: HouseSensor[]
  simulating: boolean
  updated_at: string
}

export interface SensorDetail extends SensorBase {
  status_text: string
  updated_at: string
}

export interface SeriesPoint {
  t: string
  temp_c: number | null
  rh_pct: number | null
  fan_rpm: number | null
  mold_index: number | null
}

export interface SensorSeries {
  id: string
  range: SeriesRange
  points: SeriesPoint[]
}

export interface Api {
  getHouseState(): Promise<HouseState>
  getSensor(id: string): Promise<SensorDetail>
  getSeries(id: string, range: SeriesRange): Promise<SensorSeries>
  simulateLeak(sensorId?: string): Promise<void>
  resetDemo(): Promise<void>
}
