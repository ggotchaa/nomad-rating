// Target shapes for the particle swarm. Every particle has one position per shape; the shader
// morphs between them by scroll. 0 = paddle (in paddle-local space), 1 = galaxy of players,
// 2 = rating chart, 3 = hall plan with six tables (tilted floor).

export type Rand = () => number

export function mulberry(seed: number): Rand {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// --- Paddle geometry (shared with the mesh in HoloScene) ---------------------------------
export const BLADE = { cx: 0, cy: 0.55, rx: 0.95, ry: 0.9, thickness: 0.07 }
export const HANDLE = { top: -0.25, bottom: -1.38, halfWidth: 0.17, flare: 0.21, thickness: 0.22 }

/** Points on the paddle surface: both rubber faces, the blade rim and the handle. */
export function paddlePoints(count: number, rand: Rand): Float32Array {
  const out = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    const r = rand()
    let x: number
    let y: number
    let z: number
    if (r < 0.74) {
      // Rubber face: uniform in the ellipse, denser towards the rim for a readable silhouette.
      const a = rand() * Math.PI * 2
      const d = Math.pow(rand(), 0.35)
      x = BLADE.cx + Math.cos(a) * BLADE.rx * d
      y = BLADE.cy + Math.sin(a) * BLADE.ry * d
      z = (rand() < 0.5 ? 1 : -1) * (BLADE.thickness / 2 + 0.004)
    } else if (r < 0.88) {
      const a = rand() * Math.PI * 2
      x = BLADE.cx + Math.cos(a) * BLADE.rx
      y = BLADE.cy + Math.sin(a) * BLADE.ry
      z = (rand() - 0.5) * BLADE.thickness
    } else {
      const t = rand()
      y = HANDLE.top + (HANDLE.bottom - HANDLE.top) * t
      const w = HANDLE.halfWidth + (HANDLE.flare - HANDLE.halfWidth) * Math.pow(t, 3)
      const side = rand()
      if (side < 0.5) {
        x = (rand() * 2 - 1) * w
        z = (rand() < 0.5 ? 1 : -1) * HANDLE.thickness / 2
      } else {
        x = (rand() < 0.5 ? 1 : -1) * w
        z = (rand() * 2 - 1) * HANDLE.thickness / 2
      }
    }
    out.set([x, y, z], i * 3)
  }
  return out
}

/** Spiral galaxy: «тысячи игроков» — disc with four arms and a bright core. */
export function galaxyPoints(count: number, rand: Rand): Float32Array {
  const out = new Float32Array(count * 3)
  const arms = 4
  for (let i = 0; i < count; i++) {
    const radius = Math.pow(rand(), 0.7) * 3.1
    const arm = Math.floor(rand() * arms)
    const spin = radius * 1.35
    const angle = (arm / arms) * Math.PI * 2 + spin
    const spread = Math.pow(rand(), 2.2) * (0.15 + radius * 0.22) * (rand() < 0.5 ? 1 : -1)
    const x = Math.cos(angle) * radius + spread
    const z = Math.sin(angle) * radius + (rand() - 0.5) * 0.3
    const y = (rand() - 0.5) * 0.18 * (1.4 - radius / 3.1)
    // Tilt the disc towards the camera.
    const tilt = 1.05
    out.set([x, y * Math.cos(tilt) - z * Math.sin(tilt), y * Math.sin(tilt) + z * Math.cos(tilt)], i * 3)
  }
  return out
}

// --- Rating chart ------------------------------------------------------------------------
const CHART = { x0: -2.9, x1: 2.9, y0: -1.25, y1: 1.35 }

/** Rating curve: grows with a few dips (calibration, then Elo). t ∈ [0, 1]. */
export function chartCurve(t: number): [number, number, number] {
  const x = CHART.x0 + (CHART.x1 - CHART.x0) * t
  const trend = Math.pow(t, 1.3) * 2.1
  const wobble = Math.sin(t * 13) * 0.16 + Math.sin(t * 29 + 1) * 0.06 - (t > 0.55 && t < 0.68 ? Math.sin(((t - 0.55) / 0.13) * Math.PI) * 0.35 : 0)
  return [x, CHART.y0 + 0.2 + trend + wobble, 0]
}

export function chartPoints(count: number, rand: Rand): Float32Array {
  const out = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    const r = rand()
    let p: [number, number, number]
    if (r < 0.55) {
      const [x, y] = chartCurve(rand())
      const a = rand() * Math.PI * 2
      const d = rand() * 0.035
      p = [x + Math.cos(a) * d, y + Math.sin(a) * d, (rand() - 0.5) * 0.08]
    } else if (r < 0.8) {
      // Area under the curve, fading downwards.
      const t = rand()
      const [x, y] = chartCurve(t)
      const k = Math.pow(rand(), 0.6)
      p = [x, y - (y - CHART.y0) * k, (rand() - 0.5) * 0.25 * k]
    } else if (r < 0.92) {
      // Horizontal grid lines.
      const line = Math.floor(rand() * 5)
      p = [CHART.x0 + (CHART.x1 - CHART.x0) * rand(), CHART.y0 + ((CHART.y1 - CHART.y0) * line) / 4, -0.15]
    } else {
      // Tournament markers: vertical ticks along the curve.
      const k = Math.floor(rand() * 12) / 11
      const [x, y] = chartCurve(k)
      p = [x, CHART.y0 + (y - CHART.y0) * rand(), -0.05]
    }
    out.set(p, i * 3)
  }
  return out
}

// --- Hall plan ---------------------------------------------------------------------------
const HALL_TILT = 1.02 // rotation around X: a floor seen from above at an angle
const TABLE = { w: 1.37, h: 0.76 } // 2.74 × 1.525 m at 0.5 scale
export const HALL_TABLES: [number, number][] = [
  [-1.9, -0.95],
  [0, -0.95],
  [1.9, -0.95],
  [-1.9, 0.95],
  [0, 0.95],
  [1.9, 0.95],
]

function tiltFloor(x: number, y: number, z: number): [number, number, number] {
  // Floor is the XZ plane (y = up); rotate around X so it faces the camera at an angle.
  const cy = Math.cos(HALL_TILT)
  const sy = Math.sin(HALL_TILT)
  return [x, y * cy - z * sy - 0.15, y * sy + z * cy]
}

/** World position of a table centre (index 0…5), slightly above the floor. */
export function hallTableCenter(index: number): [number, number, number] {
  const [x, z] = HALL_TABLES[index] ?? [0, 0]
  return tiltFloor(x, 0.02, z)
}

/** Points of the hall; `groups[i]` = table number 1…6 for table particles, 0 for the floor. */
export function hallPoints(count: number, rand: Rand): { positions: Float32Array; groups: Float32Array } {
  const positions = new Float32Array(count * 3)
  const groups = new Float32Array(count)
  for (let i = 0; i < count; i++) {
    const r = rand()
    let p: [number, number, number]
    let group = 0
    if (r < 0.62) {
      const index = Math.floor(rand() * HALL_TABLES.length)
      const [cx, cz] = HALL_TABLES[index]!
      group = index + 1
      const kind = rand()
      let x: number
      let z: number
      if (kind < 0.55) {
        // Table outline.
        const t = rand() * 2 * (TABLE.w + TABLE.h)
        if (t < TABLE.w) [x, z] = [t - TABLE.w / 2, -TABLE.h / 2]
        else if (t < TABLE.w + TABLE.h) [x, z] = [TABLE.w / 2, t - TABLE.w - TABLE.h / 2]
        else if (t < 2 * TABLE.w + TABLE.h) [x, z] = [TABLE.w / 2 - (t - TABLE.w - TABLE.h), TABLE.h / 2]
        else [x, z] = [-TABLE.w / 2, TABLE.h / 2 - (t - 2 * TABLE.w - TABLE.h)]
      } else if (kind < 0.72) {
        // Net and centre line.
        if (rand() < 0.6) [x, z] = [0, (rand() - 0.5) * TABLE.h * 1.15]
        else [x, z] = [(rand() - 0.5) * TABLE.w, 0]
      } else {
        x = (rand() - 0.5) * TABLE.w
        z = (rand() - 0.5) * TABLE.h
      }
      p = tiltFloor(cx + x, kind >= 0.55 && kind < 0.72 && Math.abs(x) < 0.01 ? rand() * 0.12 : 0, cz + z)
    } else if (r < 0.8) {
      // Hall border and court separators.
      const t = rand()
      const side = Math.floor(rand() * 4)
      const W = 3.1
      const H = 1.95
      const [x, z] = side === 0 ? [-W + 2 * W * t, -H] : side === 1 ? [-W + 2 * W * t, H] : side === 2 ? [-W, -H + 2 * H * t] : [W, -H + 2 * H * t]
      p = tiltFloor(x, 0, z)
    } else {
      // Floor grid dust.
      p = tiltFloor((rand() - 0.5) * 6.2, 0, (rand() - 0.5) * 3.9)
    }
    positions.set(p, i * 3)
    groups[i] = group
  }
  return { positions, groups }
}
