import { BrowserRouter, Route, Routes } from 'react-router-dom'
import DataExplorer from './DataExplorer'
import HomePage from './pages/HomePage'
import SensorDetailPage from './pages/SensorDetailPage'
import StatusPage from './pages/StatusPage'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/sensors/:id" element={<SensorDetailPage />} />
        <Route path="/status" element={<StatusPage />} />
        <Route path="/data" element={<DataExplorer />} />
      </Routes>
    </BrowserRouter>
  )
}
