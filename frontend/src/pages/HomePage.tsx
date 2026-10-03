import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import HouseScene from '../components/HouseScene'
import { useHouse } from '../hooks/useHouse'

export default function HomePage() {
  const { state } = useHouse()
  const navigate = useNavigate()
  const [hovered, setHovered] = useState(false)

  return (
    <div
      className="h-full min-h-[55svh] lg:min-h-0"
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
    >
      {state ? (
        <HouseScene
          sensors={state.sensors}
          autoRotate={!hovered}
          onSelect={(s) => navigate(`/sensors/${s.id}`)}
        />
      ) : (
        <div className="flex h-full items-center justify-center text-sm text-muted">
          Loading your house…
        </div>
      )}
      <div className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 text-xs text-muted/80">
        drag to rotate · click a dot for details
      </div>
    </div>
  )
}
