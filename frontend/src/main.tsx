import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import DataExplorer from './DataExplorer.tsx'

const page = window.location.pathname.startsWith('/data') ? (
  <DataExplorer />
) : (
  <App />
)

createRoot(document.getElementById('root')!).render(
  <StrictMode>{page}</StrictMode>,
)
