// Realistic random match results, used for dev data and engine tests only.

import { expectedScore } from './elo.ts'
import type { Rng } from './random.ts'
import { completeGame } from './scoring.ts'
import type { GameScore, MatchRules, Side } from './scoring.ts'

/** Plays a match between two "true strength" values: each game is won with a probability close to Elo E. */
export function simulateMatch(
  strengthHome: number,
  strengthAway: number,
  rules: Pick<MatchRules, 'winsNeeded' | 'pointsToWin'>,
  rng: Rng,
): { winner: Side; setsHome: number; setsAway: number; games: GameScore[] } {
  // Per-game probability is softer than the match probability, so upsets happen.
  const pGame = 0.5 + (expectedScore(strengthHome, strengthAway) - 0.5) * 0.75
  let h = 0
  let a = 0
  const games: GameScore[] = []
  while (h < rules.winsNeeded && a < rules.winsNeeded) {
    const winner: Side = rng() < pGame ? 'home' : 'away'
    const r = rng()
    const loserPoints = r < 0.15 ? 10 + Math.floor(rng() * 3) : Math.floor(3 + rng() * 7)
    games.push(completeGame(winner, loserPoints, rules.pointsToWin))
    if (winner === 'home') h++
    else a++
  }
  return { winner: h > a ? 'home' : 'away', setsHome: h, setsAway: a, games }
}
