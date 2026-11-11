// Match and game score rules (spec 4.4 M-5, 4.6 «Правила ввода счёта»).

export type Side = 'home' | 'away'
export type GameScore = { home: number; away: number }

export type MatchRules = {
  /** Games needed to win the match: 2, 3 or 4 (best of 3, 5 or 7). */
  winsNeeded: number
  /** Points to win a game, 11 by default (win by 2). */
  pointsToWin: number
  /** Game points entry: not needed / optional (default) / required. */
  gamePoints: 'none' | 'optional' | 'required'
}

export const DEFAULT_MATCH_RULES: MatchRules = { winsNeeded: 3, pointsToWin: 11, gamePoints: 'optional' }

export type MatchScore = {
  setsHome: number
  setsAway: number
  /** Points of every game in order; empty when game points were not entered. */
  games: GameScore[]
}

/** Returns an error code, or null when the game score is possible. */
export function validateGame(game: GameScore, pointsToWin = 11): string | null {
  const { home, away } = game
  if (!Number.isInteger(home) || !Number.isInteger(away) || home < 0 || away < 0) return 'game.invalid_number'
  const win = Math.max(home, away)
  const lose = Math.min(home, away)
  if (win < pointsToWin) return 'game.not_finished'
  if (lose >= pointsToWin - 1) {
    if (win - lose !== 2) return 'game.deuce_needs_two'
  } else if (win !== pointsToWin) {
    return 'game.too_many_points'
  }
  return null
}

export const gameWinner = (game: GameScore): Side => (game.home > game.away ? 'home' : 'away')

/**
 * Quick entry: the helper picks the game winner and types the loser's points,
 * the winner's points are filled in (11, or loser + 2 after deuce).
 */
export function completeGame(winner: Side, loserPoints: number, pointsToWin = 11): GameScore {
  const winnerPoints = Math.max(pointsToWin, loserPoints + 2)
  return winner === 'home' ? { home: winnerPoints, away: loserPoints } : { home: loserPoints, away: winnerPoints }
}

/** Validates a finished match score; returns a list of error codes (empty = valid). */
export function validateMatchScore(score: MatchScore, rules: MatchRules = DEFAULT_MATCH_RULES): string[] {
  const errors: string[] = []
  const { setsHome, setsAway, games } = score
  const w = rules.winsNeeded
  if (!Number.isInteger(setsHome) || !Number.isInteger(setsAway)) return ['match.invalid_sets']
  if (Math.max(setsHome, setsAway) !== w || Math.min(setsHome, setsAway) >= w) errors.push('match.sets_not_final')
  if (rules.gamePoints === 'required' && games.length === 0) errors.push('match.game_points_required')
  if (games.length > 0) {
    if (games.length !== setsHome + setsAway) errors.push('match.games_count_mismatch')
    let h = 0
    let a = 0
    games.forEach((game, index) => {
      const err = validateGame(game, rules.pointsToWin)
      if (err) errors.push(`${err}:${index + 1}`)
      if (h === w || a === w) errors.push(`match.extra_game:${index + 1}`)
      if (gameWinner(game) === 'home') h++
      else a++
    })
    if (h !== setsHome || a !== setsAway) errors.push('match.games_do_not_match_sets')
  }
  return errors
}

export function matchWinner(score: Pick<MatchScore, 'setsHome' | 'setsAway'>): Side {
  return score.setsHome > score.setsAway ? 'home' : 'away'
}

/** Walkover score: «всухую по формату матча», e.g. 3:0 for best of 5. */
export function walkoverScore(winner: Side, rules: MatchRules = DEFAULT_MATCH_RULES): MatchScore {
  return winner === 'home'
    ? { setsHome: rules.winsNeeded, setsAway: 0, games: [] }
    : { setsHome: 0, setsAway: rules.winsNeeded, games: [] }
}
