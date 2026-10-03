import { live } from './client'
import { mock } from './mock'
import type { Api } from './types'

// Default mock (fixture JSON, no backend needed); VITE_API_MODE=live in
// frontend/.env switches to the real FastAPI contract.
export const api: Api =
  import.meta.env.VITE_API_MODE === 'live' ? live : mock

export * from './types'
