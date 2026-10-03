// Mock auth — two preset accounts so the demo can switch between the mock
// fixture data and the live Sense backend at runtime. The chosen user id is
// persisted in localStorage; api/index.ts reads it at module load to pick
// the data mode, so sign-in/out navigates with a full page reload.

export type DataMode = 'mock' | 'live'

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
]

const KEY = 'vilpe.user'

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
