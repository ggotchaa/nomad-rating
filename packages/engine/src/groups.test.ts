import { describe, expect, it } from 'vitest'
import { groupSizes, groupStandings, roundRobinTours, snakeGroups } from './groups.ts'
import type { GroupMatchResult } from './groups.ts'
import { gameWinner } from './scoring.ts'
import type { GameScore } from './scoring.ts'

const match = (home: string, away: string, games: [number, number][]): GroupMatchResult => {
  const g: GameScore[] = games.map(([h, a]) => ({ home: h, away: a }))
  const setsHome = g.filter((x) => gameWinner(x) === 'home').length
  const setsAway = g.length - setsHome
  return { home, away, winner: setsHome > setsAway ? 'home' : 'away', setsHome, setsAway, games: g, type: 'normal' }
}

describe('group sizes', () => {
  it('splits 30 players by 4 into 6 × 4 + 2 × 3 (spec 4.4)', () => {
    expect(groupSizes(30, 4)).toEqual([4, 4, 4, 4, 4, 4, 3, 3])
  })
  it('splits 32 by 4 into 8 groups of 4', () => {
    expect(groupSizes(32, 4)).toEqual(Array(8).fill(4))
  })
  it('never makes groups smaller than 3', () => {
    expect(groupSizes(5, 4)).toEqual([5])
    expect(groupSizes(7, 4)).toEqual([4, 3])
  })
})

describe('snake seeding', () => {
  it('fills groups 1→N then N→1 and respects sizes', () => {
    const seeded = Array.from({ length: 10 }, (_, i) => i + 1)
    expect(snakeGroups(seeded, [4, 3, 3])).toEqual([
      [1, 6, 7, 10],
      [2, 5, 8],
      [3, 4, 9],
    ])
  })
})

describe('round robin', () => {
  it('every pair plays exactly once', () => {
    for (const n of [3, 4, 5, 6, 8]) {
      const pairs = roundRobinTours(n).flat()
      expect(pairs).toHaveLength((n * (n - 1)) / 2)
      const keys = new Set(pairs.map(([a, b]) => [a, b].sort().join('-')))
      expect(keys.size).toBe(pairs.length)
    }
  })
})

describe('group standings', () => {
  it('resolves the spec «triangle» by points ratio: B, C, A', () => {
    const matches = [
      match('A', 'B', [[11, 9], [8, 11], [11, 6], [7, 11], [11, 9]]),
      match('B', 'C', [[11, 5], [11, 13], [9, 11], [11, 7], [11, 8]]),
      match('C', 'A', [[11, 7], [12, 14], [11, 9], [6, 11], [11, 4]]),
    ]
    const { rows, missingGamePoints } = groupStandings(['A', 'B', 'C'], matches)
    expect(rows.map((r) => r.id)).toEqual(['B', 'C', 'A'])
    expect(rows.map((r) => [r.pointsWon, r.pointsLost])).toEqual([
      [99, 92],
      [95, 98],
      [93, 97],
    ])
    expect(rows.every((r) => r.decidedBy === 'h2h_points_ratio')).toBe(true)
    expect(missingGamePoints).toBe(false)
  })

  it('falls back to rating when game points are missing and flags it', () => {
    const noPoints = (home: string, away: string): GroupMatchResult => ({
      home,
      away,
      winner: 'home',
      setsHome: 3,
      setsAway: 2,
      games: [],
      type: 'normal',
    })
    const result = groupStandings(['A', 'B', 'C'], [noPoints('A', 'B'), noPoints('B', 'C'), noPoints('C', 'A')], {
      ratings: { A: 1100, B: 1300, C: 1200 },
    })
    expect(result.rows.map((r) => r.id)).toEqual(['B', 'C', 'A'])
    expect(result.missingGamePoints).toBe(true)
    expect(result.rows[0]?.decidedBy).toBe('rating')
  })

  it('decides a two-player tie by head-to-head', () => {
    const matches = [
      match('A', 'B', [[11, 1], [11, 1], [11, 1]]),
      match('B', 'C', [[11, 1], [11, 1], [11, 1]]),
      match('C', 'A', [[11, 1], [11, 1], [11, 1]]),
      match('D', 'A', [[1, 11], [1, 11], [1, 11]]),
      match('D', 'B', [[11, 1], [11, 1], [11, 1]]),
      match('D', 'C', [[1, 11], [1, 11], [1, 11]]),
    ]
    // A: beat B, D; lost C → 5. B: beat C; lost A, D → 4. C: beat A, D; lost B → 5. D: beat B → 4.
    const { rows } = groupStandings(['A', 'B', 'C', 'D'], matches)
    expect(rows.map((r) => r.id)).toEqual(['C', 'A', 'D', 'B'])
    expect(rows[0]?.decidedBy).toBe('h2h_points')
  })

  it('gives 0 points for a walkover loss', () => {
    const wo: GroupMatchResult = { home: 'A', away: 'B', winner: 'home', setsHome: 3, setsAway: 0, games: [], type: 'walkover' }
    const { rows } = groupStandings(['A', 'B'], [wo])
    expect(rows.map((r) => [r.id, r.points])).toEqual([
      ['A', 2],
      ['B', 0],
    ])
  })

  it('uses the organiser decision when everything is equal', () => {
    const tie = (home: string, away: string): GroupMatchResult => ({
      home,
      away,
      winner: 'home',
      setsHome: 3,
      setsAway: 2,
      games: [],
      type: 'normal',
    })
    const matches = [tie('A', 'B'), tie('B', 'C'), tie('C', 'A')]
    const auto = groupStandings(['A', 'B', 'C'], matches, { ratings: { A: 1000, B: 1000, C: 1000 } })
    expect(auto.needsDecision).toBe(true)
    const manual = groupStandings(['A', 'B', 'C'], matches, {
      ratings: { A: 1000, B: 1000, C: 1000 },
      manualOrder: ['C', 'A', 'B'],
    })
    expect(manual.rows.map((r) => r.id)).toEqual(['C', 'A', 'B'])
    expect(manual.needsDecision).toBe(false)
  })
})
