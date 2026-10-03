import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { ContactShadows, OrbitControls } from '@react-three/drei'
import { ExtrudeGeometry, Shape, Vector3, type Mesh } from 'three'
import type { HouseSensor, Zone } from '../api'
import { calloutValues } from '../labels'
import { STATUS_COLOR } from '../theme'

type Vec3 = [number, number, number]
type Slot = { at: Vec3; callout: Vec3 }
type Slots = Partial<Record<Zone, Slot[]>>

// --- Detached house geometry (+x east, +z south) ---------------------------
// One-storey house on a crawl-space plinth with a 30° gable roof. The
// onboarding generator will later derive this from the house profile.
const HW = 7 // length along x
const HD = 5 // depth along z
const PLINTH = 0.55
const EAVE_Y = PLINTH + 2.5
const PITCH = Math.PI / 6
const RISE = (HD / 2) * Math.tan(PITCH)
const RIDGE_Y = EAVE_Y + RISE
const HOUSE_ROOF_T = 0.14
const HOUSE_ROOF_LEN = (HD / 2 + 0.4) / Math.cos(PITCH)

const HOUSE_COLORS = {
  wall: '#f7f5f0',
  roof: '#3b4248',
  plinth: '#c7cacc',
  glass: '#7d93a6',
  door: '#01273e',
  metal: '#2f353a',
}

// Point on a roof slope, `d` metres down from the ridge, just above the skin.
function onSlope(side: 'south' | 'north', x: number, d: number, lift = 0.03): Vec3 {
  const s = side === 'south' ? 1 : -1
  const sin = Math.sin(PITCH)
  const cos = Math.cos(PITCH)
  const n = HOUSE_ROOF_T + lift
  return [x, RIDGE_Y - sin * d + cos * n, s * (cos * d + sin * n)]
}

const FAN_BASE = onSlope('south', 0.9, 0.6, 0)
const FAN_H = 0.75
const CRAWL_FAN_X = -1.25 // between the front window and the door

// Anchor slots per zone, filled in sensor order; each with a callout offset.
const HOUSE_SLOTS: Slots = {
  roof_south: [
    { at: onSlope('south', -1.9, 1.7), callout: [-0.4, 0.95, 0.7] },
    { at: onSlope('south', 1.9, 1.7), callout: [0.4, 0.95, 0.7] },
  ],
  roof_north: [
    { at: onSlope('north', -1.9, 1.7), callout: [-0.4, 0.95, -0.7] },
    { at: onSlope('north', 1.9, 1.7), callout: [0.4, 0.95, -0.7] },
  ],
  ridge: [
    {
      at: [FAN_BASE[0], FAN_BASE[1] + FAN_H + 0.12, FAN_BASE[2]],
      callout: [0.3, 0.7, 0.2],
    },
  ],
  // the crawl space package: humidity sensor at the vent + the drying fan
  crawl_space: [
    { at: [-2.4, PLINTH / 2, HD / 2 + 0.05], callout: [-0.7, 0.9, 1.2] },
    { at: [CRAWL_FAN_X, PLINTH / 2 + 0.02, HD / 2 + 0.25], callout: [0.6, 0.9, 1.2] },
  ],
}

// --- Data centre geometry ---------------------------------------------------
// Flat-roofed facility for the enterprise demo: a main hall and a second hall
// behind it plus a glazed office annex. The roofs carry only VILPE
// huippuimuri exhaust fans and the sensor dots themselves.
const W = 10 // main hall length along x
const D = 7 // main hall depth along z
const HALL_H = 3.4
const ROOF_T = 0.22
const ROOF_Y = HALL_H + ROOF_T
const PARAPET = 0.34

const H2 = { x: -1.5, z: -6.4, w: 8, h: 3.0, d: 4 } // second hall, behind
const ANNEX = { x: 6.9, z: 2.0, w: 3.4, h: 2.6, d: 3.2 } // office annex, front right

// the two huippuimurit that carry the fan sensor dots
const DC_FANS: Vec3[] = [
  [-2.0, ROOF_Y, -0.2],
  [1.0, ROOF_Y, 0.4],
]
const DC_FAN_H = 1.3

const COLORS = {
  wall: '#dde1e4',
  wall2: '#ccd1d5',
  roof: '#3b4248',
  plinth: '#b6bcc0',
  glass: '#5f7d94',
  door: '#01273e',
  metal: '#2f353a',
  louver: '#4c555d',
  ground: '#e9edf0',
  apron: '#cfd5d9',
}

const DC_SLOTS: Slots = {
  roof_south: [
    { at: [-2.6, ROOF_Y + 0.12, 2.0], callout: [-0.5, 1.0, 1.0] },
    { at: [2.6, ROOF_Y + 0.12, 2.0], callout: [0.5, 1.0, 1.0] },
  ],
  roof_north: [
    { at: [-2.6, ROOF_Y + 0.12, -2.3], callout: [-0.5, 1.0, -1.0] },
    { at: [2.6, ROOF_Y + 0.12, -2.3], callout: [0.5, 1.0, -1.0] },
  ],
  // on top of the two big exhaust fans
  ridge: DC_FANS.map(([x, , z]) => ({
    at: [x, ROOF_Y + DC_FAN_H + 0.32, z] as Vec3,
    callout: [x < 0 ? -0.55 : 0.55, 0.8, z < 0 ? -0.4 : 0.4] as Vec3,
  })),
}

// --- Model ------------------------------------------------------------------

function Parapet({ w, d, y }: { w: number; d: number; y: number }) {
  const t = 0.14
  return (
    <group>
      <mesh position={[0, y, d / 2 - t / 2]}>
        <boxGeometry args={[w + 0.3, PARAPET, t]} />
        <meshStandardMaterial color={COLORS.roof} />
      </mesh>
      <mesh position={[0, y, -d / 2 + t / 2]}>
        <boxGeometry args={[w + 0.3, PARAPET, t]} />
        <meshStandardMaterial color={COLORS.roof} />
      </mesh>
      <mesh position={[w / 2 - t / 2, y, 0]}>
        <boxGeometry args={[t, PARAPET, d + 0.3]} />
        <meshStandardMaterial color={COLORS.roof} />
      </mesh>
      <mesh position={[-w / 2 + t / 2, y, 0]}>
        <boxGeometry args={[t, PARAPET, d + 0.3]} />
        <meshStandardMaterial color={COLORS.roof} />
      </mesh>
    </group>
  )
}

// A flat-roofed hall: walls, roof slab, parapet and a base strip.
function Hall({ x, z, w, d, h, color }: { x: number; z: number; w: number; d: number; h: number; color: string }) {
  const roofY = h + ROOF_T
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, h / 2, 0]}>
        <boxGeometry args={[w, h, d]} />
        <meshStandardMaterial color={color} roughness={0.85} />
      </mesh>
      <mesh position={[0, h + ROOF_T / 2, 0]}>
        <boxGeometry args={[w + 0.3, ROOF_T, d + 0.3]} />
        <meshStandardMaterial color={COLORS.roof} roughness={0.75} />
      </mesh>
      <Parapet w={w} d={d} y={roofY + PARAPET / 2 - 0.04} />
      <mesh position={[0, 0.25, 0]}>
        <boxGeometry args={[w + 0.16, 0.5, d + 0.16]} />
        <meshStandardMaterial color={COLORS.plinth} />
      </mesh>
    </group>
  )
}

// Exhaust chimney (VILPE-style roof fan).
function Chimney({ at, h = 0.85 }: { at: Vec3; h?: number }) {
  return (
    <group position={at}>
      <mesh position={[0, h / 2, 0]}>
        <cylinderGeometry args={[0.16, 0.19, h, 16]} />
        <meshStandardMaterial color={COLORS.metal} />
      </mesh>
      <mesh position={[0, h + 0.05, 0]}>
        <cylinderGeometry args={[0.27, 0.27, 0.12, 16]} />
        <meshStandardMaterial color={COLORS.metal} />
      </mesh>
    </group>
  )
}

// Big huippuimuri exhaust fan — carries a fan sensor dot on top.
function RoofFan({ at }: { at: Vec3 }) {
  return (
    <group position={at}>
      <mesh position={[0, DC_FAN_H / 2, 0]}>
        <cylinderGeometry args={[0.3, 0.36, DC_FAN_H, 20]} />
        <meshStandardMaterial color={COLORS.metal} />
      </mesh>
      <mesh position={[0, DC_FAN_H + 0.07, 0]}>
        <cylinderGeometry args={[0.55, 0.55, 0.14, 20]} />
        <meshStandardMaterial color={COLORS.metal} />
      </mesh>
      <mesh position={[0, DC_FAN_H + 0.2, 0]}>
        <cylinderGeometry args={[0.14, 0.2, 0.14, 16]} />
        <meshStandardMaterial color={COLORS.metal} />
      </mesh>
    </group>
  )
}

function DataCenterModel() {
  return (
    <group>
      {/* concrete apron under the whole site */}
      <mesh position={[0, 0.03, -1.5]}>
        <boxGeometry args={[18, 0.06, 15]} />
        <meshStandardMaterial color={COLORS.apron} roughness={1} />
      </mesh>

      {/* halls */}
      <Hall x={0} z={0} w={W} d={D} h={HALL_H} color={COLORS.wall} />
      <Hall x={H2.x} z={H2.z} w={H2.w} d={H2.d} h={H2.h} color={COLORS.wall2} />

      {/* rear hall exhaust fans */}
      {[-3, -1, 1, 3].map((dx) => (
        <Chimney key={dx} at={[H2.x + dx, H2.h + ROOF_T, H2.z - 0.6]} h={0.7} />
      ))}
      {[-2, 2].map((dx) => (
        <Chimney key={dx} at={[H2.x + dx, H2.h + ROOF_T, H2.z + 1.2]} h={0.7} />
      ))}

      {/* huippuimurit carrying the fan sensors */}
      {DC_FANS.map((at) => (
        <RoofFan key={at.join(',')} at={at} />
      ))}

      {/* smaller exhaust chimneys across the roof */}
      {[-4, -2, 0, 2, 4].map((x) => (
        <Chimney key={`s${x}`} at={[x, ROOF_Y, 2.95]} />
      ))}
      {[-3.5, -1.5, 0.5, 2.5].map((x) => (
        <Chimney key={`n${x}`} at={[x, ROOF_Y, -2.95]} h={0.7} />
      ))}
      {[
        [4.1, 0.6],
        [-4.2, 0.9],
      ].map(([x, z]) => (
        <Chimney key={`m${x}`} at={[x, ROOF_Y, z]} h={0.75} />
      ))}

      {/* intake louvers on the south wall */}
      {[-3.1, 0, 3.1].map((x) => (
        <mesh key={x} position={[x, 1.5, D / 2 + 0.04]}>
          <boxGeometry args={[2.4, 1.9, 0.08]} />
          <meshStandardMaterial color={COLORS.louver} roughness={0.85} />
        </mesh>
      ))}

      {/* glazed office annex */}
      <group position={[ANNEX.x, 0, ANNEX.z]}>
        <mesh position={[0, ANNEX.h / 2, 0]}>
          <boxGeometry args={[ANNEX.w, ANNEX.h, ANNEX.d]} />
          <meshStandardMaterial color={COLORS.wall} roughness={0.85} />
        </mesh>
        <mesh position={[0, ANNEX.h + 0.1, 0]}>
          <boxGeometry args={[ANNEX.w + 0.2, 0.2, ANNEX.d + 0.2]} />
          <meshStandardMaterial color={COLORS.roof} roughness={0.75} />
        </mesh>
        <mesh position={[0, 1.55, ANNEX.d / 2 + 0.03]}>
          <boxGeometry args={[ANNEX.w - 0.6, 1.3, 0.06]} />
          <meshStandardMaterial color={COLORS.glass} roughness={0.25} metalness={0.2} />
        </mesh>
        <mesh position={[-ANNEX.w / 2 - 0.03, 1.55, 0]} rotation-y={Math.PI / 2}>
          <boxGeometry args={[ANNEX.d - 0.6, 1.3, 0.06]} />
          <meshStandardMaterial color={COLORS.glass} roughness={0.25} metalness={0.2} />
        </mesh>
        <mesh position={[0.8, 0.75, ANNEX.d / 2 + 0.04]}>
          <boxGeometry args={[0.8, 1.5, 0.07]} />
          <meshStandardMaterial color={COLORS.door} />
        </mesh>
        <mesh position={[0.8, 1.62, ANNEX.d / 2 + 0.2]}>
          <boxGeometry args={[1.2, 0.08, 0.5]} />
          <meshStandardMaterial color={COLORS.metal} />
        </mesh>
      </group>

      {/* site lighting */}
      {[
        [-6.2, 4.6],
        [2.5, 5.2],
      ].map(([x, z]) => (
        <group key={x} position={[x, 0, z]}>
          <mesh position={[0, 1.5, 0]}>
            <cylinderGeometry args={[0.035, 0.05, 3, 8]} />
            <meshStandardMaterial color={COLORS.metal} />
          </mesh>
          <mesh position={[0.18, 2.95, 0]}>
            <boxGeometry args={[0.45, 0.08, 0.16]} />
            <meshStandardMaterial color={COLORS.metal} />
          </mesh>
        </group>
      ))}

      {/* site sign pylon */}
      <group position={[6.9, 0, 4.9]}>
        <mesh position={[0, 0.9, 0]}>
          <cylinderGeometry args={[0.05, 0.05, 1.8, 8]} />
          <meshStandardMaterial color={COLORS.metal} />
        </mesh>
        <mesh position={[0, 1.7, 0]}>
          <boxGeometry args={[1.1, 0.7, 0.08]} />
          <meshStandardMaterial color={COLORS.door} roughness={0.6} />
        </mesh>
      </group>
    </group>
  )
}

function Window({ at, size, rotY = 0 }: { at: Vec3; size: [number, number]; rotY?: number }) {
  return (
    <mesh position={at} rotation-y={rotY}>
      <boxGeometry args={[size[0], size[1], 0.05]} />
      <meshStandardMaterial color={HOUSE_COLORS.glass} roughness={0.25} metalness={0.2} />
    </mesh>
  )
}

function HouseModel() {
  const gable = useMemo(() => {
    const s = new Shape()
    s.moveTo(-HD / 2, 0)
    s.lineTo(HD / 2, 0)
    s.lineTo(0, RISE)
    s.closePath()
    return new ExtrudeGeometry(s, { depth: HW, bevelEnabled: false })
  }, [])

  const slopeCenter = (side: 'south' | 'north'): Vec3 => {
    const s = side === 'south' ? 1 : -1
    const sin = Math.sin(PITCH)
    const cos = Math.cos(PITCH)
    const h = HOUSE_ROOF_LEN / 2
    return [0, RIDGE_Y - sin * h + (cos * HOUSE_ROOF_T) / 2, s * (cos * h + (sin * HOUSE_ROOF_T) / 2)]
  }

  const wallMid = PLINTH + 1.25
  const front = HD / 2 + 0.01
  const back = -HD / 2 - 0.01

  return (
    <group>
      {/* crawl-space plinth with vents */}
      <mesh position={[0, PLINTH / 2, 0]}>
        <boxGeometry args={[HW + 0.1, PLINTH, HD + 0.1]} />
        <meshStandardMaterial color={HOUSE_COLORS.plinth} />
      </mesh>
      {[-2.4, 2.4].map((x) => (
        <mesh key={x} position={[x, PLINTH / 2, HD / 2 + 0.06]}>
          <boxGeometry args={[0.45, 0.16, 0.03]} />
          <meshStandardMaterial color={HOUSE_COLORS.metal} />
        </mesh>
      ))}

      {/* walls + gable attic */}
      <mesh position={[0, PLINTH + 1.25, 0]}>
        <boxGeometry args={[HW, 2.5, HD]} />
        <meshStandardMaterial color={HOUSE_COLORS.wall} />
      </mesh>
      <mesh geometry={gable} position={[-HW / 2, EAVE_Y, 0]} rotation-y={Math.PI / 2}>
        <meshStandardMaterial color={HOUSE_COLORS.wall} />
      </mesh>

      {/* roof slopes + ridge cap */}
      <mesh position={slopeCenter('south')} rotation-x={PITCH}>
        <boxGeometry args={[HW + 0.6, HOUSE_ROOF_T, HOUSE_ROOF_LEN]} />
        <meshStandardMaterial color={HOUSE_COLORS.roof} roughness={0.7} />
      </mesh>
      <mesh position={slopeCenter('north')} rotation-x={-PITCH}>
        <boxGeometry args={[HW + 0.6, HOUSE_ROOF_T, HOUSE_ROOF_LEN]} />
        <meshStandardMaterial color={HOUSE_COLORS.roof} roughness={0.7} />
      </mesh>
      <mesh position={[0, RIDGE_Y + HOUSE_ROOF_T, 0]} rotation-z={Math.PI / 2}>
        <cylinderGeometry args={[0.07, 0.07, HW + 0.6, 12]} />
        <meshStandardMaterial color={HOUSE_COLORS.roof} />
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
          <meshStandardMaterial color={HOUSE_COLORS.metal} />
        </mesh>
        <mesh position={[0, FAN_H, 0]}>
          <cylinderGeometry args={[0.24, 0.24, 0.12, 24]} />
          <meshStandardMaterial color={HOUSE_COLORS.metal} />
        </mesh>
      </group>

      {/* crawl space fan: housing on the plinth, exhaust pipe up the wall */}
      <group position={[CRAWL_FAN_X, 0, HD / 2 + 0.13]}>
        <mesh position={[0, PLINTH / 2 + 0.02, 0]}>
          <boxGeometry args={[0.36, 0.36, 0.2]} />
          <meshStandardMaterial color={HOUSE_COLORS.metal} />
        </mesh>
        <mesh position={[0, (PLINTH + EAVE_Y) / 2 + 0.05, -0.02]}>
          <cylinderGeometry args={[0.065, 0.065, EAVE_Y - PLINTH - 0.2, 16]} />
          <meshStandardMaterial color={HOUSE_COLORS.metal} />
        </mesh>
        <mesh position={[0, EAVE_Y - 0.12, -0.02]}>
          <cylinderGeometry args={[0.11, 0.09, 0.12, 16]} />
          <meshStandardMaterial color={HOUSE_COLORS.metal} />
        </mesh>
      </group>

      {/* windows + door */}
      <Window at={[-2.2, wallMid + 0.15, front]} size={[1.2, 1.1]} />
      <Window at={[1.7, wallMid + 0.15, front]} size={[1.6, 1.1]} />
      <mesh position={[-0.4, PLINTH + 0.95, front]}>
        <boxGeometry args={[0.95, 1.9, 0.06]} />
        <meshStandardMaterial color={HOUSE_COLORS.door} />
      </mesh>
      <Window at={[-1.6, wallMid + 0.15, back]} size={[1.2, 1.1]} />
      <Window at={[1.9, wallMid + 0.15, back]} size={[1.2, 1.1]} />
      <Window at={[-HW / 2 - 0.01, wallMid + 0.15, 0.4]} size={[1.1, 1.1]} rotY={Math.PI / 2} />
      <Window at={[HW / 2 + 0.01, wallMid + 0.15, 0.9]} size={[1.1, 1.1]} rotY={Math.PI / 2} />
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

// --- Callouts ----------------------------------------------------------------
// Each card sits right next to its device (above the dot, out along the
// slot's callout offset), like a label pinned to the house. Cards that
// collide are nudged apart and everything is kept inside the canvas, so no
// card ever hides behind another or off-screen.

const GAP = 8
const MARGIN = 12
const RELAX_STEPS = 16

type Placed = { sensor: HouseSensor; at: Vec3; out: Vec3 }
type Els = Map<string, { card?: HTMLButtonElement | null; line?: SVGGElement | null }>
type Box = { id: string; ax: number; ay: number; x: number; y: number; w: number; h: number; front: boolean }

function CalloutLayout({
  placed,
  els,
  insetTop,
}: {
  placed: Placed[]
  els: RefObject<Els>
  insetTop: number
}) {
  const { camera, size } = useThree()
  const pos = useRef(new Map<string, { x: number; y: number }>())
  const v = useMemo(() => new Vector3(), [])
  const toCam = useMemo(() => new Vector3(), [])

  useFrame(() => {
    const { width: W, height: H } = size
    const toPx = (p: Vec3) => {
      v.set(...p).project(camera)
      return [((v.x + 1) / 2) * W, ((1 - v.y) / 2) * H] as const
    }

    const boxes: Box[] = placed.map(({ sensor, at, out }) => {
      const el = els.current.get(sensor.id)?.card
      const w = el?.offsetWidth ?? 160
      const h = el?.offsetHeight ?? 46
      const [ax, ay] = toPx(at)
      const [ex, ey] = toPx([at[0] + out[0], at[1] + out[1], at[2] + out[2]])
      toCam.copy(camera.position).sub(v.set(...at)).setY(0).normalize()
      const front = toCam.x * out[0] + toCam.z * out[2] > -0.15
      // card bottom-centre at the callout end point
      return { id: sensor.id, ax, ay, x: ex - w / 2, y: ey - h, w, h, front }
    })

    const clamp = (b: Box) => {
      b.x = Math.min(Math.max(b.x, MARGIN), W - MARGIN - b.w)
      b.y = Math.min(Math.max(b.y, MARGIN + insetTop), H - MARGIN - b.h)
    }
    boxes.forEach(clamp)
    // Push overlapping cards apart until none collide.
    for (let step = 0; step < RELAX_STEPS; step++) {
      let moved = false
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i]
          const b = boxes[j]
          const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) + GAP
          const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) + GAP
          if (ox <= 0 || oy <= 0) continue
          moved = true
          // Separate along the cheaper axis; a back-side card yields to a front one.
          const horizontal = ox < oy
          const ac = horizontal ? a.x + a.w / 2 : a.y + a.h / 2
          const bc = horizontal ? b.x + b.w / 2 : b.y + b.h / 2
          const [first, second] = ac <= bc ? [a, b] : [b, a]
          const share = first.front === second.front ? 0.5 : first.front ? 0 : 1
          const d = horizontal ? ox : oy
          if (horizontal) {
            first.x -= d * share
            second.x += d * (1 - share)
          } else {
            first.y -= d * share
            second.y += d * (1 - share)
          }
          clamp(first)
          clamp(second)
        }
      }
      if (!moved) break
    }

    // Back-side cards that still collide are hidden until they rotate clear;
    // front cards always win.
    const overlaps = (a: Box, b: Box) =>
      a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
    const shown: Box[] = boxes.filter((b) => b.front)
    const visible = new Set(shown.map((b) => b.id))
    for (const b of boxes.filter((b) => !b.front)) {
      if (shown.some((o) => overlaps(b, o))) continue
      shown.push(b)
      visible.add(b.id)
    }

    for (const b of boxes) {
      const prev = pos.current.get(b.id)
      const s = prev ? { x: prev.x + (b.x - prev.x) * 0.2, y: prev.y + (b.y - prev.y) * 0.2 } : { x: b.x, y: b.y }
      pos.current.set(b.id, s)
      const el = els.current.get(b.id)
      if (el?.card) {
        el.card.style.transform = `translate(${s.x}px, ${s.y}px)`
        el.card.style.opacity = b.front ? '1' : visible.has(b.id) ? '0.4' : '0'
        el.card.style.pointerEvents = visible.has(b.id) ? 'auto' : 'none'
        el.card.style.zIndex = b.front ? '2' : '1'
      }
      if (el?.line) {
        for (const ln of el.line.children) {
          ln.setAttribute('x1', String(b.ax))
          ln.setAttribute('y1', String(b.ay))
          ln.setAttribute('x2', String(s.x + b.w / 2))
          ln.setAttribute('y2', String(s.y + b.h))
        }
        el.line.style.opacity = b.front ? '1' : visible.has(b.id) ? '0.35' : '0'
      }
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
      style={{ opacity: 0 }}
      className="pointer-events-auto absolute top-0 left-0 flex cursor-pointer flex-col gap-0.5 rounded-xl border border-white/70 bg-white/90 px-3 py-2 text-left whitespace-nowrap shadow-lg shadow-navy/10 backdrop-blur-md transition-[opacity,box-shadow] duration-300 hover:shadow-navy/25"
    >
      <span className="flex items-center gap-2">
        <span
          className={`h-2.5 w-2.5 shrink-0 rounded-full ${sensor.status === 'ok' ? '' : 'animate-pulse'}`}
          style={{ background: color, boxShadow: `0 0 0 3px ${color}33` }}
        />
        <span className="font-display text-xs font-semibold text-navy">
          {sensor.name}
        </span>
      </span>
      <span className="pl-[18px] text-[11px] text-muted tabular-nums">
        {calloutValues(sensor).join(' · ')}
      </span>
    </button>
  )
}

export type SceneVariant = 'house' | 'datacenter'

export default function HouseScene({
  sensors,
  variant = 'house',
  insetTop = 0,
  onSelect,
}: {
  sensors: HouseSensor[]
  // which building model + sensor layout to draw
  variant?: SceneVariant
  // px reserved at the top for overlays; callouts stay below it
  insetTop?: number
  onSelect: (s: HouseSensor) => void
}) {
  const [hovered, setHovered] = useState<string | null>(null)
  const els = useRef<Els>(new Map())
  const dc = variant === 'datacenter'
  const slots = dc ? DC_SLOTS : HOUSE_SLOTS

  const placed = useMemo(() => {
    const used: Partial<Record<Zone, number>> = {}
    return sensors.flatMap((s) => {
      const zoneSlots = slots[s.zone]
      if (!s.primary || !zoneSlots?.length) return []
      const i = used[s.zone] ?? 0
      used[s.zone] = i + 1
      const slot = zoneSlots[i % zoneSlots.length]
      return [{ sensor: s, at: slot.at, out: slot.callout }]
    })
  }, [sensors, slots])

  const register = (id: string, key: 'card' | 'line') => (el: HTMLButtonElement | SVGGElement | null) => {
    const entry = els.current.get(id) ?? {}
    Object.assign(entry, { [key]: el })
    els.current.set(id, entry)
  }

  return (
    <div className="relative h-full w-full">
      <Canvas camera={{ position: dc ? [15, 10.5, 17] : [13.5, 9.4, 16.2], fov: 34 }}>
        <hemisphereLight args={['#ffffff', '#dfe5ea', 0.7]} />
        <directionalLight position={[8, 12, 6]} intensity={1.4} />
        <directionalLight position={[-6, 6, -8]} intensity={0.35} />
        {dc ? <DataCenterModel /> : <HouseModel />}
        {placed.map(({ sensor, at }) => (
          <SensorDot
            key={sensor.id}
            sensor={sensor}
            at={at}
            onHover={setHovered}
            onSelect={onSelect}
          />
        ))}
        <CalloutLayout placed={placed} els={els} insetTop={insetTop} />
        <mesh rotation-x={-Math.PI / 2} position={[0, -0.01, 0]}>
          <circleGeometry args={[14, 64]} />
          <meshStandardMaterial color={COLORS.ground} />
        </mesh>
        <ContactShadows position={[0, 0, 0]} opacity={0.35} scale={dc ? 26 : 20} blur={2.4} far={6} />
        <OrbitControls
          target={dc ? [1, 2.2, -0.8] : [0, 2.6, 0]}
          autoRotate={hovered === null}
          autoRotateSpeed={0.35}
          enableDamping
          dampingFactor={0.08}
          enablePan={false}
          minPolarAngle={Math.PI * 0.18}
          maxPolarAngle={Math.PI * 0.46}
          minDistance={8}
          maxDistance={26}
        />
      </Canvas>
      <div className="pointer-events-none absolute inset-0">
        <svg className="absolute inset-0 h-full w-full">
          {placed.map(({ sensor }) => (
            // white halo under a navy line so it reads on the dark roof too
            <g key={sensor.id} ref={register(sensor.id, 'line')} style={{ opacity: 0 }}>
              <line stroke="#ffffff" strokeOpacity={0.85} strokeWidth={3.5} strokeLinecap="round" />
              <line stroke="#01273e" strokeWidth={1.25} strokeLinecap="round" />
            </g>
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
