import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { ContactShadows, OrbitControls } from '@react-three/drei'
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

function SensorDot({
  sensor,
  at,
  onHover,
  onSelect,
}: {
  sensor: HouseSensor
  at: Vec3
  onHover: (id: string | null) => void
  onSelect: (s: HouseSensor) => void
}) {
  const dot = useRef<Mesh>(null)
  const color = STATUS_COLOR[sensor.status]

  useEffect(() => () => void (document.body.style.cursor = 'auto'), [])

  useFrame(({ clock }) => {
    if (!dot.current) return
    const speed = sensor.status === 'alert' ? 6 : sensor.status === 'watch' ? 3 : 0
    dot.current.scale.setScalar(speed ? 1 + 0.3 * Math.sin(clock.elapsedTime * speed) : 1)
  })

  return (
    <group position={at}>
      <mesh
        onClick={(e: ThreeEvent<MouseEvent>) => {
          e.stopPropagation()
          onSelect(sensor)
        }}
        onPointerOver={(e: ThreeEvent<PointerEvent>) => {
          e.stopPropagation()
          onHover(sensor.id)
          document.body.style.cursor = 'pointer'
        }}
        onPointerOut={() => {
          onHover(null)
          document.body.style.cursor = 'auto'
        }}
      >
        <sphereGeometry args={[0.3, 12, 12]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      <mesh ref={dot}>
        <sphereGeometry args={[0.1, 24, 24]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.8} />
      </mesh>
    </group>
  )
}

// --- Callouts (screen-space) -------------------------------------------------
// Cards live in two columns at the canvas edges, stacked so they never
// overlap or leave the viewport; a leader line runs from each dot to its card.

const CARD_W = 184
const CARD_H = 50
const GAP = 10
const MARGIN = 20
const SWITCH_PX = 40 // hysteresis before a card swaps columns

type Placed = { sensor: HouseSensor; at: Vec3; out: Vec3 }
type Els = Map<string, { card?: HTMLButtonElement | null; line?: SVGLineElement | null }>

function CalloutLayout({ placed, els }: { placed: Placed[]; els: RefObject<Els> }) {
  const { camera, size } = useThree()
  const pos = useRef(new Map<string, { x: number; y: number; right: boolean }>())
  const v = useMemo(() => new Vector3(), [])
  const toCam = useMemo(() => new Vector3(), [])

  useFrame(() => {
    const { width: w, height: h } = size
    const pts = placed.map(({ sensor, at, out }) => {
      v.set(...at).project(camera)
      const px = ((v.x + 1) / 2) * w
      const py = ((1 - v.y) / 2) * h
      const prev = pos.current.get(sensor.id)
      const right = prev
        ? prev.right
          ? px > w / 2 - SWITCH_PX
          : px > w / 2 + SWITCH_PX
        : px > w / 2
      toCam.copy(camera.position).sub(v.set(...at)).setY(0).normalize()
      const facing = toCam.x * out[0] + toCam.z * out[2] > -0.15
      return { id: sensor.id, px, py, right, facing }
    })

    for (const right of [false, true]) {
      const col = pts.filter((p) => p.right === right).sort((a, b) => a.py - b.py)
      const ys = col.map((p) => Math.min(Math.max(p.py - CARD_H / 2, MARGIN), h - MARGIN - CARD_H))
      for (let i = 1; i < ys.length; i++) ys[i] = Math.max(ys[i], ys[i - 1] + CARD_H + GAP)
      for (let i = ys.length - 1; i >= 0; i--) {
        const limit = i === ys.length - 1 ? h - MARGIN - CARD_H : ys[i + 1] - CARD_H - GAP
        ys[i] = Math.max(Math.min(ys[i], limit), MARGIN)
      }
      col.forEach((p, i) => {
        const tx = right ? w - MARGIN - CARD_W : MARGIN
        const prev = pos.current.get(p.id)
        const s = prev
          ? { x: prev.x + (tx - prev.x) * 0.15, y: prev.y + (ys[i] - prev.y) * 0.15, right }
          : { x: tx, y: ys[i], right }
        pos.current.set(p.id, s)
        const el = els.current.get(p.id)
        const opacity = p.facing ? '1' : '0.45'
        if (el?.card) {
          el.card.style.transform = `translate(${s.x}px, ${s.y}px)`
          el.card.style.opacity = opacity
        }
        if (el?.line) {
          el.line.setAttribute('x1', String(p.px))
          el.line.setAttribute('y1', String(p.py))
          el.line.setAttribute('x2', String(right ? s.x : s.x + CARD_W))
          el.line.setAttribute('y2', String(s.y + CARD_H / 2))
          el.line.style.opacity = p.facing ? '0.5' : '0.2'
        }
      })
    }
  })

  return null
}

function CalloutCard({
  sensor,
  cardRef,
  onHover,
  onSelect,
}: {
  sensor: HouseSensor
  cardRef: (el: HTMLButtonElement | null) => void
  onHover: (id: string | null) => void
  onSelect: (s: HouseSensor) => void
}) {
  const color = STATUS_COLOR[sensor.status]
  return (
    <button
      ref={cardRef}
      onClick={() => onSelect(sensor)}
      onMouseEnter={() => onHover(sensor.id)}
      onMouseLeave={() => onHover(null)}
      style={{ width: CARD_W, height: CARD_H, opacity: 0 }}
      className="pointer-events-auto absolute top-0 left-0 flex cursor-pointer flex-col justify-center gap-0.5 rounded-xl border border-white/70 bg-white/90 px-3 text-left shadow-lg shadow-navy/10 backdrop-blur-md transition-[opacity,box-shadow] duration-300 hover:shadow-navy/25"
    >
      <span className="flex items-center gap-2">
        <span
          className={`h-2.5 w-2.5 shrink-0 rounded-full ${sensor.status === 'ok' ? '' : 'animate-pulse'}`}
          style={{ background: color, boxShadow: `0 0 0 3px ${color}33` }}
        />
        <span className="truncate font-display text-xs font-semibold text-navy">
          {sensor.name}
        </span>
      </span>
      <span className="truncate pl-[18px] text-[11px] text-muted tabular-nums">
        {keyValues(sensor.latest).join(' · ')}
      </span>
    </button>
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
  const els = useRef<Els>(new Map())

  const placed = useMemo(() => {
    const used: Partial<Record<Zone, number>> = {}
    return sensors.flatMap((s) => {
      const slots = SLOTS[s.zone]
      if (!s.primary || !slots?.length) return []
      const i = used[s.zone] ?? 0
      used[s.zone] = i + 1
      const slot = slots[i % slots.length]
      return [{ sensor: s, at: slot.at, out: slot.callout }]
    })
  }, [sensors])

  const register = (id: string, key: 'card' | 'line') => (el: HTMLButtonElement | SVGLineElement | null) => {
    const entry = els.current.get(id) ?? {}
    Object.assign(entry, { [key]: el })
    els.current.set(id, entry)
  }

  return (
    <div className="relative h-full w-full">
      <Canvas camera={{ position: [10, 6.5, 12], fov: 34 }}>
        <hemisphereLight args={['#ffffff', '#dfe5ea', 0.7]} />
        <directionalLight position={[8, 12, 6]} intensity={1.4} />
        <directionalLight position={[-6, 6, -8]} intensity={0.35} />
        <HouseModel />
        {placed.map(({ sensor, at }) => (
          <SensorDot
            key={sensor.id}
            sensor={sensor}
            at={at}
            onHover={setHovered}
            onSelect={onSelect}
          />
        ))}
        <CalloutLayout placed={placed} els={els} />
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
      <div className="pointer-events-none absolute inset-0">
        <svg className="absolute inset-0 h-full w-full">
          {placed.map(({ sensor }) => (
            <line
              key={sensor.id}
              ref={register(sensor.id, 'line')}
              stroke="#01273e"
              strokeWidth={1}
              strokeDasharray="3 3"
              style={{ opacity: 0 }}
            />
          ))}
        </svg>
        {placed.map(({ sensor }) => (
          <CalloutCard
            key={sensor.id}
            sensor={sensor}
            cardRef={register(sensor.id, 'card')}
            onHover={setHovered}
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>
  )
}
