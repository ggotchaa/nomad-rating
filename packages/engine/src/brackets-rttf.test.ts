import { describe, expect, it } from 'vitest'
import { bracketPlaces, long32, placesBracket, resolveBracket } from './bracket.ts'
import type { Bracket } from './bracket.ts'
import { evenGroups, groupStandings, sequentialGroups } from './groups.ts'
import type { GroupMatchResult } from './groups.ts'
import { seedsFromGroups } from './tournament.ts'
import type { Qualifier } from './tournament.ts'

/** Plays a bracket: `win(home, away)` picks the winner by player number; byes pass on their own. */
function play(bracket: Bracket, players: number, win: (h: number, a: number, match: number) => 'home' | 'away') {
  const seeds = Array.from({ length: bracket.size }, (_, i) => (i < players ? `P${i + 1}` : null))
  const results = new Map<number, 'home' | 'away'>()
  for (let pass = 0; pass < bracket.matches.length; pass++) {
    for (const m of resolveBracket(bracket, seeds, results)) {
      if (m.state !== 'ready') continue
      const h = Number((m.homeSlot as { id: string }).id.slice(1))
      const a = Number((m.awaySlot as { id: string }).id.slice(1))
      results.set(m.number, win(h, a, m.number))
    }
  }
  const resolved = resolveBracket(bracket, seeds, results)
  return { resolved, places: bracketPlaces(resolved) }
}

const favourite = (h: number, a: number): 'home' | 'away' => (h < a ? 'home' : 'away')
/** Upsets in every third match (a walkover counts the same as a win for the bracket). */
const upsets = (h: number, a: number, match: number): 'home' | 'away' => ((match % 3 === 0) !== h < a ? 'home' : 'away')

const expectExactPlaces = (places: { id: string; place: number; placeTo: number }[], players: number) => {
  expect(places).toHaveLength(players)
  expect(places.every((p) => p.place === p.placeTo)).toBe(true)
  expect(places.map((p) => p.place).sort((a, b) => a - b)).toEqual(Array.from({ length: players }, (_, i) => i + 1))
}

describe('сетка −1 (прил. 11)', () => {
  for (const players of [8, 12, 16, 24]) {
    it(`${players} players: every place is played exactly, byes to the top seeds`, () => {
      const bracket = placesBracket(players <= 16 ? 16 : 32)
      const size = bracket.size
      if (size === 16 && players === 8) return
      const fav = play(bracket, players, favourite)
      expectExactPlaces(fav.places, players)
      expect(fav.places.map((p) => p.id)).toEqual(Array.from({ length: players }, (_, i) => `P${i + 1}`))
      expectExactPlaces(play(bracket, players, upsets).places, players)
      const byes = fav.resolved.filter((m) => m.state === 'bye' && m.round === 1)
      expect(byes.map((m) => (m.winner as { id: string }).id).sort()).toEqual(
        Array.from({ length: size - players }, (_, i) => `P${i + 1}`).sort(),
      )
    })
  }
  it('8 players in a bracket of 8', () => {
    expectExactPlaces(play(placesBracket(8), 8, upsets).places, 8)
  })
  it('a loser keeps playing only for the lower half: 9–16, then 9–12 / 13–16', () => {
    const b = placesBracket(16)
    const ranges = new Set(b.matches.filter((m) => m.placeFrom >= 9).map((m) => `${m.placeFrom}–${m.placeTo}`))
    expect([...ranges]).toEqual(expect.arrayContaining(['9–16', '9–12', '13–16', '9–10', '11–12', '13–14', '15–16']))
  })
  it('elimination after 1 loss = olympic with shared places', () => {
    const { places } = play(placesBracket(16, { eliminateAfter: 1 }), 16, favourite)
    expect(placesBracket(16, { eliminateAfter: 1 }).matches).toHaveLength(15)
    expect(places.find((p) => p.id === 'P5')).toMatchObject({ place: 5, placeTo: 8 })
  })
})

describe('сетка −2 (прил. 12)', () => {
  const minus2 = (size: number, eliminateAfter?: number) => placesBracket(size, { lowerRounds: size, eliminateAfter })

  it('lower branch for 16 plays 3–16, 3–12, 3–8, 3–6 and the match for 3–4', () => {
    const ranges = [
      ...new Set(
        minus2(16)
          .matches.filter((m) => m.stageLabel === 'lower')
          .map((m) => `${m.placeFrom}–${m.placeTo}`),
      ),
    ]
    expect(ranges).toEqual(['3–16', '3–12', '3–8', '3–6', '3–4'])
  })

  for (const players of [8, 12, 16, 24]) {
    it(`${players} players: unique places, the lower branch winner gets at most 3rd`, () => {
      const bracket = minus2(players <= 8 ? 8 : players <= 16 ? 16 : 32)
      const fav = play(bracket, players, favourite)
      expectExactPlaces(fav.places, players)
      expect(fav.places.map((p) => p.id)).toEqual(Array.from({ length: players }, (_, i) => `P${i + 1}`))
      const { resolved, places } = play(bracket, players, upsets)
      expectExactPlaces(places, players)
      const third = resolved.find((m) => m.winnerPlace === 3)!
      expect(third.stageLabel).toBe('lower')
      expect(places.find((p) => p.place === 1)?.id).toBe(
        (resolved.find((m) => m.winnerPlace === 1)!.winner as { id: string }).id,
      )
    })
  }

  it('the first loss at any stage sends a player to the lower branch', () => {
    const b = minus2(16)
    const upper = b.matches.filter((m) => m.placeFrom === 1 && m.stageLabel !== 'final')
    const lowerSources = new Set(
      b.matches
        .filter((m) => m.stageLabel === 'lower')
        .flatMap((m) => [m.home, m.away])
        .filter((s) => s.kind === 'loser')
        .map((s) => (s as { match: number }).match),
    )
    expect(upper.every((m) => lowerSources.has(m.number))).toBe(true)
  })

  it('no-shows: a walkover in the lower branch still gives everyone a place', () => {
    const { places } = play(minus2(16), 13, (h, a, n) => (n % 5 === 0 ? 'away' : favourite(h, a)))
    expectExactPlaces(places, 13)
  })

  it('elimination after 2 losses = lower branch without playing off the places', () => {
    const { places } = play(minus2(16, 2), 16, favourite)
    expect(places.filter((p) => p.place !== p.placeTo).length).toBeGreaterThan(0)
    expect(places.slice(0, 4).map((p) => [p.place, p.placeTo])).toEqual([
      [1, 1],
      [2, 2],
      [3, 3],
      [4, 4],
    ])
  })

  it('mixed: early rounds by −1, the last 2 rounds by −2', () => {
    const b = placesBracket(16, { lowerRounds: 2 })
    expect(b.kind).toBe('mixed')
    const ranges = [
      ...new Set(b.matches.filter((m) => m.stageLabel === 'lower').map((m) => `${m.placeFrom}–${m.placeTo}`)),
    ]
    expect(ranges).toEqual(['3–8', '3–6', '3–4'])
    expectExactPlaces(play(b, 16, upsets).places, 16)
  })
})

describe('group exit seeding (variant Б)', () => {
  const groups = 'ABCDEFGH'.split('')
  const q = (group: string, place: number): Qualifier => ({
    id: `${group}${place}`,
    group,
    groupPlace: place,
    groupIndex: groups.indexOf(group),
  })

  it('16 from 8 groups: A1–B2, H1–G2, E1–F2, D1–C2, C1–D2, F1–E2, G1–H2, B1–A2', () => {
    const qualifiers = [...groups.map((g) => q(g, 1)), ...[...groups].reverse().map((g) => q(g, 2))]
    const { seeds, warnings } = seedsFromGroups(qualifiers)
    const order = [1, 16, 8, 9, 5, 12, 4, 13, 3, 14, 6, 11, 7, 10, 2, 15]
    const firstRound: string[] = []
    for (let i = 0; i < 16; i += 2) firstRound.push(`${seeds[order[i]! - 1]}–${seeds[order[i + 1]! - 1]}`)
    expect(firstRound).toEqual(['A1–B2', 'H1–G2', 'E1–F2', 'D1–C2', 'C1–D2', 'F1–E2', 'G1–H2', 'B1–A2'])
    expect(warnings).toEqual([])
  })

  it('3rd places avoid the quarter of their own 1st and 2nd', () => {
    const four = groups.slice(0, 4)
    const qualifiers = [
      ...four.map((g) => q(g, 1)),
      ...four.map((g) => q(g, 2)),
      ...four.map((g) => q(g, 3)),
      ...four.map((g) => q(g, 4)),
    ]
    const { seeds, warnings } = seedsFromGroups(qualifiers)
    const slots = [1, 16, 8, 9, 5, 12, 4, 13, 3, 14, 6, 11, 7, 10, 2, 15]
    const quarterOf = (id: string) => Math.floor(slots.indexOf(seeds.indexOf(id) + 1) / 4)
    for (const g of four) {
      expect(quarterOf(`${g}3`)).not.toBe(quarterOf(`${g}1`))
      expect(quarterOf(`${g}3`)).not.toBe(quarterOf(`${g}2`))
      expect(quarterOf(`${g}1`) < 2).not.toBe(quarterOf(`${g}2`) < 2)
    }
    expect(warnings.filter((w) => w.code === 'group_same_half')).toEqual([])
  })

  it('byes go to the best seeds when 12 qualify for a bracket of 16', () => {
    const six = groups.slice(0, 6)
    const { seeds } = seedsFromGroups([...six.map((g) => q(g, 1)), ...six.map((g) => q(g, 2))])
    expect(seeds.slice(12)).toEqual([null, null, null, null])
    expect(seeds.slice(0, 6)).toEqual(six.map((g) => `${g}1`))
  })
})

describe('group seeding modes', () => {
  const ids = Array.from({ length: 8 }, (_, i) => i + 1)
  it('«по рейтингу» fills group A with the strongest', () => {
    expect(sequentialGroups(ids, [4, 4])).toEqual([
      [1, 2, 3, 4],
      [5, 6, 7, 8],
    ])
  })
  it('«равномерный» balances the rating sums', () => {
    const rating = (n: number) => 2000 - n * 100
    const groups = evenGroups(ids, [4, 4], rating)
    const sums = groups.map((g) => g.reduce((s, n) => s + rating(n), 0))
    expect(Math.abs(sums[0]! - sums[1]!)).toBeLessThanOrEqual(200)
  })
})

describe('group places (T-3)', () => {
  const r = (home: string, away: string, sets: [number, number]): GroupMatchResult => ({
    home,
    away,
    winner: sets[0] > sets[1] ? 'home' : 'away',
    setsHome: sets[0],
    setsAway: sets[1],
    games: [],
    type: 'normal',
  })

  it('group of 3: a clear winner is decided by points', () => {
    const { rows } = groupStandings(['A', 'B', 'C'], [r('A', 'B', [3, 0]), r('A', 'C', [3, 1]), r('B', 'C', [3, 2])])
    expect(rows.map((x) => [x.id, x.points, x.decidedBy])).toEqual([
      ['A', 4, 'points'],
      ['B', 3, 'points'],
      ['C', 2, 'points'],
    ])
  })

  it('group of 5: equal points are split by the match between the equals', () => {
    const ms = [
      r('A', 'B', [3, 0]),
      r('A', 'C', [3, 0]),
      r('A', 'D', [0, 3]),
      r('A', 'E', [3, 0]),
      r('B', 'C', [3, 1]),
      r('B', 'D', [3, 1]),
      r('B', 'E', [3, 1]),
      r('C', 'D', [3, 2]),
      r('C', 'E', [3, 0]),
      r('D', 'E', [0, 3]),
    ]
    // A, B: 3 wins (7 points), A beat B; C: 2 wins (6); D, E: 1 win (5), E beat D.
    const { rows } = groupStandings(['A', 'B', 'C', 'D', 'E'], ms)
    expect(rows.map((x) => [x.id, x.decidedBy])).toEqual([
      ['A', 'h2h_points'],
      ['B', 'h2h_points'],
      ['C', 'points'],
      ['E', 'h2h_points'],
      ['D', 'h2h_points'],
    ])
  })

  it('games ratio between the equals: 5/4 is ahead of 5/5 and 4/5', () => {
    const { rows } = groupStandings(['P', 'Q', 'R'], [r('P', 'Q', [2, 3]), r('Q', 'R', [2, 3]), r('R', 'P', [1, 3])])
    expect(rows.map((x) => [x.id, `${x.setsWon}/${x.setsLost}`])).toEqual([
      ['P', '5/4'],
      ['Q', '5/5'],
      ['R', '4/5'],
    ])
    expect(rows[0]?.decidedBy).toBe('h2h_sets_ratio')
  })

  it('5/4 against 4/3: the ratio decides, not the games won (4/3 ≈ 1.33 > 5/4 = 1.25)', () => {
    // Triangle where everyone has one win; X 5/4, Y 4/3, Z 3/5.
    const { rows } = groupStandings(['X', 'Y', 'Z'], [r('X', 'Y', [3, 1]), r('Y', 'Z', [3, 0]), r('Z', 'X', [3, 2])])
    expect(rows.map((x) => [x.id, `${x.setsWon}/${x.setsLost}`])).toEqual([
      ['Y', '4/3'],
      ['X', '5/4'],
      ['Z', '3/5'],
    ])
  })

  it('five equal in everything: rating, then lots that the organiser must confirm', () => {
    const ids = ['A', 'B', 'C', 'D', 'E']
    const ms = ids.flatMap((id, i) => [r(id, ids[(i + 1) % 5]!, [3, 2]), r(id, ids[(i + 2) % 5]!, [3, 2])])
    const byRating = groupStandings(ids, ms, { ratings: { A: 1000, B: 1400, C: 1200, D: 1100, E: 1300 } })
    expect(byRating.rows.map((x) => x.id)).toEqual(['B', 'E', 'C', 'D', 'A'])
    expect(byRating.rows.every((x) => x.decidedBy === 'rating')).toBe(true)
    const lots = groupStandings(ids, ms, { ratings: Object.fromEntries(ids.map((id) => [id, 1000])) })
    expect(lots.needsDecision).toBe(true)
    const manual = groupStandings(ids, ms, {
      ratings: Object.fromEntries(ids.map((id) => [id, 1000])),
      manualOrder: ['E', 'D', 'C', 'B', 'A'],
    })
    expect(manual.rows.map((x) => x.id)).toEqual(['E', 'D', 'C', 'B', 'A'])
    expect(manual.needsDecision).toBe(false)
  })
})

describe('«32 длинная» (RTTF protocol)', () => {
  const b = long32()
  const byNumber = new Map(b.matches.map((m) => [m.number, m]))
  const src = (s: (typeof b.matches)[number]['home']) =>
    s.kind === 'seed' ? `s${s.seed}` : `${s.kind === 'winner' ? 'M' : 'L'}${s.match}`
  const pair = (n: number) => `${src(byNumber.get(n)!.home)}–${src(byNumber.get(n)!.away)}`

  it('has the protocol matches M1…M60 with the protocol links', () => {
    expect(b.matches.map((m) => m.number)).toEqual(Array.from({ length: 60 }, (_, i) => i + 1))
    expect([17, 20, 21, 24].map(pair)).toEqual(['L9–L10', 'L15–L16', 'L1–L2', 'L7–L8'])
    expect([25, 32, 41, 44, 49, 50, 60].map(pair)).toEqual([
      'M1–M2',
      'M15–M16',
      'M25–M26',
      'M31–M32',
      'M41–M42',
      'M43–M44',
      'M49–M50',
    ])
    expect([33, 36, 37, 40].map(pair)).toEqual(['M17–L29', 'M20–L32', 'L25–M21', 'L28–M24'])
    expect([45, 48, 51, 52, 53, 54].map(pair)).toEqual([
      'M33–M34',
      'M39–M40',
      'M45–L43',
      'M46–L44',
      'L41–M47',
      'L42–M48',
    ])
    expect([55, 56, 57, 58, 59].map(pair)).toEqual(['M51–M52', 'M53–M54', 'M55–L50', 'L49–M56', 'M57–M58'])
  })

  it('places 1–4 are played, the rest are shared by the round where the second loss came', () => {
    const { places } = play(b, 32, upsets)
    expect(places).toHaveLength(32)
    const ranges = places.map((p) => `${p.place}–${p.placeTo}`)
    expect(ranges.slice(0, 4)).toEqual(['1–1', '2–2', '3–3', '4–4'])
    for (const r of ['5–6', '7–8', '9–12', '13–16', '17–24', '25–32']) expect(ranges).toContain(r)
  })

  it('the final is played after the match for 3rd place; byes go to the top seeds with 24 players', () => {
    expect(byNumber.get(60)!.round).toBeGreaterThan(byNumber.get(59)!.round)
    const { places, resolved } = play(b, 24, favourite)
    expect(places).toHaveLength(24)
    expect(places.slice(0, 4).map((p) => p.id)).toEqual(['P1', 'P2', 'P3', 'P4'])
    expect(
      resolved
        .filter((m) => m.state === 'bye' && m.number <= 16)
        .map((m) => (m.winner as { id: string }).id)
        .sort(),
    ).toEqual(Array.from({ length: 8 }, (_, i) => `P${i + 1}`).sort())
  })
})
