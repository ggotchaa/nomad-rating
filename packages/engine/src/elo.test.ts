import { describe, expect, it } from 'vitest'
import { calibratedRating, emptyCalibration, expectedScore, kFactor, rateTournament, rttfToElo } from './elo.ts'
import type { PlayerRatingState, RatedMatch } from './elo.ts'

const rated = (rating: number, ratedMatches = 100): PlayerRatingState => ({
  rating,
  source: 'calibration',
  ratedMatches,
  startLevel: 1000,
  calibration: emptyCalibration(),
})
const calibrating = (tournaments = 0): PlayerRatingState => ({
  rating: null,
  source: null,
  ratedMatches: 0,
  startLevel: 1000,
  calibration: { ...emptyCalibration(), tournaments },
})
const m = (id: string, a: string, b: string, winner: 'a' | 'b'): RatedMatch => ({ id, a, b, winner, rated: true })

describe('Elo (spec 5 examples)', () => {
  it('E for 1200 vs 1000 ≈ 0.76', () => {
    expect(expectedScore(1200, 1000)).toBeCloseTo(0.76, 2)
  })

  it('favourite wins: +6 / −6; outsider wins: −18 / +18 with K = 24', () => {
    const states = new Map([
      ['A', rated(1200)],
      ['B', rated(1000)],
    ])
    const fav = rateTournament(states, [m('1', 'A', 'B', 'a')])
    expect([fav.get('A')!.delta, fav.get('B')!.delta]).toEqual([6, -6])
    const upset = rateTournament(states, [m('1', 'A', 'B', 'b')])
    expect([upset.get('A')!.delta, upset.get('B')!.delta]).toEqual([-18, 18])
  })

  it('equal players: ±12', () => {
    const r = rateTournament(new Map([['A', rated(1000)], ['B', rated(1000)]]), [m('1', 'A', 'B', 'a')])
    expect([r.get('A')!.delta, r.get('B')!.delta]).toEqual([12, -12])
  })

  it('B just calibrated (K = 40) beats A (K = 24): −18 / +30', () => {
    const r = rateTournament(new Map([['A', rated(1200)], ['B', rated(1000, 0)]]), [m('1', 'A', 'B', 'b')])
    expect([r.get('A')!.delta, r.get('B')!.delta]).toEqual([-18, 30])
  })

  it('K tiers: 40 provisional, 24 standard, 16 from 1800, RTTF 40 for 5 matches', () => {
    expect(kFactor({ rating: 1000, source: 'calibration', ratedMatches: 14 })).toBe(40)
    expect(kFactor({ rating: 1000, source: 'calibration', ratedMatches: 15 })).toBe(24)
    expect(kFactor({ rating: 1850, source: 'calibration', ratedMatches: 50 })).toBe(16)
    expect(kFactor({ rating: 1400, source: 'rttf', ratedMatches: 4 })).toBe(40)
    expect(kFactor({ rating: 1400, source: 'rttf', ratedMatches: 5 })).toBe(24)
  })

  it('ratings are frozen: the order of matches does not change the result', () => {
    const states = new Map([['A', rated(1300)], ['B', rated(1250)], ['C', rated(1100)]])
    const list = [m('1', 'A', 'B', 'b'), m('2', 'B', 'C', 'a'), m('3', 'C', 'A', 'a')]
    const one = rateTournament(states, list)
    const two = rateTournament(states, [...list].reverse())
    for (const id of ['A', 'B', 'C']) expect(one.get(id)!.delta).toBe(two.get(id)!.delta)
  })

  it('walkovers are not rated and the floor is 100', () => {
    const r = rateTournament(new Map([['A', rated(105)], ['B', rated(110)]]), [
      { ...m('1', 'A', 'B', 'b'), rated: false },
      m('2', 'A', 'B', 'b'),
    ])
    expect(r.get('A')!.after.rating).toBe(100)
    expect(r.get('A')!.events).toHaveLength(1)
  })
})

describe('calibration', () => {
  it('spec example: best win 1180, worst loss 1110 → 1145', () => {
    expect(calibratedRating({ bestWin: 1180, worstLoss: 1110 })).toBe(1145)
    expect(calibratedRating({ bestWin: 1180, worstLoss: null })).toBe(1280)
    expect(calibratedRating({ bestWin: null, worstLoss: 1110 })).toBe(1010)
  })

  it('a calibrating player gets a rating after the third tournament; opponents are not affected', () => {
    const states = new Map<string, PlayerRatingState>([
      ['N', calibrating(2)],
      ['X', rated(990)],
      ['Y', rated(1180)],
      ['Z', rated(1110)],
      ['W', rated(1320)],
    ])
    const r = rateTournament(states, [m('1', 'N', 'X', 'a'), m('2', 'N', 'Y', 'a'), m('3', 'N', 'Z', 'b'), m('4', 'N', 'W', 'b')])
    expect(r.get('N')!.after.rating).toBe(1145)
    expect(r.get('N')!.calibrated).toMatchObject({ bestWin: 1180, worstLoss: 1110 })
    expect(r.get('Y')!.delta).toBe(0)
  })

  it('is extended when no rated opponent was met', () => {
    const r = rateTournament(new Map([['N', calibrating(2)], ['M', calibrating(0)]]), [m('1', 'N', 'M', 'a')])
    expect(r.get('N')!.after.rating).toBeNull()
    expect(r.get('N')!.after.calibration.tournaments).toBe(3)
  })
})

describe('RTTF transfer', () => {
  it('maps 50/150/250/350/450 to 800/1000/1200/1400/1600', () => {
    expect([50, 150, 250, 350, 450].map((r) => rttfToElo(r))).toEqual([800, 1000, 1200, 1400, 1600])
  })
})
