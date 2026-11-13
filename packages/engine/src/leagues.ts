// Leagues (spec 4.12, L-1…L-15): distribution into divisions, promotion/relegation after a tour,
// merging of small divisions, tour points and the season table with N best tours.

export type Rated = { id: string; rating: number }

/** Division sizes for n players, top divisions take the remainder. */
export function divisionSizes(n: number, divisions: number): number[] {
  const base = Math.floor(n / divisions)
  return Array.from({ length: divisions }, (_, i) => base + (i < n % divisions ? 1 : 0))
}

/** By rating: strongest go to the top division (index 0). */
export function distributeByRating(players: readonly Rated[], sizes: readonly number[]): string[][] {
  const sorted = [...players].sort((a, b) => b.rating - a.rating || a.id.localeCompare(b.id))
  let from = 0
  return sizes.map((size) => {
    const chunk = sorted.slice(from, from + size).map((p) => p.id)
    from += size
    return chunk
  })
}

export type Boundary = { promote: number; relegate: number }
export type MissedRule = 'relegate' | 'last' | 'stay'
export type Move = { id: string; from: number; to: number; reason: 'promotion' | 'relegation' | 'missed' }

/**
 * Divisions top → bottom with the tour order of each (best first). `boundaries[i]` is between division i
 * and i + 1: its bottom `relegate` go down, the top `promote` of i + 1 go up. Missed players:
 * 'last' — ranked below everyone who played; 'relegate' — go down regardless of place; 'stay' — never move.
 * Frozen players keep their division and do not take a moving place.
 */
export function applyMovements(
  divisions: readonly (readonly string[])[],
  boundaries: readonly Boundary[],
  options: { missed?: ReadonlySet<string>; missedRule?: MissedRule; frozen?: ReadonlySet<string> } = {},
): { divisions: string[][]; moves: Move[] } {
  const missed = options.missed ?? new Set<string>()
  const frozen = options.frozen ?? new Set<string>()
  const rule = options.missedRule ?? 'last'
  const order = divisions.map((d) => {
    const active = d.filter((id) => !frozen.has(id))
    return rule === 'stay' ? active : [...active.filter((id) => !missed.has(id)), ...active.filter((id) => missed.has(id))]
  })
  const target = new Map<string, number>()
  const moves: Move[] = []
  const move = (id: string, from: number, to: number, reason: Move['reason']) => {
    if (target.has(id)) return
    target.set(id, to)
    moves.push({ id, from, to, reason })
  }
  for (let i = 0; i < divisions.length - 1; i++) {
    const b = boundaries[i] ?? { promote: 0, relegate: 0 }
    const upper = order[i]!.filter((id) => rule === 'last' || !missed.has(id))
    const lower = order[i + 1]!.filter((id) => !missed.has(id) || rule === 'last')
    for (const id of upper.slice(Math.max(0, upper.length - b.relegate))) move(id, i, i + 1, missed.has(id) ? 'missed' : 'relegation')
    for (const id of lower.slice(0, b.promote)) move(id, i + 1, i, 'promotion')
    if (rule === 'relegate') for (const id of order[i]!) if (missed.has(id)) move(id, i, i + 1, 'missed')
  }
  const result = divisions.map(() => [] as string[])
  divisions.forEach((d, i) => d.forEach((id) => result[target.get(id) ?? i]!.push(id)))
  return { divisions: result, moves }
}

/** Merges every division smaller than `minSize` into its neighbour above (the top one into the one below). */
export function mergeSmallDivisions(sizes: readonly number[], minSize: number): { from: number; to: number }[] {
  const live = sizes.map((size, index) => ({ index, size }))
  const plan: { from: number; to: number }[] = []
  while (live.length > 1) {
    const i = live.findIndex((d) => d.size < minSize)
    if (i < 0) break
    const into = i === 0 ? 1 : i - 1
    live[into]!.size += live[i]!.size
    plan.push({ from: live[i]!.index, to: live[into]!.index })
    live.splice(i, 1)
  }
  return plan
}

/** Tour points by place; places beyond the table get `participation`. */
export const tourPoints = (place: number, table: readonly number[], participation = 0): number => table[place - 1] ?? participation

/** L-14: places numbered through all divisions (top division 1…n, next one continues). Each division is in tour order. */
export function overallPlaces(divisions: readonly (readonly string[])[]): Map<string, number> {
  const out = new Map<string, number>()
  let place = 0
  for (const d of divisions) for (const id of d) out.set(id, ++place)
  return out
}

/** Default tour points: 1st overall gets as many points as players in the tour, each next place one less. */
export const defaultTourPoints = (overall: number, players: number): number => Math.max(players - overall + 1, 0)

export type SeasonRow = { id: string; total: number; tours: number; counted: number[]; dropped: number[]; bestPlace: number | null; firsts: number; lastTour: number }
export type TourResult = { id: string; points: number; place?: number | null; tour?: number }

/**
 * Season table: sum of the best N tours (all when bestN is null). Ties (4.12): best place in a tour,
 * number of first places, result of the last tour, then tours played.
 */
export function seasonStandings(results: readonly TourResult[], bestN: number | null = null): SeasonRow[] {
  const byId = new Map<string, TourResult[]>()
  for (const r of results) byId.set(r.id, [...(byId.get(r.id) ?? []), r])
  const last = Math.max(0, ...results.map((r) => r.tour ?? 0))
  const rows = [...byId].map(([id, rs]) => {
    const sorted = rs.map((r) => r.points).sort((a, b) => b - a)
    const n = bestN ?? sorted.length
    const counted = sorted.slice(0, n)
    const places = rs.map((r) => r.place).filter((p): p is number => p != null)
    return {
      id,
      total: counted.reduce((a, b) => a + b, 0),
      tours: rs.length,
      counted,
      dropped: sorted.slice(n),
      bestPlace: places.length ? Math.min(...places) : null,
      firsts: places.filter((p) => p === 1).length,
      lastTour: last ? (rs.find((r) => r.tour === last)?.points ?? 0) : 0,
    }
  })
  return rows.sort(
    (a, b) =>
      b.total - a.total ||
      (a.bestPlace ?? 1e9) - (b.bestPlace ?? 1e9) ||
      b.firsts - a.firsts ||
      b.lastTour - a.lastTour ||
      b.tours - a.tours ||
      (b.counted[0] ?? 0) - (a.counted[0] ?? 0) ||
      a.id.localeCompare(b.id),
  )
}

export type PlayoffPair = { boundary: number; upper: string; lower: string }

/** L-4 стыковые матчи: the place just above the relegation zone vs the place just below the promotion zone. */
export function playoffPairs(divisions: readonly (readonly string[])[], boundaries: readonly Boundary[]): PlayoffPair[] {
  const out: PlayoffPair[] = []
  for (let i = 0; i < divisions.length - 1; i++) {
    const b = boundaries[i] ?? { promote: 0, relegate: 0 }
    const upper = divisions[i]![divisions[i]!.length - b.relegate - 1]
    const lower = divisions[i + 1]![b.promote]
    if (upper && lower && b.relegate < divisions[i]!.length) out.push({ boundary: i, upper, lower })
  }
  return out
}

/** Swaps the pair across the boundary when the lower-division player won the play-off match. */
export function applyPlayoffs(divisions: readonly (readonly string[])[], results: readonly (PlayoffPair & { lowerWon: boolean })[]): { divisions: string[][]; moves: Move[] } {
  const out = divisions.map((d) => [...d])
  const moves: Move[] = []
  for (const r of results) {
    if (!r.lowerWon) continue
    const up = out[r.boundary]!
    const down = out[r.boundary + 1]!
    if (!up.includes(r.upper) || !down.includes(r.lower)) continue
    up.splice(up.indexOf(r.upper), 1, r.lower)
    down.splice(down.indexOf(r.lower), 1, r.upper)
    moves.push({ id: r.lower, from: r.boundary + 1, to: r.boundary, reason: 'promotion' }, { id: r.upper, from: r.boundary, to: r.boundary + 1, reason: 'relegation' })
  }
  return { divisions: out, moves }
}

/** Mid-season newcomer «by rating»: the highest division whose weakest player is not stronger than him; else the bottom one. */
export function divisionByRating(divisionRatings: readonly (readonly number[])[], rating: number): number {
  for (const [i, rs] of divisionRatings.entries()) if (rs.length && rating >= Math.min(...rs)) return i
  return divisionRatings.length - 1
}

/** Play-offs (L-11): the top `count` of the season table, seeded in table order. */
export const playoffSeeds = (table: readonly { id: string }[], count: number): string[] => table.slice(0, count).map((r) => r.id)
