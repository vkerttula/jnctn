// API contract types — mirror of docs/specs/2026-10-03-frontend-design.md.
// The backend is designed from these once the mock has settled the shape.

export type SensorStatus = 'ok' | 'watch' | 'alert'
export type Severity = 'watch' | 'alert'
export type SensorKind =
  | 'leak_sensor'
  | 'fan'
  | 'climate_sensor'
  | 'ventilation_unit'
export type Zone = 'roof_south' | 'roof_north' | 'ridge' | 'crawl_space' | 'indoor'
export type SeriesRange = '24h' | '7d' | '30d'
export type ScoreWord = 'Good' | 'Fair' | 'Attention'
export type ScoreTrend = 'improving' | 'stable' | 'declining'

export interface Weather {
  temp_c: number
  condition: string
  location: string
}

export interface AttentionItem {
  sensor_id: string
  severity: Severity
  message: string
  since: string
}

export interface HouseSensor {
  id: string
  name: string
  kind: SensorKind
  zone: Zone
  status: SensorStatus
  primary: boolean
  latest: SensorLatest
}

export interface HouseState {
  score: number
  score_word: ScoreWord
  score_trend: ScoreTrend
  summary: string
  weather: Weather
  attention: AttentionItem[]
  sensors: HouseSensor[]
  simulating: boolean
  updated_at: string
}

export interface SensorLatest {
  temp_c: number | null
  rh_pct: number | null
  mold_index: number | null
  fan_rpm: number | null
}

export interface SensorDetail {
  id: string
  name: string
  kind: SensorKind
  zone: Zone
  status: SensorStatus
  status_text: string
  latest: SensorLatest
  updated_at: string
}

export interface SeriesPoint {
  t: string
  temp_c: number | null
  rh_pct: number | null
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
