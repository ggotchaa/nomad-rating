import { describe, expect, it } from 'vitest'
import { emptyCalibration } from './elo.ts'
import type { PlayerRatingState } from './elo.ts'
import { doublesStart, rateDoublesTournament } from './doubles.ts'
import { MEETING_SCHEMES, meetingGames, meetingScore, validateLineup, validateScheme } from './team-meeting.ts'
import { applyMovements, applyPlayoffs, defaultTourPoints, distributeByRating, divisionByRating, mergeSmallDivisions, overallPlaces, playoffPairs, seasonStandings } from './leagues.ts'

const st = (rating: number | null, ratedMatches = 100): PlayerRatingState => ({ rating, source: rating == null ? null : 'calibration', ratedMatches, startLevel: 1000, calibration: emptyCalibration() })

describe('doubles elo', () => {
  it('uses pair averages and each player own K', () => {
    const states = new Map([['a', st(1500)], ['b', st(1300, 0)], ['c', st(1400)], ['d', st(1400)]])
    const r = rateDoublesTournament(states, [{ id: '1', a: ['a', 'b'], b: ['c', 'd'], winner: 'a', rated: true }])
    // equal pair averages → E = 0.5; a has K 24, b provisional K 40
    expect(r.get('a')!.delta).toBe(12)
    expect(r.get('b')!.delta).toBe(20)
    expect(r.get('c')!.delta).toBe(-12)
  })
  it('starts from singles and calibrates newcomers against rated pairs', () => {
    expect(doublesStart(st(1600), 1000).rating).toBe(1600)
    const states = new Map([['n', { ...st(null), calibration: { ...emptyCalibration(), tournaments: 2 } }], ['p', st(1200)], ['c', st(1400)], ['d', st(1600)]])
    const r = rateDoublesTournament(states, [{ id: '1', a: ['n', 'p'], b: ['c', 'd'], winner: 'a', rated: true }])
    expect(r.get('n')!.calibrated?.rating).toBe(1600) // best win 1500 + 100
    expect(r.get('c')!.delta).toBe(0) // opponent pair not fully rated
  })
})

describe('team meeting', () => {
  it('stops at first to N and skips the rest', () => {
    const s = MEETING_SCHEMES.wc
    expect(meetingScore(s, ['home', 'home', 'home', null, null])).toEqual({ home: 3, away: 0, winner: 'home', finished: true, skipped: [3, 4] })
    expect(meetingScore(s, ['home', 'away', 'home', 'away', null]).finished).toBe(false)
    expect(meetingScore({ ...s, playAll: true }, ['home', 'home', 'home', null, null]).finished).toBe(false)
  })
  it('maps slots to players and validates', () => {
    const g = meetingGames(MEETING_SCHEMES.olympic, [1, 2, 3], [4, 5, 6])
    expect(g[0]).toEqual({ index: 0, kind: 'doubles', home: [2, 3], away: [5, 6] })
    expect(g[4]).toEqual({ index: 4, kind: 'singles', home: [2], away: [4] })
    for (const s of Object.values(MEETING_SCHEMES)) expect(validateScheme(s)).toEqual([])
    expect(validateLineup(MEETING_SCHEMES.wc, [1, 1, 2], [1, 2, 3])).toEqual(['lineup.duplicate'])
  })
})

describe('leagues', () => {
  it('distributes and moves across boundaries', () => {
    const divs = distributeByRating(['a', 'b', 'c', 'd', 'e', 'f'].map((id, i) => ({ id, rating: 2000 - i * 100 })), [2, 2, 2])
    expect(divs).toEqual([['a', 'b'], ['c', 'd'], ['e', 'f']])
    const r = applyMovements([['b', 'a'], ['d', 'c'], ['f', 'e']], [{ promote: 1, relegate: 1 }, { promote: 1, relegate: 1 }])
    expect(r.divisions).toEqual([['b', 'd'], ['a', 'f'], ['c', 'e']])
    expect(r.moves).toHaveLength(4)
  })
  it('applies missed-tour rules and freeze', () => {
    const base = [['a', 'b', 'c'], ['d', 'e', 'f']]
    expect(applyMovements(base, [{ promote: 1, relegate: 1 }], { missed: new Set(['a']), missedRule: 'last' }).divisions).toEqual([['b', 'c', 'd'], ['a', 'e', 'f']])
    expect(applyMovements(base, [{ promote: 1, relegate: 1 }], { missed: new Set(['b']), missedRule: 'relegate' }).moves.map((m) => [m.id, m.reason])).toEqual([['c', 'relegation'], ['d', 'promotion'], ['b', 'missed']])
    expect(applyMovements(base, [{ promote: 1, relegate: 1 }], { frozen: new Set(['c']) }).divisions).toEqual([['a', 'c', 'd'], ['b', 'e', 'f']])
  })
  it('merges small divisions and counts N best tours', () => {
    expect(mergeSmallDivisions([6, 2, 5, 1], 3)).toEqual([{ from: 1, to: 0 }, { from: 3, to: 2 }])
    const t = seasonStandings([{ id: 'a', points: 10 }, { id: 'a', points: 2 }, { id: 'a', points: 8 }, { id: 'b', points: 9 }, { id: 'b', points: 9 }], 2)
    expect(t.map((r) => [r.id, r.total])).toEqual([['a', 18], ['b', 18]])
    expect(t[0]!.dropped).toEqual([2])
  })
  it('numbers places through divisions and gives default points', () => {
    const places = overallPlaces([['a', 'b', 'c'], ['d', 'e']])
    expect([...places]).toEqual([['a', 1], ['b', 2], ['c', 3], ['d', 4], ['e', 5]])
    expect([1, 3, 4, 5].map((p) => defaultTourPoints(p, 5))).toEqual([5, 3, 2, 1])
  })
  it('breaks season ties by best place, firsts, last tour', () => {
    const r = (id: string, points: number, place: number, tour: number) => ({ id, points, place, tour })
    expect(seasonStandings([r('a', 5, 2, 1), r('a', 5, 2, 2), r('b', 6, 1, 1), r('b', 4, 3, 2)]).map((x) => x.id)).toEqual(['b', 'a'])
    expect(seasonStandings([r('a', 5, 1, 1), r('a', 5, 3, 2), r('b', 6, 1, 1), r('b', 4, 2, 2)]).map((x) => x.id)).toEqual(['a', 'b'])
    expect(seasonStandings([r('a', 6, 1, 1), r('a', 4, 3, 2), r('b', 4, 1, 1), r('b', 6, 3, 2)]).map((x) => x.id)).toEqual(['b', 'a'])
  })
  it('plays off across boundaries and places newcomers by rating', () => {
    const divs = [['a', 'b', 'c', 'd'], ['e', 'f', 'g', 'h']]
    const pairs = playoffPairs(divs, [{ promote: 1, relegate: 1 }])
    expect(pairs).toEqual([{ boundary: 0, upper: 'c', lower: 'f' }])
    const moved = applyMovements(divs, [{ promote: 1, relegate: 1 }]).divisions
    expect(applyPlayoffs(moved, [{ ...pairs[0]!, lowerWon: true }]).divisions).toEqual([['a', 'b', 'f', 'e'], ['d', 'c', 'g', 'h']])
    expect(divisionByRating([[1500, 1400], [1300, 1200], [1100]], 1350)).toBe(1)
    expect(divisionByRating([[1500], [1300]], 900)).toBe(1)
  })
})
