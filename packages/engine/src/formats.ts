// Tournament format = a chain of stages with transitions (spec 4.6, F-1…F-6).
// Stored as JSON on the tournament; ready formats are templates that fill the chain.

import { bracketMatchCount, bracketSizeFor } from './bracket.ts'
import { DEFAULT_GROUP_POINTS, DEFAULT_TIEBREAKS, groupMatchCount, groupSizes } from './groups.ts'
import type { GroupPoints, TieBreakCriterion } from './groups.ts'
import { DEFAULT_MATCH_RULES } from './scoring.ts'
import type { MatchRules } from './scoring.ts'

export type StageSpec =
  | { id: string; kind: 'groups'; name: string; groupSize: number; seeding: 'snake' | 'random' | 'manual' }
  | { id: string; kind: 'round_robin'; name: string }
  | { id: string; kind: 'single_elim'; name: string; thirdPlace: 'match' | 'shared' }
  | { id: string; kind: 'all_places'; name: string }

export type StageKind = StageSpec['kind']

export type TransitionRule =
  /** Given places of every group, e.g. [1, 2] → main bracket. */
  | { by: 'places'; places: number[] }
  /** N best by group place, then points, games ratio, rating (ГС-1/ГС-2). */
  | { by: 'top'; count: number }
  /** Everybody (ГС-3). */
  | { by: 'all' }
  /** «Два лучших третьих места»: best `count` players among the given place. */
  | { by: 'best_of_place'; place: number; count: number }

export type Transition = { from: string; to: string; rule: TransitionRule }

/** Order in which final places are given: first block gets 1…k, the next k+1…, and so on. */
export type Placement = { stage: string; who: 'all' | 'not_advanced' }

export type TournamentFormat = {
  version: 1
  template: FormatTemplateId | 'custom'
  stages: StageSpec[]
  transitions: Transition[]
  placement: Placement[]
  match: MatchRules
  groupPoints: GroupPoints
  tiebreaks: TieBreakCriterion[]
  /** Minimum rest between a player's matches, 0–30 minutes. */
  restMinutes: number
}

export const FORMAT_TEMPLATES = ['round_robin', 'olympic', 'gs1', 'gs2', 'gs3', 'groups_main_consolation'] as const
export type FormatTemplateId = (typeof FORMAT_TEMPLATES)[number]

export type TemplateParams = {
  groupSize?: number
  /** Players going to the bracket for ГС-1 / ГС-2. Suggested from the player count when omitted. */
  advance?: number
  /** Bracket kind for ГС-3. */
  bracket?: 'all_places' | 'single_elim'
  match?: Partial<MatchRules>
  restMinutes?: number
}

/** Suggested bracket size for ГС-1/ГС-2: the power of two closest to two per group, not above the player count. */
export function suggestAdvance(players: number, groupSize = 4): number {
  const groups = groupSizes(Math.max(players, 3), groupSize).length
  let n = 2
  while (n * 2 <= Math.min(players, groups * 2)) n *= 2
  return n
}

export function formatTemplate(id: FormatTemplateId, players: number, params: TemplateParams = {}): TournamentFormat {
  const base = {
    version: 1 as const,
    template: id,
    match: { ...DEFAULT_MATCH_RULES, ...params.match },
    groupPoints: DEFAULT_GROUP_POINTS,
    tiebreaks: DEFAULT_TIEBREAKS,
    restMinutes: params.restMinutes ?? 10,
  }
  const groupSize = params.groupSize ?? 4
  const groups: StageSpec = { id: 'groups', kind: 'groups', name: 'Группы', groupSize, seeding: 'snake' }
  switch (id) {
    case 'round_robin':
      return {
        ...base,
        stages: [{ id: 'rr', kind: 'round_robin', name: 'Круговая' }],
        transitions: [],
        placement: [{ stage: 'rr', who: 'all' }],
      }
    case 'olympic':
      return {
        ...base,
        stages: [{ id: 'main', kind: 'single_elim', name: 'Олимпийская сетка', thirdPlace: 'match' }],
        transitions: [],
        placement: [{ stage: 'main', who: 'all' }],
      }
    case 'gs1':
    case 'gs2': {
      const count = params.advance ?? suggestAdvance(players, groupSize)
      const bracket: StageSpec =
        id === 'gs1'
          ? { id: 'main', kind: 'all_places', name: 'Сетка на все места' }
          : { id: 'main', kind: 'single_elim', name: 'Олимпийская сетка', thirdPlace: 'match' }
      return {
        ...base,
        stages: [groups, bracket],
        transitions: [{ from: 'groups', to: 'main', rule: { by: 'top', count } }],
        placement: [
          { stage: 'main', who: 'all' },
          { stage: 'groups', who: 'not_advanced' },
        ],
      }
    }
    case 'gs3': {
      const bracket: StageSpec =
        params.bracket === 'single_elim'
          ? { id: 'main', kind: 'single_elim', name: 'Олимпийская сетка', thirdPlace: 'match' }
          : { id: 'main', kind: 'all_places', name: 'Сетка на все места' }
      return {
        ...base,
        stages: [groups, bracket],
        transitions: [{ from: 'groups', to: 'main', rule: { by: 'all' } }],
        placement: [{ stage: 'main', who: 'all' }],
      }
    }
    case 'groups_main_consolation':
      return {
        ...base,
        stages: [
          { ...groups, groupSize: params.groupSize ?? 4 },
          { id: 'main', kind: 'single_elim', name: 'Основная сетка', thirdPlace: 'match' },
          { id: 'consolation', kind: 'single_elim', name: 'Утешительная сетка', thirdPlace: 'shared' },
        ],
        transitions: [
          { from: 'groups', to: 'main', rule: { by: 'places', places: [1, 2] } },
          { from: 'groups', to: 'consolation', rule: { by: 'places', places: [3, 4] } },
        ],
        placement: [
          { stage: 'main', who: 'all' },
          { stage: 'consolation', who: 'all' },
          { stage: 'groups', who: 'not_advanced' },
        ],
      }
  }
}

// ---------------------------------------------------------------------------
// Validation (F-5)

export function validateFormat(format: TournamentFormat): string[] {
  const errors: string[] = []
  const ids = format.stages.map((s) => s.id)
  const index = new Map(ids.map((id, i) => [id, i]))
  if (format.stages.length === 0) errors.push('format.no_stages')
  if (new Set(ids).size !== ids.length) errors.push('format.duplicate_stage_id')
  for (const t of format.transitions) {
    const from = index.get(t.from)
    const to = index.get(t.to)
    if (from == null || to == null) {
      errors.push(`format.unknown_stage:${t.from}->${t.to}`)
      continue
    }
    if (to <= from) errors.push(`format.transition_backwards:${t.from}->${t.to}`)
    const source = format.stages[from] as StageSpec
    if (source.kind !== 'groups' && source.kind !== 'round_robin') errors.push(`format.transition_from_bracket:${t.from}`)
  }
  format.stages.forEach((stage, i) => {
    if (i > 0 && !format.transitions.some((t) => t.to === stage.id)) errors.push(`format.unreachable_stage:${stage.id}`)
    if (stage.kind === 'groups' && (stage.groupSize < 3 || stage.groupSize > 8)) errors.push(`format.group_size:${stage.id}`)
  })
  // Places from one stage go to one destination only.
  for (const stage of format.stages) {
    const taken = new Set<number>()
    for (const t of format.transitions.filter((x) => x.from === stage.id && x.rule.by === 'places')) {
      for (const p of (t.rule as { places: number[] }).places) {
        if (taken.has(p)) errors.push(`format.place_used_twice:${stage.id}:${p}`)
        taken.add(p)
      }
    }
  }
  // Every stage must be in the final placement, so every player either advances or gets a place.
  const placed = new Set(format.placement.map((p) => p.stage))
  for (const stage of format.stages) {
    const advancesAll = format.transitions.some((t) => t.from === stage.id && t.rule.by === 'all')
    if (!placed.has(stage.id) && !advancesAll) errors.push(`format.stage_without_places:${stage.id}`)
  }
  if (format.match.winsNeeded < 2 || format.match.winsNeeded > 4) errors.push('format.wins_needed')
  if (format.restMinutes < 0 || format.restMinutes > 30) errors.push('format.rest_minutes')
  return errors
}

// ---------------------------------------------------------------------------
// Preview / estimate (F-4): matches per stage and approximate duration T ≈ M · t / N.

export type StageEstimate = {
  id: string
  name: string
  kind: StageKind
  players: number
  matches: number
  groups?: number[]
  bracketSize?: number
}

export type FormatEstimate = { stages: StageEstimate[]; totalMatches: number; minutes: number }

export function estimateFormat(
  format: TournamentFormat,
  players: number,
  options: { tables: number; avgMatchMinutes?: number } = { tables: 1 },
): FormatEstimate {
  const incoming = new Map<string, number>()
  const groupsOf = new Map<string, number[]>()
  const stages: StageEstimate[] = []
  format.stages.forEach((stage, i) => {
    const count = i === 0 ? players : (incoming.get(stage.id) ?? 0)
    let matches = 0
    const estimate: StageEstimate = { id: stage.id, name: stage.name, kind: stage.kind, players: count, matches: 0 }
    if (count >= 2) {
      if (stage.kind === 'groups') {
        const sizes = count >= 3 ? groupSizes(count, stage.groupSize) : [count]
        groupsOf.set(stage.id, sizes)
        estimate.groups = sizes
        matches = sizes.reduce((sum, g) => sum + groupMatchCount(g), 0)
      } else if (stage.kind === 'round_robin') {
        groupsOf.set(stage.id, [count])
        matches = groupMatchCount(count)
      } else {
        const size = bracketSizeFor(count)
        estimate.bracketSize = size
        matches = bracketMatchCount(stage.kind, size, stage.kind === 'single_elim' ? stage.thirdPlace : 'match')
      }
    }
    estimate.matches = matches
    stages.push(estimate)
    for (const t of format.transitions.filter((x) => x.from === stage.id)) {
      incoming.set(t.to, (incoming.get(t.to) ?? 0) + qualifierCount(t.rule, groupsOf.get(stage.id) ?? [count], count))
    }
  })
  const totalMatches = stages.reduce((sum, s) => sum + s.matches, 0)
  const avg = options.avgMatchMinutes ?? 20
  const minutes = Math.ceil((totalMatches * avg) / Math.max(options.tables, 1))
  return { stages, totalMatches, minutes }
}

export function qualifierCount(rule: TransitionRule, groupSizesList: number[], players: number): number {
  switch (rule.by) {
    case 'all':
      return players
    case 'top':
      return Math.min(rule.count, players)
    case 'best_of_place':
      return Math.min(rule.count, groupSizesList.filter((g) => g >= rule.place).length)
    case 'places':
      return rule.places.reduce((sum, p) => sum + groupSizesList.filter((g) => g >= p).length, 0)
  }
}
