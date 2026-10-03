import { useNavigate } from 'react-router-dom'
import HouseScene from '../components/HouseScene'
import { useHouse } from '../hooks/useHouse'

export default function HomePage() {
  const { state } = useHouse()
  const navigate = useNavigate()

  return (
    <div className="h-full min-h-[55svh] lg:min-h-0">
      {state ? (
        <HouseScene
          sensors={state.sensors}
          onSelect={(s) => navigate(`/sensors/${s.id}`)}
        />
      ) : (
        <div className="flex h-full items-center justify-center text-sm text-muted">
          Loading your house…
        </div>
      )}
    </div>
  )
}
