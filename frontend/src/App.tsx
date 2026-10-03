import { BrowserRouter, Route, Routes } from 'react-router-dom'
import DataExplorer from './DataExplorer'
import HomePage from './pages/HomePage'
import SensorDetailPage from './pages/SensorDetailPage'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/sensors/:id" element={<SensorDetailPage />} />
        <Route path="/data" element={<DataExplorer />} />
      </Routes>
    </BrowserRouter>
  )
}
