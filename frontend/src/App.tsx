import { BrowserRouter, Route, Routes } from 'react-router-dom'
import AppShell from './components/AppShell'
import DataExplorer from './DataExplorer'
import HomePage from './pages/HomePage'
import SensorDetailPage from './pages/SensorDetailPage'
import ReportPage from './pages/ReportPage'
import SensorsPage from './pages/SensorsPage'
import StatusPage from './pages/StatusPage'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/sensors" element={<SensorsPage />} />
          <Route path="/sensors/:id" element={<SensorDetailPage />} />
          <Route path="/report" element={<ReportPage />} />
        </Route>
        <Route path="/status" element={<StatusPage />} />
        <Route path="/data" element={<DataExplorer />} />
      </Routes>
    </BrowserRouter>
  )
}
