import { describe, expect, it } from 'vitest'
import { estimateFormat, FORMAT_TEMPLATES, formatTemplate, matchRulesFor, validateFormat } from './formats.ts'
import { groupStandings } from './groups.ts'
import type { GroupMatchResult } from './groups.ts'
import { bracketPlaces, resolveBracket } from './bracket.ts'
import { seededRandom } from './random.ts'
import { simulateMatch } from './simulate.ts'
import { buildBracket, buildGroupStage, finalPlaces, selectQualifiers, seedsFromQualifiers } from './tournament.ts'
import type { GroupOutcome, Participant, StageOutcome } from './tournament.ts'

describe('ready formats', () => {
  it('all templates are valid', () => {
    for (const id of FORMAT_TEMPLATES) expect(validateFormat(formatTemplate(id, 32)), id).toEqual([])
  })

  it('32 players, groups of 4 → main + consolation: 48 + 16 + 15 = 79 matches, ≈3 h 20 min on 8 tables', () => {
    const e = estimateFormat(formatTemplate('groups_main_consolation', 32), 32, { tables: 8, avgMatchMinutes: 20 })
    expect(e.stages.map((s) => s.matches)).toEqual([48, 16, 15])
    expect(e.totalMatches).toBe(79)
    expect(Math.round(e.minutes / 10) * 10).toBe(200)
  })

  it('32 players: ГС-1 = 80, ГС-2 = 64, ГС-3 (all places) = 128 matches', () => {
    expect(estimateFormat(formatTemplate('gs1', 32, { advance: 16 }), 32).totalMatches).toBe(80)
    expect(estimateFormat(formatTemplate('gs2', 32, { advance: 16 }), 32).totalMatches).toBe(64)
    expect(estimateFormat(formatTemplate('gs3', 32, { bracket: 'all_places' }), 32).totalMatches).toBe(128)
  })

  it('suggests 16 to the bracket for 32 players in groups of 4', () => {
    const f = formatTemplate('gs1', 32)
    expect(f.transitions[0]?.rule).toEqual({ by: 'top', count: 16 })
  })

  it('rejects a backwards transition', () => {
    const f = formatTemplate('gs1', 32)
    f.transitions.push({ from: 'main', to: 'groups', rule: { by: 'all' } })
    expect(validateFormat(f).some((e) => e.startsWith('format.transition_backwards'))).toBe(true)
  })
})

describe('ГС-1 end to end: 32 players, 8 groups of 4, 16 to the all-places bracket', () => {
  const rng = seededRandom(7)
  const players: Participant[] = Array.from({ length: 32 }, (_, i) => ({ id: `P${i + 1}`, rating: 1600 - i * 15 }))
  const ratings = Object.fromEntries(players.map((p) => [p.id, p.rating]))
  const format = formatTemplate('gs1', 32, { advance: 16 })
  const groupsStage = format.stages[0] as Extract<(typeof format.stages)[number], { kind: 'groups' }>
  const plan = buildGroupStage(groupsStage, players)

  const outcomes: GroupOutcome[] = plan.groups.map((g) => {
    const results: GroupMatchResult[] = plan.matches
      .filter((m) => m.groupCode === g.code)
      .map((m) => ({ ...m, ...simulateMatch(ratings[m.home]!, ratings[m.away]!, format.match, rng), type: 'normal' as const }))
    return { code: g.code, standings: groupStandings(g.members, results, { ratings }) }
  })

  const qualifiers = selectQualifiers(format.transitions[0]!.rule, outcomes, ratings)
  const seeds = seedsFromQualifiers(qualifiers)
  const bracket = buildBracket(format.stages[1] as Extract<(typeof format.stages)[number], { kind: 'all_places' }>, qualifiers.length)
  const results = new Map<number, 'home' | 'away'>()
  for (let pass = 0; pass < bracket.matches.length; pass++) {
    for (const m of resolveBracket(bracket, seeds, results)) {
      if (m.state !== 'ready') continue
      const h = (m.homeSlot as { id: string }).id
      const a = (m.awaySlot as { id: string }).id
      results.set(m.number, simulateMatch(ratings[h]!, ratings[a]!, format.match, rng).winner)
    }
  }
  const resolved = resolveBracket(bracket, seeds, results)

  it('plays 48 group matches and 32 bracket matches = 80', () => {
    expect(plan.matches).toHaveLength(48)
    expect(resolved.filter((m) => m.state === 'done')).toHaveLength(32)
  })

  it('puts the first and second of one group in different halves', () => {
    const half = (id: string) => {
      const firstRound = bracket.matches.slice(0, 8)
      const index = firstRound.findIndex((m) => [m.home, m.away].some((s) => s.kind === 'seed' && seeds[s.seed - 1] === id))
      return index < 4 ? 0 : 1
    }
    for (const g of plan.groups) {
      const fromGroup = qualifiers.filter((q) => q.group === g.code)
      if (fromGroup.length === 2) expect(half(fromGroup[0]!.id)).not.toBe(half(fromGroup[1]!.id))
    }
  })

  it('gives exact places 1–16 in the bracket and 17–32 to the rest', () => {
    const outcomesAll: StageOutcome[] = [
      { stage: 'groups', kind: 'groups', groups: outcomes },
      { stage: 'main', kind: 'bracket', places: bracketPlaces(resolved) },
    ]
    const places = finalPlaces(format, outcomesAll, new Set(qualifiers.map((q) => q.id)), ratings)
    expect(places.map((p) => p.place).sort((a, b) => a - b)).toEqual(Array.from({ length: 32 }, (_, i) => i + 1))
    expect(places.filter((p) => p.stage === 'main')).toHaveLength(16)
    // Group thirds come before group fourths.
    const groupPlace = (id: string) => outcomes.flatMap((o) => o.standings.rows).find((r) => r.id === id)!.place
    const rest = places.filter((p) => p.stage === 'groups').sort((a, b) => a.place - b.place)
    expect(rest.slice(0, 8).every((p) => groupPlace(p.id) === 3)).toBe(true)
  })
})

describe('match format per stage and round', () => {
  it('stage and final overrides win over the tournament rules', () => {
    const f = formatTemplate('gs2', 16)
    f.stages[1] = { ...f.stages[1]!, match: { gamePoints: 'required' }, rounds: { final: { winsNeeded: 4 } } }
    expect(matchRulesFor(f, 'groups', 'group:A')).toEqual(f.match)
    expect(matchRulesFor(f, 'main', '1/2')).toEqual({ ...f.match, gamePoints: 'required' })
    expect(matchRulesFor(f, 'main', 'final')).toEqual({ ...f.match, gamePoints: 'required', winsNeeded: 4 })
    f.stages[1] = { ...f.stages[1]!, rounds: { final: { winsNeeded: 5 } } }
    expect(validateFormat(f)).toContain('format.wins_needed')
  })
})
