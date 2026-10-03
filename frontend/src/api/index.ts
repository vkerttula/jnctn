import { getUser } from '../auth'
import { live } from './client'
import { mock } from './mock'
import type { Api } from './types'

// A signed-in preset user's dataMode wins; otherwise VITE_API_MODE in
// frontend/.env decides (default mock = fixture JSON, no backend needed).
// Changing user requires a reload — auth.ts always navigates with one.
export const apiMode =
  getUser()?.dataMode ??
  (import.meta.env.VITE_API_MODE === 'live' ? 'live' : 'mock')
export const api: Api = apiMode === 'live' ? live : mock

export * from './types'
