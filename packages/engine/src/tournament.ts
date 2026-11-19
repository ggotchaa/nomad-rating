// Building stages and moving players between them (spec 4.4 M-1, M-2; 4.6 transitions and final places).
// Pure functions: the server stores the result in stages / groups / matches tables.

import { bracketSizeFor, long32, placesBracket, recommendBracketSize, seedOrder, singleElimination } from './bracket.ts'
import type { Bracket, BracketPlace } from './bracket.ts'
import { clubClashes, evenGroups, groupCode, groupSizes, randomGroups, roundRobinTours, separateClubs, sequentialGroups, snakeGroups } from './groups.ts'
import type { StandingRow, StandingsResult } from './groups.ts'
import type { BracketStageSpec, StageSpec, TournamentFormat, TransitionRule } from './formats.ts'

export type Participant = { id: string; rating: number; clubId?: string | null }

export type PlannedGroup = { code: string; members: string[] }
export type PlannedGroupMatch = { groupCode: string; tour: number; home: string; away: string }

/** Something the organiser should look at; `code` is an i18n key, `params` fill it. */
export type StageWarning = { code: string; params?: Record<string, string | number> }

/** Groups of a group stage, `seeded` sorted strongest first. */
export function planGroups(
  stage: Extract<StageSpec, { kind: 'groups' | 'round_robin' }>,
  seeded: readonly Participant[],
  options: { seed?: number } = {},
): { groups: PlannedGroup[]; warnings: StageWarning[] } {
  const ids = seeded.map((p) => p.id)
  if (stage.kind === 'round_robin') return { groups: [{ code: 'A', members: ids }], warnings: [] }
  const sizes = groupSizes(ids.length, stage.groupSize)
  const rating = new Map(seeded.map((p) => [p.id, p.rating]))
  let members: string[][]
  if (stage.seeding === 'random') members = randomGroups(ids, sizes, options.seed ?? 1)
  else if (stage.seeding === 'rating') members = sequentialGroups(ids, sizes)
  else if (stage.seeding === 'even') members = evenGroups(ids, sizes, (id) => rating.get(id) ?? 0)
  else members = snakeGroups(ids, sizes)
  const warnings: StageWarning[] = []
  if (stage.separateClubs !== false) {
    const clubs = new Map(seeded.map((p) => [p.id, p.clubId]))
    members = separateClubs(members, (id) => clubs.get(id))
    for (const c of clubClashes(members, (id) => clubs.get(id))) warnings.push({ code: 'clubs_together', params: { group: groupCode(c.group), count: c.ids.length, club: c.club } })
  }
  return { groups: members.map((m, i) => ({ code: groupCode(i), members: m })), warnings }
}

/** Round-robin matches of planned groups, tour by tour. */
export function groupMatches(groups: readonly PlannedGroup[]): PlannedGroupMatch[] {
  const matches: PlannedGroupMatch[] = []
  for (const group of groups) {
    roundRobinTours(group.members.length).forEach((tour, t) => {
      for (const [a, b] of tour) {
        matches.push({ groupCode: group.code, tour: t + 1, home: group.members[a] as string, away: group.members[b] as string })
      }
    })
  }
  return matches
}

/** Groups and their round-robin matches; `seeded` is sorted strongest first. */
export function buildGroupStage(
  stage: Extract<StageSpec, { kind: 'groups' | 'round_robin' }>,
  seeded: readonly Participant[],
  options: { seed?: number } = {},
): { groups: PlannedGroup[]; matches: PlannedGroupMatch[]; warnings: StageWarning[] } {
  const { groups, warnings } = planGroups(stage, seeded, options)
  return { groups, matches: groupMatches(groups), warnings }
}

export function buildBracket(stage: BracketStageSpec, players: number): Bracket {
  const size = bracketSizeFor(Math.max(players, 2))
  switch (stage.kind) {
    case 'single_elim':
      return singleElimination(size, stage.thirdPlace)
    case 'all_places':
      return placesBracket(size, { eliminateAfter: stage.eliminateAfter })
    case 'minus2':
      if (stage.scheme === 'long32' && size <= 32) return long32()
      return placesBracket(size, { lowerRounds: size, eliminateAfter: stage.eliminateAfter })
    case 'mixed':
      return placesBracket(size, { lowerRounds: stage.lowerRounds, eliminateAfter: stage.eliminateAfter })
  }
}

/** Warning for a bracket size that is awkward to run (spec: recommend 16, 24, 32, 48 or 64). */
export function bracketSizeWarnings(players: number): StageWarning[] {
  const r = recommendBracketSize(players)
  if (!r) return []
  return [{ code: 'bracket_size', params: { players, size: bracketSizeFor(players), lower: r.lower ?? '', upper: r.upper ?? '' } }]
}

// ---------------------------------------------------------------------------
// Qualifiers

export type GroupOutcome = { code: string; standings: StandingsResult }

type Finisher = { id: string; group: string; groupIndex: number; row: StandingRow; rating: number }

const setsRatio = (r: StandingRow) => (r.setsLost === 0 ? (r.setsWon === 0 ? 0 : Infinity) : r.setsWon / r.setsLost)

/** Comparison between players of different groups: place, then points, games ratio, rating. */
function compareFinishers(a: Finisher, b: Finisher): number {
  return a.row.place - b.row.place || b.row.points - a.row.points || setsRatio(b.row) - setsRatio(a.row) || b.rating - a.rating
}

function finishers(outcomes: readonly GroupOutcome[], ratings: Record<string, number>): Finisher[] {
  return outcomes
    .flatMap((g, groupIndex) => g.standings.rows.map((row) => ({ id: row.id, group: g.code, groupIndex, row, rating: ratings[row.id] ?? 0 })))
    .sort(compareFinishers)
}

export type Qualifier = { id: string; group: string; groupPlace: number; groupIndex?: number }

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
  return chosen.map((f) => ({ id: f.id, group: f.group, groupPlace: f.row.place, groupIndex: f.groupIndex }))
}

/**
 * Seeds of a bracket fed from groups (spec 5, variant Б). Qualifiers come in seeding order.
 * - The best group place present (1st places) is seeded by group number: A1 = 1, B1 = 2, …
 * - The next place (2nd) goes to the half opposite its own 1st, facing the 1st of the paired group
 *   (A1–B2, B1–A2, …), so a group's 1st and 2nd can meet only in the final.
 * - Lower places (3rd, …) take the standard seeds; one that lands in a quarter with a player of its own group
 *   swaps with the nearest same-place player of another group. Byes go to the top seeds.
 * Returns seeds[i] = entry id with seed i + 1 (null = bye) and warnings when a clash can't be avoided.
 */
export function seedsFromGroups(qualifiers: readonly Qualifier[]): { seeds: (string | null)[]; warnings: StageWarning[] } {
  const size = bracketSizeFor(Math.max(qualifiers.length, 2))
  const order = seedOrder(size)
  const slot = new Map(order.map((seed, i) => [seed, i]))
  const half = (seed: number) => ((slot.get(seed) as number) < size / 2 ? 0 : 1)
  const unit = Math.max(2, size / 4)
  const quarter = (seed: number) => Math.floor((slot.get(seed) as number) / unit)
  const warnings: StageWarning[] = []
  const seedOf = new Map<Qualifier, number>()
  const tiers = [...new Set(qualifiers.map((q) => q.groupPlace))].sort((a, b) => a - b)
  const index = (q: Qualifier) => q.groupIndex ?? q.group.length * 1000 + q.group.charCodeAt(q.group.length - 1)
  const mates = (q: Qualifier) => [...seedOf].filter(([o]) => o.group === q.group && o !== q).map(([, s]) => s)
  let next = 1
  tiers.forEach((place, t) => {
    let members = qualifiers.filter((q) => q.groupPlace === place)
    const block = members.map((_, i) => next + i)
    if (t === 0) {
      members = [...members].sort((a, b) => index(a) - index(b))
      members.forEach((q, i) => seedOf.set(q, block[i] as number))
    } else if (t === 1) {
      const ok = (q: Qualifier, seed: number) => mates(q).every((s) => half(s) !== half(seed))
      const first = [...seedOf.keys()]
      const preferred = members.map((q) => {
        const partner = first.find((f) => index(f) === (index(q) ^ 1)) ?? first.find((f) => f.group === q.group)
        return partner ? size + 1 - (seedOf.get(partner) as number) : -1
      })
      const fits = new Set(preferred).size === members.length && members.every((q, i) => block.includes(preferred[i] as number) && ok(q, preferred[i] as number))
      if (fits) members.forEach((q, i) => seedOf.set(q, preferred[i] as number))
      else {
        const taken = new Set<number>()
        const pick = (i: number): boolean => {
          const q = members[i]
          if (!q) return true
          for (const seed of block) {
            if (taken.has(seed) || !ok(q, seed)) continue
            taken.add(seed)
            seedOf.set(q, seed)
            if (pick(i + 1)) return true
            taken.delete(seed)
            seedOf.delete(q)
          }
          return false
        }
        if (!pick(0)) {
          members.forEach((q, i) => seedOf.set(q, block[i] as number))
          for (const q of members) if (!ok(q, seedOf.get(q) as number)) warnings.push({ code: 'group_same_half', params: { group: q.group } })
        }
      }
    } else {
      const earlier = new Map(seedOf)
      members.forEach((q, i) => seedOf.set(q, block[i] as number))
      const clash = (q: Qualifier, seed: number) => [...earlier].some(([o, s]) => o.group === q.group && quarter(s) === quarter(seed))
      for (const q of members) {
        const seed = seedOf.get(q) as number
        if (!clash(q, seed)) continue
        const swap = members
          .filter((o) => o.group !== q.group)
          .sort((a, b) => Math.abs((seedOf.get(a) as number) - seed) - Math.abs((seedOf.get(b) as number) - seed))
          .find((o) => !clash(q, seedOf.get(o) as number) && !clash(o, seed))
        if (swap) {
          seedOf.set(q, seedOf.get(swap) as number)
          seedOf.set(swap, seed)
        } else warnings.push({ code: 'group_same_quarter', params: { group: q.group, place } })
      }
    }
    next += members.length
  })
  const seeds: (string | null)[] = Array<string | null>(size).fill(null)
  for (const [q, s] of seedOf) seeds[s - 1] = q.id
  return { seeds, warnings }
}

/** Seeds only (see seedsFromGroups). */
export const seedsFromQualifiers = (qualifiers: readonly Qualifier[]): (string | null)[] => seedsFromGroups(qualifiers).seeds

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

