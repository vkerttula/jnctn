import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, type ThreeEvent } from '@react-three/fiber'
import { ContactShadows, Html, Line, OrbitControls } from '@react-three/drei'
import { ExtrudeGeometry, Shape, Vector3, type Mesh } from 'three'
import type { HouseSensor, Zone } from '../api'
import { keyValues } from '../labels'
import { STATUS_COLOR } from '../theme'

type Vec3 = [number, number, number]

// --- Detached house geometry (+x east, +z south) ---------------------------
// One-storey house on a crawl-space plinth with a 30° gable roof. The
// onboarding generator will later derive this from the house profile.
const W = 7 // length along x
const D = 5 // depth along z
const PLINTH = 0.55
const EAVE_Y = PLINTH + 2.5
const PITCH = Math.PI / 6
const RISE = (D / 2) * Math.tan(PITCH)
const RIDGE_Y = EAVE_Y + RISE
const ROOF_T = 0.14
const ROOF_LEN = (D / 2 + 0.4) / Math.cos(PITCH)

const COLORS = {
  wall: '#f7f5f0',
  roof: '#3b4248',
  plinth: '#c7cacc',
  glass: '#7d93a6',
  door: '#01273e',
  metal: '#2f353a',
  ground: '#e9edf0',
}

// Point on a roof slope, `d` metres down from the ridge, just above the skin.
function onSlope(side: 'south' | 'north', x: number, d: number, lift = 0.03): Vec3 {
  const s = side === 'south' ? 1 : -1
  const sin = Math.sin(PITCH)
  const cos = Math.cos(PITCH)
  const n = ROOF_T + lift
  return [x, RIDGE_Y - sin * d + cos * n, s * (cos * d + sin * n)]
}

const FAN_BASE = onSlope('south', 0.9, 0.6, 0)
const FAN_H = 0.75

// Anchor slots per zone, filled in sensor order; each with a callout offset.
const SLOTS: Record<Zone, { at: Vec3; callout: Vec3 }[]> = {
  roof_south: [
    { at: onSlope('south', -1.9, 1.7), callout: [-0.5, 1.3, 0.9] },
    { at: onSlope('south', 1.9, 1.7), callout: [0.5, 1.3, 0.9] },
  ],
  roof_north: [
    { at: onSlope('north', -1.9, 1.7), callout: [-0.5, 1.3, -0.9] },
    { at: onSlope('north', 1.9, 1.7), callout: [0.5, 1.3, -0.9] },
  ],
  ridge: [
    {
      at: [FAN_BASE[0], FAN_BASE[1] + FAN_H + 0.12, FAN_BASE[2]],
      callout: [0.3, 1.2, 0.2],
    },
  ],
  crawl_space: [
    { at: [-2.4, PLINTH / 2, D / 2 + 0.05], callout: [-0.7, 0.9, 1.2] },
  ],
  indoor: [
    { at: [W / 2 + 0.12, EAVE_Y - 0.7, -1.0], callout: [1.3, 0.8, -0.3] },
  ],
}

// --- Model ------------------------------------------------------------------

function Window({ at, size, rotY = 0 }: { at: Vec3; size: [number, number]; rotY?: number }) {
  return (
    <mesh position={at} rotation-y={rotY}>
      <boxGeometry args={[size[0], size[1], 0.05]} />
      <meshStandardMaterial color={COLORS.glass} roughness={0.25} metalness={0.2} />
    </mesh>
  )
}

function HouseModel() {
  const gable = useMemo(() => {
    const s = new Shape()
    s.moveTo(-D / 2, 0)
    s.lineTo(D / 2, 0)
    s.lineTo(0, RISE)
    s.closePath()
    return new ExtrudeGeometry(s, { depth: W, bevelEnabled: false })
  }, [])

  const slopeCenter = (side: 'south' | 'north'): Vec3 => {
    const s = side === 'south' ? 1 : -1
    const sin = Math.sin(PITCH)
    const cos = Math.cos(PITCH)
    const h = ROOF_LEN / 2
    return [0, RIDGE_Y - sin * h + (cos * ROOF_T) / 2, s * (cos * h + (sin * ROOF_T) / 2)]
  }

  const wallMid = PLINTH + 1.25
  const front = D / 2 + 0.01
  const back = -D / 2 - 0.01

  return (
    <group>
      {/* crawl-space plinth with vents */}
      <mesh position={[0, PLINTH / 2, 0]}>
        <boxGeometry args={[W + 0.1, PLINTH, D + 0.1]} />
        <meshStandardMaterial color={COLORS.plinth} />
      </mesh>
      {[-2.4, 2.4].map((x) => (
        <mesh key={x} position={[x, PLINTH / 2, D / 2 + 0.06]}>
          <boxGeometry args={[0.45, 0.16, 0.03]} />
          <meshStandardMaterial color={COLORS.metal} />
        </mesh>
      ))}

      {/* walls + gable attic */}
      <mesh position={[0, PLINTH + 1.25, 0]}>
        <boxGeometry args={[W, 2.5, D]} />
        <meshStandardMaterial color={COLORS.wall} />
      </mesh>
      <mesh geometry={gable} position={[-W / 2, EAVE_Y, 0]} rotation-y={Math.PI / 2}>
        <meshStandardMaterial color={COLORS.wall} />
      </mesh>

      {/* roof slopes + ridge cap */}
      <mesh position={slopeCenter('south')} rotation-x={PITCH}>
        <boxGeometry args={[W + 0.6, ROOF_T, ROOF_LEN]} />
        <meshStandardMaterial color={COLORS.roof} roughness={0.7} />
      </mesh>
      <mesh position={slopeCenter('north')} rotation-x={-PITCH}>
        <boxGeometry args={[W + 0.6, ROOF_T, ROOF_LEN]} />
        <meshStandardMaterial color={COLORS.roof} roughness={0.7} />
      </mesh>
      <mesh position={[0, RIDGE_Y + ROOF_T, 0]} rotation-z={Math.PI / 2}>
        <cylinderGeometry args={[0.07, 0.07, W + 0.6, 12]} />
        <meshStandardMaterial color={COLORS.roof} />
      </mesh>

      {/* chimney */}
      <mesh position={[-0.9, RIDGE_Y + 0.15, -0.55]}>
        <boxGeometry args={[0.5, 1.1, 0.5]} />
        <meshStandardMaterial color="#8a8f93" />
      </mesh>

      {/* roof fan (VILPE huippuimuri) */}
      <group position={FAN_BASE}>
        <mesh position={[0, FAN_H / 2, 0]}>
          <cylinderGeometry args={[0.15, 0.17, FAN_H, 24]} />
          <meshStandardMaterial color={COLORS.metal} />
        </mesh>
        <mesh position={[0, FAN_H, 0]}>
          <cylinderGeometry args={[0.24, 0.24, 0.12, 24]} />
          <meshStandardMaterial color={COLORS.metal} />
        </mesh>
      </group>

      {/* ventilation unit exhaust hood on the east gable */}
      <mesh position={[W / 2 + 0.06, EAVE_Y - 0.7, -1.0]}>
        <boxGeometry args={[0.12, 0.35, 0.35]} />
        <meshStandardMaterial color={COLORS.metal} />
      </mesh>

      {/* windows + door */}
      <Window at={[-2.2, wallMid + 0.15, front]} size={[1.2, 1.1]} />
      <Window at={[1.7, wallMid + 0.15, front]} size={[1.6, 1.1]} />
      <mesh position={[-0.4, PLINTH + 0.95, front]}>
        <boxGeometry args={[0.95, 1.9, 0.06]} />
        <meshStandardMaterial color={COLORS.door} />
      </mesh>
      <Window at={[-1.6, wallMid + 0.15, back]} size={[1.2, 1.1]} />
      <Window at={[1.9, wallMid + 0.15, back]} size={[1.2, 1.1]} />
      <Window at={[-W / 2 - 0.01, wallMid + 0.15, 0.4]} size={[1.1, 1.1]} rotY={Math.PI / 2} />
      <Window at={[W / 2 + 0.01, wallMid + 0.15, 0.9]} size={[1.1, 1.1]} rotY={Math.PI / 2} />
    </group>
  )
}

// --- Sensors ----------------------------------------------------------------

function SensorPoint({
  sensor,
  at,
  callout,
  onHover,
  onSelect,
}: {
  sensor: HouseSensor
  at: Vec3
  callout: Vec3
  onHover: (id: string | null) => void
  onSelect: (s: HouseSensor) => void
}) {
  const dot = useRef<Mesh>(null)
  const card = useRef<HTMLButtonElement>(null)
  const color = STATUS_COLOR[sensor.status]
  const end: Vec3 = [at[0] + callout[0], at[1] + callout[1], at[2] + callout[2]]
  const facing = useMemo(
    () => new Vector3(callout[0], 0, callout[2]).normalize(),
    [callout],
  )
  const anchor = useMemo(() => new Vector3(...at), [at])
  const tmp = useMemo(() => new Vector3(), [])

  useEffect(() => () => void (document.body.style.cursor = 'auto'), [])

  useFrame(({ clock, camera }) => {
    if (dot.current) {
      const speed = sensor.status === 'alert' ? 6 : sensor.status === 'watch' ? 3 : 0
      dot.current.scale.setScalar(speed ? 1 + 0.3 * Math.sin(clock.elapsedTime * speed) : 1)
    }
    // Fade callouts on the far side of the house so the front stays readable.
    if (card.current) {
      const toCam = tmp.copy(camera.position).sub(anchor).setY(0).normalize()
      card.current.style.opacity = toCam.dot(facing) > -0.15 ? '1' : '0.35'
    }
  })

  const hoverOn = (e?: ThreeEvent<PointerEvent>) => {
    e?.stopPropagation()
    onHover(sensor.id)
    document.body.style.cursor = 'pointer'
  }
  const hoverOff = () => {
    onHover(null)
    document.body.style.cursor = 'auto'
  }

  return (
    <group>
      <mesh
        position={at}
        onClick={(e: ThreeEvent<MouseEvent>) => {
          e.stopPropagation()
          onSelect(sensor)
        }}
        onPointerOver={hoverOn}
        onPointerOut={hoverOff}
      >
        <sphereGeometry args={[0.3, 12, 12]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      <mesh ref={dot} position={at}>
        <sphereGeometry args={[0.1, 24, 24]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.8} />
      </mesh>
      <Line points={[at, end]} color="#01273e" lineWidth={1} transparent opacity={0.45} />
      <Html position={end} zIndexRange={[20, 0]}>
        <button
          ref={card}
          onClick={() => onSelect(sensor)}
          onMouseEnter={() => onHover(sensor.id)}
          onMouseLeave={() => onHover(null)}
          className="flex -translate-x-1/2 -translate-y-full cursor-pointer flex-col gap-0.5 rounded-xl border border-white/70 bg-white/90 px-3 py-2 text-left whitespace-nowrap shadow-lg shadow-navy/10 backdrop-blur-md transition duration-300 hover:scale-105"
        >
          <span className="flex items-center gap-2">
            <span
              className={`h-2.5 w-2.5 rounded-full ${sensor.status === 'ok' ? '' : 'animate-pulse'}`}
              style={{ background: color, boxShadow: `0 0 0 3px ${color}33` }}
            />
            <span className="font-display text-xs font-semibold text-navy">{sensor.name}</span>
          </span>
          <span className="pl-[18px] text-[11px] text-muted tabular-nums">
            {keyValues(sensor.latest).join(' · ')}
          </span>
        </button>
      </Html>
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
  const [hovered, setHovered] = useState<string | null>(null)

  const placed = useMemo(() => {
    const used: Partial<Record<Zone, number>> = {}
    return sensors.flatMap((s) => {
      const slots = SLOTS[s.zone]
      if (!s.primary || !slots?.length) return []
      const i = used[s.zone] ?? 0
      used[s.zone] = i + 1
      return [{ sensor: s, ...slots[i % slots.length] }]
    })
  }, [sensors])

  return (
    <Canvas camera={{ position: [10, 6.5, 12], fov: 34 }}>
      <hemisphereLight args={['#ffffff', '#dfe5ea', 0.7]} />
      <directionalLight position={[8, 12, 6]} intensity={1.4} />
      <directionalLight position={[-6, 6, -8]} intensity={0.35} />
      <HouseModel />
      {placed.map(({ sensor, at, callout }) => (
        <SensorPoint
          key={sensor.id}
          sensor={sensor}
          at={at}
          callout={callout}
          onHover={setHovered}
          onSelect={onSelect}
        />
      ))}
      <mesh rotation-x={-Math.PI / 2} position={[0, -0.01, 0]}>
        <circleGeometry args={[14, 64]} />
        <meshStandardMaterial color={COLORS.ground} />
      </mesh>
      <ContactShadows position={[0, 0, 0]} opacity={0.35} scale={20} blur={2.4} far={5} />
      <OrbitControls
        target={[0, 2, 0]}
        autoRotate={hovered === null}
        autoRotateSpeed={0.35}
        enableDamping
        dampingFactor={0.08}
        enablePan={false}
        minPolarAngle={Math.PI * 0.18}
        maxPolarAngle={Math.PI * 0.46}
        minDistance={8}
        maxDistance={22}
      />
    </Canvas>
  )
}
