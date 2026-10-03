// API contract types — mirror of docs/specs/2026-10-03-frontend-design.md.
// The backend is designed from these once the mock has settled the shape.

export type SensorStatus = 'ok' | 'watch' | 'alert'
export type Severity = 'watch' | 'alert'
export type SensorKind = 'leak_sensor' | 'fan' | 'climate_sensor'
export type Zone = 'roof_south' | 'roof_north' | 'ridge' | 'crawl_space'
export type SeriesRange = '24h' | '7d' | '30d' | '1y'
export type ScoreWord = 'Good' | 'Fair' | 'Attention'
export type ScoreTrend = 'improving' | 'stable' | 'declining'
// who wrote headline/summary/recommendations: gemini, the deterministic
// template fallback, or the hardcoded leak-demo copy
export type NarrativeSource = 'llm' | 'fallback' | 'no-data' | 'demo'

export interface Home {
  address: string
  city: string
}

export interface Weather {
  temp_c: number
  condition: string
  humidity_pct: number
  wind_ms: number
  // today's max precipitation probability, % — null when the source
  // can't provide a forecast (sensor fallback)
  rain_chance_pct: number | null
  location: string
}

export type HelpKind = 'inspection' | 'expert'

export interface AttentionItem {
  sensor_id: string
  severity: Severity
  message: string
  since: string
  // one-tap next steps offered with this item (inspection marketplace,
  // remote expert review)
  actions: HelpKind[]
}


export interface HelpRequest {
  kind: HelpKind
  sensor_id: string | null
  requested_at: string
  // short line shown while the request is open, e.g. "Inspector will call
  // within 1 working day"
  status_text: string
}

export interface Area {
  id: 'roof' | 'crawl_space'
  name: string
  status: SensorStatus
}

// One detected condition pulling the score down — straight from the
// analysis layer's findings (mould index peaks, sustained humidity, …).
export interface ScoreFactor {
  code: string
  severity: 'info' | 'watch' | 'attention'
  location: string | null
  detail: Record<string, number | string | boolean | null>
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
  // one-word operating state for devices that act (fans): "Running",
  // "Drying"; null for passive sensors
  state_label: string | null
}

export interface HouseSensor extends SensorBase {
  primary: boolean
}

export interface HouseState {
  home: Home
  score: number
  score_word: ScoreWord
  score_trend: ScoreTrend
  // structure-level verdicts that make up the score
  areas: Area[]
  // what the score is actually built from — empty when nothing is
  // pulling it down
  score_factors: ScoreFactor[]
  headline: string
  summary: string
  // narrative next-steps for the homeowner (LLM or fallback wording)
  recommendations: string[]
  narrative_source: NarrativeSource
  weather: Weather
  attention: AttentionItem[]
  sensors: HouseSensor[]
  open_requests: HelpRequest[]
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
  // the expected humidity range for this device and season, drawn as a
  // calm band behind the line; null when there is no humidity reading.
  // `bands` is present when the window spans several calendar months —
  // a stepped per-month band instead of one flat range.
  normal: {
    label: string
    rh_pct: [number, number]
    bands?: { from: string; to: string; rh_pct: [number, number] }[]
  } | null
  points: SeriesPoint[]
  // one-sentence read of the chart over this range (LLM or fallback
  // wording); null when the sensor has no readings in range
  summary: string | null
  summary_source: NarrativeSource
}

export interface ReportStructure {
  name: string
  avg_rh_pct: number
  peak_mold_index: number
  peak_month: string
  risk_periods: number
  coverage_pct: number
  status: string
}

export interface Report {
  id: string
  issued: string
  period: { from: string; to: string }
  property: string
  address: string
  building: string
  sensors: string
  verified: string
  headline: string
  summary: string
  recommendations: string[]
  mold_threshold: number
  months: { month: string; roof: number; crawl_space: number }[]
  structures: ReportStructure[]
  measurements: number
  interval: string
  data_gaps: string
  weather_context: string
  last_sensor_check: string
}

export interface Api {
  getHouseState(): Promise<HouseState>
  getSensor(id: string): Promise<SensorDetail>
  getSeries(id: string, range: SeriesRange): Promise<SensorSeries>
  simulateLeak(sensorId?: string): Promise<void>
  resetDemo(): Promise<void>
  // returns a calm confirmation sentence to show the homeowner; sensorId is
  // set when the request comes from an attention item
  requestHelp(kind: HelpKind, sensorId?: string): Promise<{ message: string }>
  getReport(): Promise<Report>
}
