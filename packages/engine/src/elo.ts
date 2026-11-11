// Elo rating (spec 5): frozen ratings per tournament, K tiers, calibration over three tournaments,
// RTTF transfer. Every rated match produces one event per player; the server stores the events
// (rating_events) so a retroactive correction can replay tournaments in order.

export type EloParams = {
  kProvisional: number // 40 for the first matches after calibration
  provisionalMatches: number // 15
  kStandard: number // 24
  kHigh: number // 16
  highThreshold: number // from 1800
  rttfProvisionalMatches: number // 5 matches with K = 40 after an RTTF transfer
  floor: number // 100
  calibrationTournaments: number // 3
  calibrationFallback: number // ±100 when there were no wins / no losses
  rttfA: number // R_elo = a · R_rttf + b
  rttfB: number
}

export const DEFAULT_ELO: EloParams = {
  kProvisional: 40,
  provisionalMatches: 15,
  kStandard: 24,
  kHigh: 16,
  highThreshold: 1800,
  rttfProvisionalMatches: 5,
  floor: 100,
  calibrationTournaments: 3,
  calibrationFallback: 100,
  rttfA: 2,
  rttfB: 700,
}

export type RatingSource = 'calibration' | 'rttf' | 'admin'

export type PlayerRatingState = {
  /** null while the player is calibrating. */
  rating: number | null
  source: RatingSource | null
  /** Rated matches played since the rating appeared (drives the K tier). */
  ratedMatches: number
  /** Start level, used for seeding while calibrating and in «new city» bootstrap mode. */
  startLevel: number
  calibration: CalibrationProgress
}

export type CalibrationProgress = {
  tournaments: number
  /** Highest rating among rated opponents the player beat. */
  bestWin: number | null
  /** Lowest rating among rated opponents the player lost to. */
  worstLoss: number | null
  bestWinMatch: string | null
  worstLossMatch: string | null
}

export const emptyCalibration = (): CalibrationProgress => ({
  tournaments: 0,
  bestWin: null,
  worstLoss: null,
  bestWinMatch: null,
  worstLossMatch: null,
})

export const expectedScore = (ra: number, rb: number): number => 1 / (1 + 10 ** ((rb - ra) / 400))

export function kFactor(state: Pick<PlayerRatingState, 'rating' | 'source' | 'ratedMatches'>, params: EloParams = DEFAULT_ELO): number {
  const provisional = state.source === 'rttf' ? params.rttfProvisionalMatches : params.provisionalMatches
  if (state.ratedMatches < provisional) return params.kProvisional
  return (state.rating ?? 0) >= params.highThreshold ? params.kHigh : params.kStandard
}

/** Provisional («предварительный») until 15 rated matches. */
export const isProvisional = (state: Pick<PlayerRatingState, 'ratedMatches'>, params: EloParams = DEFAULT_ELO): boolean =>
  state.ratedMatches < params.provisionalMatches

export const rttfToElo = (rttf: number, params: EloParams = DEFAULT_ELO): number =>
  Math.max(params.floor, Math.round(params.rttfA * rttf + params.rttfB))

export type RatedMatch = {
  id: string
  a: string
  b: string
  winner: 'a' | 'b'
  /** False for walkovers, no-shows, byes, injury retirements and unrated tournaments. */
  rated: boolean
}

export type EloEvent = {
  matchId: string
  playerId: string
  opponentId: string
  ratingBefore: number
  opponentRating: number
  expected: number
  k: number
  score: 0 | 1
  delta: number
}

export type PlayerTournamentResult = {
  playerId: string
  before: PlayerRatingState
  after: PlayerRatingState
  /** Rounded change of the rating; 0 for calibrating players. */
  delta: number
  events: EloEvent[]
  /** Set when the player finished calibration in this tournament. */
  calibrated: { rating: number; bestWin: number | null; worstLoss: number | null } | null
}

/**
 * Applies one tournament. Ratings are frozen at the start: E uses the states passed in,
 * so the result does not depend on the order of matches.
 * `bootstrap`: «new city» mode — a calibrating opponent counts with his start level.
 */
export function rateTournament(
  states: ReadonlyMap<string, PlayerRatingState>,
  matches: readonly RatedMatch[],
  options: { params?: EloParams; coefficient?: number; bootstrap?: boolean } = {},
): Map<string, PlayerTournamentResult> {
  const params = options.params ?? DEFAULT_ELO
  const coefficient = options.coefficient ?? 1
  const results = new Map<string, PlayerTournamentResult>()
  const sums = new Map<string, number>()
  const counters = new Map<string, number>()
  const played = new Set<string>()
  const calibration = new Map<string, CalibrationProgress>()

  const stateOf = (id: string): PlayerRatingState => {
    const s = states.get(id)
    if (!s) throw new Error(`elo.unknown_player:${id}`)
    return s
  }
  const ratingForOpponent = (s: PlayerRatingState): number | null =>
    s.rating ?? (options.bootstrap ? s.startLevel : null)

  for (const m of matches) {
    if (!m.rated) continue
    const sa = stateOf(m.a)
    const sb = stateOf(m.b)
    played.add(m.a)
    played.add(m.b)
    for (const [self, other, selfId, otherId, score] of [
      [sa, sb, m.a, m.b, m.winner === 'a' ? 1 : 0],
      [sb, sa, m.b, m.a, m.winner === 'b' ? 1 : 0],
    ] as const) {
      const opponentRating = ratingForOpponent(other)
      if (self.rating == null) {
        // Calibrating: remember the best win and the worst loss against rated opponents.
        if (opponentRating == null) continue
        const c = calibration.get(selfId) ?? { ...self.calibration }
        if (score === 1 && (c.bestWin == null || opponentRating > c.bestWin)) {
          c.bestWin = opponentRating
          c.bestWinMatch = m.id
        }
        if (score === 0 && (c.worstLoss == null || opponentRating < c.worstLoss)) {
          c.worstLoss = opponentRating
          c.worstLossMatch = m.id
        }
        calibration.set(selfId, c)
        continue
      }
      // A match against a calibrating player does not change the rated player's rating.
      if (other.rating == null) continue
      const index = counters.get(selfId) ?? 0
      counters.set(selfId, index + 1)
      const k = kFactor({ ...self, ratedMatches: self.ratedMatches + index }, params)
      const expected = expectedScore(self.rating, other.rating)
      const delta = k * (score - expected) * coefficient
      sums.set(selfId, (sums.get(selfId) ?? 0) + delta)
      const event: EloEvent = {
        matchId: m.id,
        playerId: selfId,
        opponentId: otherId,
        ratingBefore: self.rating,
        opponentRating: other.rating,
        expected,
        k,
        score,
        delta,
      }
      const r = results.get(selfId)
      if (r) r.events.push(event)
      else results.set(selfId, emptyResult(selfId, self, [event]))
    }
  }

  for (const id of played) {
    const before = stateOf(id)
    const result = results.get(id) ?? emptyResult(id, before, [])
    if (before.rating != null) {
      const delta = Math.round(sums.get(id) ?? 0)
      const rating = Math.max(params.floor, before.rating + delta)
      result.delta = rating - before.rating
      result.after = { ...before, rating, ratedMatches: before.ratedMatches + (counters.get(id) ?? 0) }
    } else {
      const c = { ...(calibration.get(id) ?? before.calibration) }
      c.tournaments += 1
      const done = c.tournaments >= params.calibrationTournaments && (c.bestWin != null || c.worstLoss != null)
      if (done) {
        const rating = calibratedRating(c, params)
        result.calibrated = { rating, bestWin: c.bestWin, worstLoss: c.worstLoss }
        result.after = { ...before, rating, source: 'calibration', ratedMatches: 0, calibration: c }
      } else {
        result.after = { ...before, calibration: c }
      }
    }
    results.set(id, result)
  }
  return results
}

function emptyResult(id: string, state: PlayerRatingState, events: EloEvent[]): PlayerTournamentResult {
  return { playerId: id, before: state, after: state, delta: 0, events, calibrated: null }
}

/** R_start = (best win + worst loss) / 2; without wins: worst loss − 100; without losses: best win + 100. */
export function calibratedRating(c: Pick<CalibrationProgress, 'bestWin' | 'worstLoss'>, params: EloParams = DEFAULT_ELO): number {
  let value: number
  if (c.bestWin != null && c.worstLoss != null) value = (c.bestWin + c.worstLoss) / 2
  else if (c.bestWin != null) value = c.bestWin + params.calibrationFallback
  else if (c.worstLoss != null) value = c.worstLoss - params.calibrationFallback
  else throw new Error('elo.no_rated_opponents')
  return Math.max(params.floor, Math.round(value))
}

/** Preliminary change shown during a tournament («+12»): sum of deltas without rounding per match. */
export function preliminaryDelta(results: ReadonlyMap<string, PlayerTournamentResult>, playerId: string): number {
  const r = results.get(playerId)
  return r ? Math.round(r.events.reduce((sum, e) => sum + e.delta, 0)) : 0
}
