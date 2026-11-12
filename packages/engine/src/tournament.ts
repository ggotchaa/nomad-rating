// Building stages and moving players between them (spec 4.4 M-1, M-2; 4.6 transitions and final places).
// Pure functions: the server stores the result in stages / groups / matches tables.

import { allPlaces, bracketSizeFor, seedOrder, singleElimination } from './bracket.ts'
import type { Bracket, BracketPlace } from './bracket.ts'
import { groupCode, groupSizes, randomGroups, roundRobinTours, separateClubs, snakeGroups } from './groups.ts'
import type { StandingRow, StandingsResult } from './groups.ts'
import type { StageSpec, TournamentFormat, TransitionRule } from './formats.ts'

export type Participant = { id: string; rating: number; clubId?: string | null }

export type PlannedGroup = { code: string; members: string[] }
export type PlannedGroupMatch = { groupCode: string; tour: number; home: string; away: string }

/** Groups and their round-robin matches; `seeded` is sorted strongest first. */
export function buildGroupStage(
  stage: Extract<StageSpec, { kind: 'groups' | 'round_robin' }>,
  seeded: readonly Participant[],
  options: { seed?: number } = {},
): { groups: PlannedGroup[]; matches: PlannedGroupMatch[] } {
  const ids = seeded.map((p) => p.id)
  let members: string[][]
  if (stage.kind === 'round_robin') members = [ids]
  else {
    const sizes = groupSizes(ids.length, stage.groupSize)
    members = stage.seeding === 'random' ? randomGroups(ids, sizes, options.seed ?? 1) : snakeGroups(ids, sizes)
    if (stage.separateClubs !== false) {
      const clubs = new Map(seeded.map((p) => [p.id, p.clubId]))
      members = separateClubs(members, (id) => clubs.get(id))
    }
  }
  const groups = members.map((m, i) => ({ code: stage.kind === 'round_robin' ? 'A' : groupCode(i), members: m }))
  const matches: PlannedGroupMatch[] = []
  for (const group of groups) {
    roundRobinTours(group.members.length).forEach((tour, t) => {
      for (const [a, b] of tour) {
        matches.push({ groupCode: group.code, tour: t + 1, home: group.members[a] as string, away: group.members[b] as string })
      }
    })
  }
  return { groups, matches }
}

export function buildBracket(stage: Extract<StageSpec, { kind: 'single_elim' | 'all_places' }>, players: number): Bracket {
  const size = bracketSizeFor(Math.max(players, 2))
  return stage.kind === 'all_places' ? allPlaces(size) : singleElimination(size, stage.thirdPlace)
}

// ---------------------------------------------------------------------------
// Qualifiers

export type GroupOutcome = { code: string; standings: StandingsResult }

type Finisher = { id: string; group: string; row: StandingRow; rating: number }

const setsRatio = (r: StandingRow) => (r.setsLost === 0 ? (r.setsWon === 0 ? 0 : Infinity) : r.setsWon / r.setsLost)

/** Comparison between players of different groups: place, then points, games ratio, rating. */
function compareFinishers(a: Finisher, b: Finisher): number {
  return a.row.place - b.row.place || b.row.points - a.row.points || setsRatio(b.row) - setsRatio(a.row) || b.rating - a.rating
}

function finishers(outcomes: readonly GroupOutcome[], ratings: Record<string, number>): Finisher[] {
  return outcomes
    .flatMap((g) => g.standings.rows.map((row) => ({ id: row.id, group: g.code, row, rating: ratings[row.id] ?? 0 })))
    .sort(compareFinishers)
}

export type Qualifier = { id: string; group: string; groupPlace: number }

/** Players a transition rule takes from a group stage, in seeding order (by place, then by the rule above). */
export function selectQualifiers(
  rule: TransitionRule,
  outcomes: readonly GroupOutcome[],
  ratings: Record<string, number>,
): Qualifier[] {
  const all = finishers(outcomes, ratings)
  let chosen: Finisher[]
  switch (rule.by) {
    case 'all':
      chosen = all
      break
    case 'top':
      chosen = all.slice(0, rule.count)
      break
    case 'places':
      chosen = all.filter((f) => rule.places.includes(f.row.place))
      break
    case 'best_of_place':
      chosen = all.filter((f) => f.row.place === rule.place).slice(0, rule.count)
      break
  }
  return chosen.map((f) => ({ id: f.id, group: f.group, groupPlace: f.row.place }))
}

/**
 * Seeds for a bracket from qualifiers already in seeding order. Players from one group
 * are moved to different halves where possible (1st and 2nd of a group meet only in the final).
 * Returns seeds[i] = entry id with seed i + 1, null for empty slots.
 */
export function seedsFromQualifiers(qualifiers: readonly Qualifier[]): (string | null)[] {
  const size = bracketSizeFor(Math.max(qualifiers.length, 2))
  const list: (Qualifier | null)[] = [...qualifiers, ...Array<null>(size - qualifiers.length).fill(null)]
  const order = seedOrder(size)
  const half = (seedIndex: number) => (order.indexOf(seedIndex + 1) < size / 2 ? 0 : 1)
  for (let i = 0; i < list.length; i++) {
    const q = list[i]
    if (!q) continue
    const clash = list.some((other, j) => j < i && other && other.group === q.group && half(j) === half(i))
    if (!clash) continue
    // Swap with a later-or-equal tier player of the same group place in the other half.
    for (let j = 0; j < list.length; j++) {
      const other = list[j]
      if (j === i || !other || other.groupPlace !== q.groupPlace || half(j) === half(i)) continue
      const otherOk = !list.some((x, k) => k !== j && k !== i && x && x.group === other.group && half(k) === half(i))
      const selfOk = !list.some((x, k) => k !== i && k !== j && x && x.group === q.group && half(k) === half(j))
      if (otherOk && selfOk) {
        list[i] = other
        list[j] = q
        break
      }
    }
  }
  return list.map((q) => q?.id ?? null)
}

// ---------------------------------------------------------------------------
// Final places (spec 4.6 «не прошедшие дальше получают итоговые места…»)

export type StageOutcome =
  | { stage: string; kind: 'groups'; groups: GroupOutcome[] }
  | { stage: string; kind: 'bracket'; places: BracketPlace[] }

export type FinalPlace = { id: string; place: number; placeTo: number; stage: string }

export function finalPlaces(
  format: TournamentFormat,
  outcomes: readonly StageOutcome[],
  advanced: ReadonlySet<string>,
  ratings: Record<string, number>,
): FinalPlace[] {
  const result: FinalPlace[] = []
  const placed = new Set<string>()
  let offset = 0
  for (const block of format.placement) {
    const outcome = outcomes.find((o) => o.stage === block.stage)
    if (!outcome) continue
    if (outcome.kind === 'bracket') {
      const places = outcome.places.filter((p) => !placed.has(p.id))
      for (const p of places) {
        result.push({ id: p.id, place: offset + p.place, placeTo: offset + p.placeTo, stage: block.stage })
        placed.add(p.id)
      }
      offset += places.length
    } else {
      const list = finishers(outcome.groups, ratings).filter(
        (f) => !placed.has(f.id) && (block.who === 'all' || !advanced.has(f.id)),
      )
      list.forEach((f, i) => {
        result.push({ id: f.id, place: offset + i + 1, placeTo: offset + i + 1, stage: block.stage })
        placed.add(f.id)
      })
      offset += list.length
    }
  }
  return result
}

