// Knock-out brackets: olympic (single elimination) and «сетка на все места» (spec 4.6).
//
// A bracket is a list of matches whose two sides come from a seed, or from the
// winner / loser of an earlier match. Match numbers are sequential inside the
// bracket (they are shifted by the tournament when several stages exist):
// in a 16-player all-places bracket the main draw is № 1–15, then the blocks
// 3..4, 5..8, 5..6, 7..8, 9..16, 9..12, 9..10, 11..12, 13..16, 13..14, 15..16.

export type Source = { kind: 'seed'; seed: number } | { kind: 'winner'; match: number } | { kind: 'loser'; match: number }

export type BracketMatch = {
  number: number
  /** Playing round: 1 = first round; losers of round r play their next match in round r + 1. */
  round: number
  /** Places this match is played for, e.g. [5, 8] for the first match of the 5..8 block. */
  placeFrom: number
  placeTo: number
  /** Round name in the main draw: '1/8', '1/4', '1/2', 'final', 'third_place'; or 'places' in sub-blocks. */
  stageLabel: string
  home: Source
  away: Source
  /** Place given to the winner / loser when this match decides it. */
  winnerPlace?: number
  loserPlace?: number
  /** Shared place range for losers (olympic bracket without placement matches). */
  loserShared?: [number, number]
}

export type Bracket = { kind: 'single_elim' | 'all_places'; size: number; matches: BracketMatch[] }

export const isPowerOfTwo = (n: number): boolean => n >= 2 && (n & (n - 1)) === 0
export const bracketSizeFor = (players: number): number => {
  let size = 2
  while (size < players) size *= 2
  return size
}
const log2 = (n: number) => Math.round(Math.log2(n))

/**
 * Seed order of the first round, as in the spec for 16: 1–16, 9–8, 5–12, 13–4, 3–14, 11–6, 7–10, 15–2.
 * Seeds 1 and 2 can meet only in the final, 3 and 4 are in different halves.
 */
export function seedOrder(size: number): number[] {
  if (!isPowerOfTwo(size)) throw new Error('bracket.size_not_power_of_two')
  let order = [1, 2]
  while (order.length < size) {
    const n = order.length * 2
    order = order.flatMap((seed, i) => (i % 2 === 0 ? [seed, n + 1 - seed] : [n + 1 - seed, seed]))
  }
  return order
}

function roundLabel(playersInRound: number): string {
  if (playersInRound === 2) return 'final'
  return `1/${playersInRound / 2}`
}

/** Olympic bracket; `thirdPlace`: 'match' plays for 3rd, 'shared' gives both semi-final losers 3rd. */
export function singleElimination(size: number, thirdPlace: 'match' | 'shared' = 'match'): Bracket {
  const order = seedOrder(size)
  const matches: BracketMatch[] = []
  let current: Source[] = order.map((seed) => ({ kind: 'seed', seed }))
  let round = 1
  let semis: number[] = []
  while (current.length > 1) {
    const players = current.length
    const next: Source[] = []
    const roundMatches: BracketMatch[] = []
    for (let i = 0; i < players; i += 2) {
      const match: BracketMatch = {
        number: 0,
        round,
        placeFrom: 1,
        placeTo: players,
        stageLabel: roundLabel(players),
        home: current[i] as Source,
        away: current[i + 1] as Source,
      }
      if (players === 2) {
        match.winnerPlace = 1
        match.loserPlace = 2
      } else if (players === 4 && thirdPlace === 'match') {
        // losers go to the third-place match
      } else {
        match.loserShared = [players / 2 + 1, players]
        if (players === 4) match.loserShared = [3, 4]
      }
      roundMatches.push(match)
    }
    if (players === 4) semis = []
    for (const match of roundMatches) {
      match.number = matches.length + 1
      matches.push(match)
      next.push({ kind: 'winner', match: match.number })
      if (players === 4) semis.push(match.number)
    }
    if (players === 4 && thirdPlace === 'match') {
      // Third-place match is numbered before the final.
      matches.push({
        number: matches.length + 1,
        round: round + 1,
        placeFrom: 3,
        placeTo: 4,
        stageLabel: 'third_place',
        home: { kind: 'loser', match: semis[0] as number },
        away: { kind: 'loser', match: semis[1] as number },
        winnerPlace: 3,
        loserPlace: 4,
      })
    }
    current = next
    round++
  }
  return { kind: 'single_elim', size, matches }
}

/**
 * «Сетка на все места»: losers do not drop out but play for the next places in sub-blocks,
 * every player gets an exact place and plays log2(size) matches.
 */
export function allPlaces(size: number): Bracket {
  const matches: BracketMatch[] = []
  const order = seedOrder(size)

  const block = (from: number, sources: Source[], startRound: number) => {
    const total = sources.length
    const roundsInBlock = log2(total)
    const losersByRound: Source[][] = []
    let current = sources
    for (let r = 0; r < roundsInBlock; r++) {
      const players = current.length
      const next: Source[] = []
      const losers: Source[] = []
      for (let i = 0; i < players; i += 2) {
        const match: BracketMatch = {
          number: matches.length + 1,
          round: startRound + r,
          placeFrom: from,
          placeTo: from + players - 1,
          stageLabel: from === 1 ? roundLabel(players) : 'places',
          home: current[i] as Source,
          away: current[i + 1] as Source,
        }
        if (players === 2) {
          match.winnerPlace = from
          match.loserPlace = from + 1
        }
        matches.push(match)
        next.push({ kind: 'winner', match: match.number })
        losers.push({ kind: 'loser', match: match.number })
      }
      losersByRound.push(losers)
      current = next
    }
    // Loser blocks, latest round first: semi-final losers (3..4), then quarter-final losers (5..8), …
    for (let r = roundsInBlock - 2; r >= 0; r--) {
      const losers = losersByRound[r] as Source[]
      block(from + losers.length, losers, startRound + r + 1)
    }
  }

  block(
    1,
    order.map((seed) => ({ kind: 'seed', seed })),
    1,
  )
  return { kind: 'all_places', size, matches }
}

/** Number of matches the spec formulas give: S/2·log2 S, olympic S − 1 (+1 for the 3rd-place match). */
export function bracketMatchCount(kind: Bracket['kind'], size: number, thirdPlace: 'match' | 'shared' = 'match'): number {
  if (kind === 'all_places') return (size / 2) * log2(size)
  return size - 1 + (thirdPlace === 'match' ? 1 : 0)
}

// ---------------------------------------------------------------------------
// Resolving: who plays in every match given seeds and results.

export type Slot = { kind: 'entry'; id: string } | { kind: 'bye' } | { kind: 'pending' }

export type ResolvedMatch = BracketMatch & {
  homeSlot: Slot
  awaySlot: Slot
  /** waiting = a side is unknown; ready = both players known; bye = one side is empty (no game, not rated). */
  state: 'waiting' | 'ready' | 'bye' | 'done'
  winner: Slot
  loser: Slot
}

/**
 * `seeds[i]` is the entry with seed i + 1, null for an empty slot (bye).
 * `results` maps a match number to its winner side.
 */
export function resolveBracket(
  bracket: Bracket,
  seeds: readonly (string | null)[],
  results: ReadonlyMap<number, 'home' | 'away'>,
): ResolvedMatch[] {
  const byNumber = new Map<number, ResolvedMatch>()
  const pending: Slot = { kind: 'pending' }
  const slotOf = (source: Source): Slot => {
    if (source.kind === 'seed') {
      const id = seeds[source.seed - 1]
      return id ? { kind: 'entry', id } : { kind: 'bye' }
    }
    const m = byNumber.get(source.match)
    if (!m) return pending
    return source.kind === 'winner' ? m.winner : m.loser
  }
  for (const match of bracket.matches) {
    const homeSlot = slotOf(match.home)
    const awaySlot = slotOf(match.away)
    let state: ResolvedMatch['state'] = 'waiting'
    let winner: Slot = pending
    let loser: Slot = pending
    if (homeSlot.kind === 'bye' || awaySlot.kind === 'bye') {
      if (homeSlot.kind !== 'pending' && awaySlot.kind !== 'pending') {
        state = 'bye'
        const homeIsBye = homeSlot.kind === 'bye'
        winner = homeIsBye ? awaySlot : homeSlot
        loser = homeIsBye ? homeSlot : awaySlot
      }
    } else if (homeSlot.kind === 'entry' && awaySlot.kind === 'entry') {
      const result = results.get(match.number)
      if (result) {
        state = 'done'
        winner = result === 'home' ? homeSlot : awaySlot
        loser = result === 'home' ? awaySlot : homeSlot
      } else {
        state = 'ready'
      }
    }
    byNumber.set(match.number, { ...match, homeSlot, awaySlot, state, winner, loser })
  }
  return bracket.matches.map((m) => byNumber.get(m.number) as ResolvedMatch)
}

export type BracketPlace = { id: string; place: number; placeTo: number }

/**
 * Final places of real entries. Empty slots do not take places: places go 1…number of players.
 * Shared places (olympic without placement matches) are returned as place..placeTo.
 */
export function bracketPlaces(resolved: readonly ResolvedMatch[]): BracketPlace[] {
  const raw = new Map<string, [number, number]>()
  for (const m of resolved) {
    if (m.state !== 'done' && m.state !== 'bye') continue
    if (m.winnerPlace != null && m.winner.kind === 'entry') raw.set(m.winner.id, [m.winnerPlace, m.winnerPlace])
    if (m.loserPlace != null && m.loser.kind === 'entry') raw.set(m.loser.id, [m.loserPlace, m.loserPlace])
    if (m.loserShared && m.loser.kind === 'entry') raw.set(m.loser.id, m.loserShared)
  }
  const list = [...raw.entries()].sort((a, b) => a[1][0] - b[1][0])
  return list.map(([id, [from]]) => {
    const better = list.filter(([, [f]]) => f < from).length
    const same = list.filter(([, [f]]) => f === from).length
    return { id, place: better + 1, placeTo: better + same }
  })
}
