// Live API implementation — unused until the backend lands (VITE_API_MODE=live).
// The Vite dev proxy forwards /api to FastAPI on :8000.
import type { Api } from './types'

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`/api${path}`, init)
  if (!r.ok) throw new Error(`API ${r.status} on ${path}`)
  return r.json() as Promise<T>
}

function post(path: string, body?: unknown): Promise<void> {
  return apiFetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then(() => undefined)
}

export const live: Api = {
  getHouseState: () => apiFetch('/house'),
  getSensor: (id) => apiFetch(`/sensors/${id}`),
  getSeries: (id, range) => apiFetch(`/sensors/${id}/series?range=${range}`),
  simulateLeak: (sensorId) => post('/simulate/leak', { sensor_id: sensorId }),
  resetDemo: () => post('/simulate/reset'),
}
