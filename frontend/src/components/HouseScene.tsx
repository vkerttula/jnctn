import { useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, type ThreeEvent } from '@react-three/fiber'
import { ContactShadows, Html, OrbitControls } from '@react-three/drei'
import type { Mesh } from 'three'
import type { HouseSensor, Zone } from '../api'
import { STATUS_COLOR } from '../theme'

// Hand-placed anchors in model space, one slot per sensor in the zone.
const ZONE_ANCHORS: Record<Zone, [number, number, number][]> = {
  flat_roof: [
    [-2.3, 2.5, -1.3],
    [-0.9, 2.5, 1.0],
    [0.5, 2.5, -0.9],
    [1.9, 2.5, 1.2],
    [-1.7, 2.5, 0.2],
    [1.1, 2.5, -0.1],
    [-0.2, 2.5, 1.55],
    [2.4, 2.5, -1.4],
  ],
  green_roof: [
    [3.9, 1.95, -0.8],
    [4.4, 1.95, 0.7],
    [4.1, 1.95, 0.0],
    [4.75, 1.95, -0.35],
  ],
  ridge: [
    [-2.5, 2.55, -2.1],
    [0.8, 2.55, -2.1],
  ],
  crawl_space: [[-3.25, 0.3, 0.9]],
  wall: [[1.2, 1.3, 2.15]],
}

function Hotspot({
  sensor,
  position,
  onSelect,
}: {
  sensor: HouseSensor
  position: [number, number, number]
  onSelect: (s: HouseSensor) => void
}) {
  const mesh = useRef<Mesh>(null)
  const [hovered, setHovered] = useState(false)
  const color = STATUS_COLOR[sensor.status]

  useFrame(({ clock }) => {
    if (!mesh.current) return
    const speed = sensor.status === 'alert' ? 6 : sensor.status === 'watch' ? 3 : 0
    const s = speed
      ? 1 + 0.28 * Math.sin(clock.elapsedTime * speed)
      : hovered
        ? 1.25
        : 1
    mesh.current.scale.setScalar(s)
  })

  return (
    <group position={position}>
      {/* invisible larger hit area */}
      <mesh
        onClick={(e: ThreeEvent<MouseEvent>) => {
          e.stopPropagation()
          onSelect(sensor)
        }}
        onPointerOver={(e: ThreeEvent<PointerEvent>) => {
          e.stopPropagation()
          setHovered(true)
          document.body.style.cursor = 'pointer'
        }}
        onPointerOut={() => {
          setHovered(false)
          document.body.style.cursor = 'auto'
        }}
      >
        <sphereGeometry args={[0.28, 12, 12]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      <mesh ref={mesh}>
        <sphereGeometry args={[0.11, 24, 24]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={sensor.status === 'ok' ? 0.35 : 0.9}
        />
      </mesh>
      {hovered && (
        <Html position={[0, 0.32, 0]} center distanceFactor={14}>
          <div className="pointer-events-none rounded-lg bg-navy px-2.5 py-1 font-display text-[11px] font-semibold whitespace-nowrap text-white shadow-lg">
            {sensor.name}
          </div>
        </Html>
      )}
    </group>
  )
}

// Decorative roof fans — the hall really has VILPE MCU-2 units up there.
function RoofFan({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <mesh position={[0, 0.22, 0]}>
        <cylinderGeometry args={[0.14, 0.14, 0.44, 20]} />
        <meshStandardMaterial color="#dfe4e8" />
      </mesh>
      <mesh position={[0, 0.47, 0]}>
        <sphereGeometry args={[0.16, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color="#b9c2c9" />
      </mesh>
    </group>
  )
}

function HouseModel() {
  return (
    <group>
      {/* crawl-space plinth */}
      <mesh position={[0, 0.25, 0]}>
        <boxGeometry args={[6.4, 0.5, 4.4]} />
        <meshStandardMaterial color="#cfd6dc" />
      </mesh>
      {/* main hall */}
      <mesh position={[0, 1.3, 0]}>
        <boxGeometry args={[6, 1.6, 4]} />
        <meshStandardMaterial color="#fbfbf9" />
      </mesh>
      {/* flat roof slab */}
      <mesh position={[0, 2.2, 0]}>
        <boxGeometry args={[6.2, 0.14, 4.2]} />
        <meshStandardMaterial color="#3a4753" />
      </mesh>
      {/* parapet rim */}
      <mesh position={[0, 2.34, -2.06]}>
        <boxGeometry args={[6.2, 0.16, 0.1]} />
        <meshStandardMaterial color="#2c3742" />
      </mesh>
      <mesh position={[0, 2.34, 2.06]}>
        <boxGeometry args={[6.2, 0.16, 0.1]} />
        <meshStandardMaterial color="#2c3742" />
      </mesh>
      <mesh position={[-3.06, 2.34, 0]}>
        <boxGeometry args={[0.1, 0.16, 4.2]} />
        <meshStandardMaterial color="#2c3742" />
      </mesh>
      <mesh position={[3.06, 2.34, 0]}>
        <boxGeometry args={[0.1, 0.16, 4.2]} />
        <meshStandardMaterial color="#2c3742" />
      </mesh>
      {/* green-roof wing */}
      <mesh position={[4.3, 1.05, 0]}>
        <boxGeometry args={[2.4, 1.1, 3]} />
        <meshStandardMaterial color="#fbfbf9" />
      </mesh>
      <mesh position={[4.3, 1.66, 0]}>
        <boxGeometry args={[2.5, 0.12, 3.1]} />
        <meshStandardMaterial color="#5d8f4e" />
      </mesh>
      {/* decorative fans on the flat roof */}
      <RoofFan position={[-2.3, 2.27, -0.4]} />
      <RoofFan position={[0.6, 2.27, 0.6]} />
      <RoofFan position={[2.2, 2.27, -0.5]} />
      <RoofFan position={[4.3, 1.72, 0.9]} />
    </group>
  )
}

export default function HouseScene({
  sensors,
  onSelect,
}: {
  sensors: HouseSensor[]
  onSelect: (s: HouseSensor) => void
}) {
  const anchors = useMemo(() => {
    const used: Partial<Record<Zone, number>> = {}
    const map: Record<string, [number, number, number]> = {}
    for (const s of sensors.filter((x) => x.primary)) {
      const slots = ZONE_ANCHORS[s.zone]
      if (!slots?.length) continue
      const i = used[s.zone] ?? 0
      used[s.zone] = i + 1
      map[s.id] = slots[i % slots.length]
    }
    return map
  }, [sensors])

  return (
    <Canvas camera={{ position: [8, 5.2, 9.5], fov: 38 }}>
      <ambientLight intensity={0.8} />
      <directionalLight position={[6, 9, 4]} intensity={1.3} />
      <directionalLight position={[-4, 5, -6]} intensity={0.3} />
      <HouseModel />
      {sensors
        .filter((s) => s.primary && anchors[s.id])
        .map((s) => (
          <Hotspot
            key={s.id}
            sensor={s}
            position={anchors[s.id]}
            onSelect={onSelect}
          />
        ))}
      {/* ground */}
      <mesh rotation-x={-Math.PI / 2} position={[0, -0.02, 0]}>
        <circleGeometry args={[12, 64]} />
        <meshStandardMaterial color="#e9edf0" />
      </mesh>
      <ContactShadows
        position={[0, 0, 0]}
        opacity={0.35}
        scale={16}
        blur={2.4}
        far={4}
      />
      <OrbitControls
        autoRotate
        autoRotateSpeed={0.6}
        enableDamping
        dampingFactor={0.08}
        enablePan={false}
        minPolarAngle={Math.PI * 0.16}
        maxPolarAngle={Math.PI * 0.46}
        minDistance={5}
        maxDistance={18}
      />
    </Canvas>
  )
}
