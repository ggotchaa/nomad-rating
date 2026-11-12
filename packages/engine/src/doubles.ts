// Doubles Elo (spec 4.11, D-8): a separate rating per player, starting from the singles rating.
// A pair plays with the average of its two ratings; each player's change uses his own K (per-partner K).
// Players without a doubles or singles rating calibrate against rated opponent pairs (their average).

import { calibratedRating, DEFAULT_ELO, expectedScore, kFactor } from './elo.ts'
import type { CalibrationProgress, EloEvent, EloParams, PlayerRatingState, PlayerTournamentResult } from './elo.ts'

export type DoublesMatch = {
  id: string
  a: readonly [string, string]
  b: readonly [string, string]
  winner: 'a' | 'b'
  rated: boolean
}

/** Initial doubles state: the singles rating when the player has no doubles history. */
export function doublesStart(singles: PlayerRatingState | undefined, startLevel: number): PlayerRatingState {
  return {
    rating: singles?.rating ?? null,
    source: singles?.rating != null ? singles.source : null,
    ratedMatches: 0,
    startLevel,
    calibration: { tournaments: 0, bestWin: null, worstLoss: null, bestWinMatch: null, worstLossMatch: null },
  }
}

export const pairRating = (a: number, b: number): number => (a + b) / 2

export function rateDoublesTournament(
  states: ReadonlyMap<string, PlayerRatingState>,
  matches: readonly DoublesMatch[],
  options: { params?: EloParams; coefficient?: number } = {},
): Map<string, PlayerTournamentResult> {
  const params = options.params ?? DEFAULT_ELO
  const coefficient = options.coefficient ?? 1
  const stateOf = (id: string): PlayerRatingState => {
    const s = states.get(id)
    if (!s) throw new Error(`elo.unknown_player:${id}`)
    return s
  }
  const sums = new Map<string, number>()
  const counters = new Map<string, number>()
  const calibration = new Map<string, CalibrationProgress>()
  const events = new Map<string, EloEvent[]>()
  const played = new Set<string>()

  for (const m of matches) {
    if (!m.rated) continue
    for (const [own, opp, won] of [
      [m.a, m.b, m.winner === 'a'],
      [m.b, m.a, m.winner === 'b'],
    ] as const) {
      const oppStates = opp.map(stateOf)
      const oppRated = oppStates.every((s) => s.rating != null)
      const oppAvg = oppRated ? pairRating(oppStates[0]!.rating!, oppStates[1]!.rating!) : null
      const score = won ? 1 : 0
      own.forEach((id, i) => {
        played.add(id)
        const self = stateOf(id)
        const partner = stateOf(own[1 - i]!)
        if (oppAvg == null) return
        if (self.rating == null) {
          const c = calibration.get(id) ?? { ...self.calibration }
          if (score === 1 && (c.bestWin == null || oppAvg > c.bestWin)) {
            c.bestWin = oppAvg
            c.bestWinMatch = m.id
          }
          if (score === 0 && (c.worstLoss == null || oppAvg < c.worstLoss)) {
            c.worstLoss = oppAvg
            c.worstLossMatch = m.id
          }
          calibration.set(id, c)
          return
        }
        const ownAvg = pairRating(self.rating, partner.rating ?? partner.startLevel)
        const index = counters.get(id) ?? 0
        counters.set(id, index + 1)
        const k = kFactor({ ...self, ratedMatches: self.ratedMatches + index }, params)
        const expected = expectedScore(ownAvg, oppAvg)
        const delta = k * (score - expected) * coefficient
        sums.set(id, (sums.get(id) ?? 0) + delta)
        const list = events.get(id) ?? []
        list.push({ matchId: m.id, playerId: id, opponentId: opp[0], ratingBefore: self.rating, opponentRating: oppAvg, expected, k, score, delta })
        events.set(id, list)
      })
    }
  }

  const results = new Map<string, PlayerTournamentResult>()
  for (const id of played) {
    const before = stateOf(id)
    const result: PlayerTournamentResult = { playerId: id, before, after: before, delta: 0, events: events.get(id) ?? [], calibrated: null }
    if (before.rating != null) {
      const rating = Math.max(params.floor, before.rating + Math.round(sums.get(id) ?? 0))
      result.delta = rating - before.rating
      result.after = { ...before, rating, ratedMatches: before.ratedMatches + (counters.get(id) ?? 0) }
    } else {
      const c = { ...(calibration.get(id) ?? before.calibration) }
      c.tournaments += 1
      if (c.tournaments >= params.calibrationTournaments && (c.bestWin != null || c.worstLoss != null)) {
        const rating = calibratedRating(c, params)
        result.calibrated = { rating, bestWin: c.bestWin, worstLoss: c.worstLoss }
        result.after = { ...before, rating, source: 'calibration', ratedMatches: 0, calibration: c }
      } else result.after = { ...before, calibration: c }
    }
    results.set(id, result)
  }
  return results
}
