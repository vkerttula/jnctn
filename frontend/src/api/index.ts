import { live } from './client'
import { mock } from './mock'
import type { Api } from './types'

// Default mock — the backend doesn't exist yet; flip with VITE_API_MODE=live.
export const api: Api =
  import.meta.env.VITE_API_MODE === 'live' ? live : mock

export * from './types'
