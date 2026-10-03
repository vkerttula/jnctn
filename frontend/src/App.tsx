import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom'
import { getUser } from './auth'
import AppShell from './components/AppShell'
import DataExplorer from './DataExplorer'
import HomePage from './pages/HomePage'
import LoginPage from './pages/LoginPage'
import SensorDetailPage from './pages/SensorDetailPage'
import ReportPage from './pages/ReportPage'
import ScorePage from './pages/ScorePage'
import SensorsPage from './pages/SensorsPage'
import StatusPage from './pages/StatusPage'

// Redirects to /login until a preset user has signed in. /status and /data
// stay open — they're dev tools that work without a session.
function RequireAuth() {
  return getUser() ? <Outlet /> : <Navigate to="/login" replace />
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<RequireAuth />}>
          <Route element={<AppShell />}>
            <Route path="/" element={<HomePage />} />
            <Route path="/sensors" element={<SensorsPage />} />
            <Route path="/sensors/:id" element={<SensorDetailPage />} />
            <Route path="/report" element={<ReportPage />} />
            <Route path="/score" element={<ScorePage />} />
          </Route>
        </Route>
        <Route path="/status" element={<StatusPage />} />
        <Route path="/data" element={<DataExplorer />} />
      </Routes>
    </BrowserRouter>
  )
}
