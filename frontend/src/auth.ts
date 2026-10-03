// Mock auth — two preset accounts so the demo can switch between the mock
// fixture data and the live Sense backend at runtime. The chosen user id is
// persisted in localStorage; api/index.ts reads it at module load to pick
// the data mode, so sign-in/out navigates with a full page reload.

export type DataMode = 'mock' | 'live' | 'dc'

export interface User {
  id: string
  name: string
  email: string
  home: string
  dataMode: DataMode
  initials: string
}

export const USERS: User[] = [
  {
    id: 'demo',
    name: 'Demo Family',
    email: 'demo@vilpe.fi',
    home: 'Mäntytie 8, Tampere',
    dataMode: 'mock',
    initials: 'DF',
  },
  {
    id: 'matti',
    name: 'Matti Virtanen',
    email: 'matti@vilpe.fi',
    home: 'Yliopistonranta 1, Vaasa',
    dataMode: 'live',
    initials: 'MV',
  },
  {
    id: 'facility',
    name: 'Facility Ops',
    email: 'facility@vilpe.fi',
    home: 'DC Helsinki 1, Espoo',
    dataMode: 'dc',
    initials: 'FO',
  },
]

const KEY = 'vilpe.user'

// Demo access gate — a shared key that unlocks the login page and is sent as
// the X-Demo-Key header on live API calls (backend middleware enforces it
// when DEMO_KEY is set; it must equal this value). Not a real secret — it
// ships in the bundle — but it keeps bots and casual traffic off a public
// demo deployment, which is what the gate is for.
export const ACCESS_CODE = 'sense-demo'
const ACCESS_KEY = 'vilpe.access'

export function hasAccess(): boolean {
  return localStorage.getItem(ACCESS_KEY) === ACCESS_CODE
}

export function unlock(code: string): boolean {
  if (code.trim() !== ACCESS_CODE) return false
  localStorage.setItem(ACCESS_KEY, ACCESS_CODE)
  return true
}

export function accessCode(): string | null {
  return localStorage.getItem(ACCESS_KEY)
}

export function getUser(): User | null {
  const id = localStorage.getItem(KEY)
  return USERS.find((u) => u.id === id) ?? null
}

export function findByEmail(email: string): User | undefined {
  return USERS.find(
    (u) => u.email.toLowerCase() === email.trim().toLowerCase(),
  )
}

export function signIn(userId: string): void {
  localStorage.setItem(KEY, userId)
  window.location.href = '/'
}

export function signOut(): void {
  localStorage.removeItem(KEY)
  window.location.href = '/login'
}
