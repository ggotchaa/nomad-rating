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

export type SeasonRow = { id: string; total: number; tours: number; counted: number[]; dropped: number[] }

/** Season table: sum of the best N tours (all when bestN is null); ties by tours played, then best single tour. */
export function seasonStandings(results: readonly { id: string; points: number }[], bestN: number | null = null): SeasonRow[] {
  const byId = new Map<string, number[]>()
  for (const r of results) byId.set(r.id, [...(byId.get(r.id) ?? []), r.points])
  const rows = [...byId].map(([id, pts]) => {
    const sorted = [...pts].sort((a, b) => b - a)
    const n = bestN ?? sorted.length
    const counted = sorted.slice(0, n)
    return { id, total: counted.reduce((a, b) => a + b, 0), tours: pts.length, counted, dropped: sorted.slice(n) }
  })
  return rows.sort((a, b) => b.total - a.total || b.tours - a.tours || (b.counted[0] ?? 0) - (a.counted[0] ?? 0) || a.id.localeCompare(b.id))
}

/** Play-offs (L-11): the top `count` of the season table, seeded in table order. */
export const playoffSeeds = (table: readonly SeasonRow[], count: number): string[] => table.slice(0, count).map((r) => r.id)
