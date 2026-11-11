// Group stage: sizes, snake seeding, round-robin order and standings with tie-breaks (spec 4.6).

import { hashString, seededRandom, shuffle } from './random.ts'
import type { GameScore, Side } from './scoring.ts'

export const MIN_GROUP_SIZE = 3
export const MAX_GROUP_SIZE = 8

/**
 * Splits `players` into groups of about `size` players. When the count does not divide,
 * some groups get one player less (30 by 4 → 6 × 4 + 2 × 3). Larger groups come first.
 */
export function groupSizes(players: number, size: number): number[] {
  if (players < MIN_GROUP_SIZE) throw new Error('groups.too_few_players')
  const target = Math.min(Math.max(size, MIN_GROUP_SIZE), MAX_GROUP_SIZE)
  let count = Math.ceil(players / target)
  while (count > 1 && Math.floor(players / count) < MIN_GROUP_SIZE) count--
  const base = Math.floor(players / count)
  const extra = players % count
  return Array.from({ length: count }, (_, i) => (i < extra ? base + 1 : base))
}

export const groupCode = (index: number): string =>
  index < 26 ? String.fromCharCode(65 + index) : `${String.fromCharCode(65 + Math.floor(index / 26) - 1)}${String.fromCharCode(65 + (index % 26))}`

/**
 * Snake seeding: players sorted by seed go 1→N, then N→1, … across groups,
 * skipping groups that are already full.
 */
export function snakeGroups<T>(seeded: readonly T[], sizes: readonly number[]): T[][] {
  const groups: T[][] = sizes.map(() => [])
  let row = 0
  let i = 0
  while (i < seeded.length) {
    const order = sizes.map((_, g) => g)
    if (row % 2 === 1) order.reverse()
    for (const g of order) {
      if (i >= seeded.length) break
      const group = groups[g] as T[]
      if (group.length < (sizes[g] as number)) group.push(seeded[i++] as T)
    }
    row++
  }
  return groups
}

export function randomGroups<T>(items: readonly T[], sizes: readonly number[], seed: number): T[][] {
  const list = shuffle(items, seededRandom(seed))
  const groups: T[][] = []
  let offset = 0
  for (const size of sizes) {
    groups.push(list.slice(offset, offset + size))
    offset += size
  }
  return groups
}

/**
 * Round-robin order by the circle method: returns tours, each a list of index pairs.
 * With an odd count one player rests every tour.
 */
export function roundRobinTours(count: number): [number, number][][] {
  const ids: (number | null)[] = Array.from({ length: count }, (_, i) => i)
  if (count % 2 === 1) ids.push(null)
  const n = ids.length
  const tours: [number, number][][] = []
  for (let r = 0; r < n - 1; r++) {
    const tour: [number, number][] = []
    for (let i = 0; i < n / 2; i++) {
      const a = ids[i]
      const b = ids[n - 1 - i]
      if (a != null && b != null) tour.push(r % 2 === 0 ? [a, b] : [b, a])
    }
    tours.push(tour)
    ids.splice(1, 0, ids.pop() as number | null)
  }
  return tours
}

export const groupMatchCount = (size: number): number => (size * (size - 1)) / 2

// ---------------------------------------------------------------------------
// Standings

export type GroupPoints = { win: number; loss: number; walkover: number }
export const DEFAULT_GROUP_POINTS: GroupPoints = { win: 2, loss: 1, walkover: 0 }

export type TieBreakCriterion =
  | 'h2h_points' // points only in matches between the tied players
  | 'h2h_sets_ratio' // games won / lost in those matches
  | 'h2h_points_ratio' // rally points won / lost in those matches
  | 'rating' // rating before the tournament
  | 'lots' // lots or organiser decision

export const DEFAULT_TIEBREAKS: TieBreakCriterion[] = ['h2h_points', 'h2h_sets_ratio', 'h2h_points_ratio', 'rating', 'lots']

export type GroupMatchResult = {
  home: string
  away: string
  winner: Side
  setsHome: number
  setsAway: number
  games: GameScore[]
  /** walkover: the loser did not show up (0 points); retired: counts as a played loss. */
  type: 'normal' | 'walkover' | 'retired'
}

export type StandingRow = {
  id: string
  played: number
  wins: number
  losses: number
  points: number
  setsWon: number
  setsLost: number
  pointsWon: number
  pointsLost: number
  place: number
  /** Which rule separated this player from the ones with equal match points. */
  decidedBy: 'points' | TieBreakCriterion | null
  /** Players this one was tied with on match points (for the «how was it decided» popup). */
  tiedWith: string[]
}

export type StandingsOptions = {
  points?: GroupPoints
  tiebreaks?: TieBreakCriterion[]
  ratings?: Record<string, number>
  /** Organiser decision: explicit order of tied players (overrides lots). */
  manualOrder?: string[]
  lotsSeed?: number
}

export type StandingsResult = {
  rows: StandingRow[]
  /** True when some tie was decided by lots without an organiser decision. */
  needsDecision: boolean
  /** True when a points-ratio tie-break was skipped because game points are missing. */
  missingGamePoints: boolean
}

type Tally = { points: number; setsWon: number; setsLost: number; pointsWon: number; pointsLost: number; complete: boolean }

function tally(ids: readonly string[], matches: readonly GroupMatchResult[], pts: GroupPoints): Map<string, Tally> {
  const set = new Set(ids)
  const result = new Map<string, Tally>(
    ids.map((id) => [id, { points: 0, setsWon: 0, setsLost: 0, pointsWon: 0, pointsLost: 0, complete: true }]),
  )
  for (const m of matches) {
    if (!set.has(m.home) || !set.has(m.away)) continue
    const home = result.get(m.home) as Tally
    const away = result.get(m.away) as Tally
    const [w, l] = m.winner === 'home' ? [home, away] : [away, home]
    w.points += pts.win
    l.points += m.type === 'walkover' ? pts.walkover : pts.loss
    home.setsWon += m.setsHome
    home.setsLost += m.setsAway
    away.setsWon += m.setsAway
    away.setsLost += m.setsHome
    if (m.type === 'walkover') continue
    if (m.games.length === 0) {
      home.complete = false
      away.complete = false
    }
    for (const g of m.games) {
      home.pointsWon += g.home
      home.pointsLost += g.away
      away.pointsWon += g.away
      away.pointsLost += g.home
    }
  }
  return result
}

const ratio = (won: number, lost: number): number => (lost === 0 ? (won === 0 ? 0 : Infinity) : won / lost)

export function groupStandings(
  ids: readonly string[],
  matches: readonly GroupMatchResult[],
  options: StandingsOptions = {},
): StandingsResult {
  const pts = options.points ?? DEFAULT_GROUP_POINTS
  const criteria = options.tiebreaks ?? DEFAULT_TIEBREAKS
  const ratings = options.ratings ?? {}
  const overall = tally(ids, matches, pts)
  const decidedBy = new Map<string, StandingRow['decidedBy']>()
  const tiedWith = new Map<string, string[]>()
  let needsDecision = false
  let missingGamePoints = false

  const partition = (set: string[], value: (id: string) => number): string[][] => {
    const sorted = [...set].sort((a, b) => value(b) - value(a))
    const parts: string[][] = []
    for (const id of sorted) {
      const last = parts[parts.length - 1]
      if (last && value(last[0] as string) === value(id)) last.push(id)
      else parts.push([id])
    }
    return parts
  }

  // Orders a set of players tied on everything before `from`; a split restarts
  // the head-to-head criteria on each smaller tied subset (mini-table).
  const order = (set: string[], from: number): string[] => {
    if (set.length === 1) return set
    for (let i = from; i < criteria.length; i++) {
      const criterion = criteria[i] as TieBreakCriterion
      let parts: string[][]
      if (criterion === 'lots') {
        parts = lots(set)
      } else if (criterion === 'rating') {
        parts = partition(set, (id) => ratings[id] ?? 0)
      } else {
        const mini = tally(set, matches, pts)
        if (criterion === 'h2h_points') parts = partition(set, (id) => mini.get(id)!.points)
        else if (criterion === 'h2h_sets_ratio') parts = partition(set, (id) => ratio(mini.get(id)!.setsWon, mini.get(id)!.setsLost))
        else {
          if (set.some((id) => !mini.get(id)!.complete)) {
            missingGamePoints = true
            continue
          }
          parts = partition(set, (id) => ratio(mini.get(id)!.pointsWon, mini.get(id)!.pointsLost))
        }
      }
      if (parts.length === 1) continue
      for (const part of parts) if (part.length === 1) decidedBy.set(part[0] as string, criterion)
      return parts.flatMap((part) => (part.length === 1 ? part : order(part, part.length < set.length ? 0 : i + 1)))
    }
    return set
  }

  const lots = (set: string[]): string[][] => {
    const manual = options.manualOrder?.filter((id) => set.includes(id)) ?? []
    if (manual.length === set.length) return manual.map((id) => [id])
    needsDecision = true
    const seed = options.lotsSeed ?? hashString([...set].sort().join('|'))
    return shuffle([...set].sort(), seededRandom(seed)).map((id) => [id])
  }

  const byPoints = partition([...ids], (id) => overall.get(id)!.points)
  const ordered: string[] = []
  for (const part of byPoints) {
    if (part.length === 1) {
      decidedBy.set(part[0] as string, byPoints.length > 1 ? 'points' : null)
      ordered.push(part[0] as string)
    } else {
      for (const id of part) tiedWith.set(id, part.filter((other) => other !== id))
      ordered.push(...order(part, 0))
    }
  }

  const stats = new Map(ids.map((id) => [id, { played: 0, wins: 0, losses: 0 }]))
  for (const m of matches) {
    const h = stats.get(m.home)
    const a = stats.get(m.away)
    if (!h || !a) continue
    h.played++
    a.played++
    if (m.winner === 'home') {
      h.wins++
      a.losses++
    } else {
      a.wins++
      h.losses++
    }
  }

  const rows = ordered.map((id, index): StandingRow => {
    const t = overall.get(id)!
    const s = stats.get(id)!
    return {
      id,
      ...s,
      points: t.points,
      setsWon: t.setsWon,
      setsLost: t.setsLost,
      pointsWon: t.pointsWon,
      pointsLost: t.pointsLost,
      place: index + 1,
      decidedBy: decidedBy.get(id) ?? null,
      tiedWith: tiedWith.get(id) ?? [],
    }
  })
  return { rows, needsDecision, missingGamePoints }
}
