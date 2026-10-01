import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Bind 0.0.0.0 so the dev server is reachable via the devcontainer's
    // published ports on the host.
    host: true,
    proxy: {
      // FastAPI dev server — see backend/
      '/api': 'http://localhost:8000',
    },
  },
})
