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

export type Bracket = { kind: 'single_elim' | 'all_places' | 'minus2' | 'mixed'; size: number; matches: BracketMatch[] }

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

export type PlacesOptions = {
  /**
   * Upper rounds before the final whose losers drop into the lower branch and play on for 3rd place (−2 rule).
   * 1 = only semi-final losers (сетка −1), size − 1 rounds = сетка −2, anything between = смешанная.
   */
  lowerRounds?: number
  /** A player who has lost this many times stops playing and shares the places left (null = all places played). */
  eliminateAfter?: number | null
}

/**
 * Brackets where every place is decided: «сетка −1» (RTTF прил. 11), «сетка −2» (прил. 12) and the mixed one.
 * −1: a loser plays only for the lower half of the places still open (9–16 → 9–12 / 13–16 → …).
 * −2: after the first loss a player goes to the lower branch and can still reach 3rd place; whoever loses there
 * plays the remaining places in −1 sub-blocks. There is no grand final: the lower branch tops out at 3rd.
 * Numbering: main draw first, then the lower branch, then the −1 sub-blocks, latest round first.
 */
export function placesBracket(size: number, options: PlacesOptions = {}): Bracket {
  const rounds = log2(size)
  const lowerRounds = Math.min(Math.max(options.lowerRounds ?? 1, 1), Math.max(rounds - 1, 1))
  const eliminateAfter = options.eliminateAfter ?? null
  const out = (losses: number) => eliminateAfter != null && losses >= eliminateAfter
  const matches: BracketMatch[] = []
  const roundOf = (s: Source) => (s.kind === 'seed' ? 0 : (matches[s.match - 1] as BracketMatch).round)
  const add = (m: Omit<BracketMatch, 'number' | 'round'>): number => {
    const number = matches.length + 1
    matches.push({ ...m, number, round: Math.max(roundOf(m.home), roundOf(m.away)) + 1 })
    return number
  }

  /** −1 block for places from…from + n − 1; `losses` = losses its players already have. */
  const block = (from: number, sources: Source[], losses: number, main = false): Source[][] => {
    const losersByRound: Source[][] = []
    let current = sources
    while (current.length > 1) {
      const players = current.length
      const next: Source[] = []
      const losers: Source[] = []
      for (let i = 0; i < players; i += 2) {
        const m: Omit<BracketMatch, 'number' | 'round'> = {
          placeFrom: from,
          placeTo: from + players - 1,
          stageLabel: main ? roundLabel(players) : 'places',
          home: current[i] as Source,
          away: current[i + 1] as Source,
        }
        if (players === 2) {
          m.winnerPlace = from
          m.loserPlace = from + 1
        } else if (out(losses + 1)) m.loserShared = [from + players / 2, from + players - 1]
        const n = add(m)
        next.push({ kind: 'winner', match: n })
        losers.push({ kind: 'loser', match: n })
      }
      losersByRound.push(losers)
      current = next
    }
    if (!main) subBlocks(losersByRound, from, losersByRound.length - 2, losses)
    return losersByRound
  }
  function subBlocks(losersByRound: Source[][], from: number, upTo: number, losses: number) {
    if (out(losses + 1)) return
    for (let r = upTo; r >= 0; r--) {
      const losers = losersByRound[r] as Source[]
      if (losers.length > 1) block(from + losers.length, losers, losses + 1)
    }
  }

  const main = block(1, seedOrder(size).map((seed) => ({ kind: 'seed', seed })), 0, true)
  const firstLower = rounds - 1 - lowerRounds
  if (!out(1) && rounds >= 2) {
    // Lower branch: pool of earlier drops plays itself (minor round), then meets the next drops (major round).
    const drops = main.slice(firstLower, rounds - 1)
    const future = (k: number) => drops.slice(k).reduce((sum, d) => sum + d.length, 0)
    const loserBlock = (losers: Source[], alive: number) => {
      const from = 3 + alive - losers.length
      if (out(2)) {
        for (const l of losers) (matches[(l as { match: number }).match - 1] as BracketMatch).loserShared = [from, from + losers.length - 1]
      } else if (losers.length > 1) block(from, losers, 2)
    }
    let pool = drops[0] as Source[]
    const round = (pairs: [Source, Source][], alive: number) => {
      const winners: Source[] = []
      const losers: Source[] = []
      for (const [home, away] of pairs) {
        const m: Omit<BracketMatch, 'number' | 'round'> = { placeFrom: 3, placeTo: 2 + alive, stageLabel: 'lower', home, away }
        if (alive === 2) {
          m.winnerPlace = 3
          m.loserPlace = 4
        }
        const n = add(m)
        winners.push({ kind: 'winner', match: n })
        losers.push({ kind: 'loser', match: n })
      }
      if (alive > 2) loserBlock(losers, alive)
      return winners
    }
    for (let k = 1; ; k++) {
      if (pool.length > 1) {
        const pairs: [Source, Source][] = []
        for (let i = 0; i < pool.length; i += 2) pairs.push([pool[i] as Source, pool[i + 1] as Source])
        pool = round(pairs, pool.length + future(k))
      }
      const drop = drops[k]
      if (!drop) break
      const crossed = [...drop].reverse()
      pool = round(pool.map((p, i) => [p, crossed[i] as Source]), pool.length + future(k))
    }
  }
  subBlocks(main, 1, firstLower - 1, 0)
  return { kind: lowerRounds === 1 ? 'all_places' : lowerRounds >= rounds - 1 ? 'minus2' : 'mixed', size, matches }
}

/** «Сетка на все места» = сетка −1: every player gets an exact place and plays log2(size) matches. */
export const allPlaces = (size: number): Bracket => placesBracket(size)

/** Number of matches of a bracket; olympic: S − 1 (+1 for the 3rd-place match). */
export function bracketMatchCount(kind: Bracket['kind'], size: number, thirdPlace: 'match' | 'shared' = 'match', options: PlacesOptions = {}): number {
  if (kind === 'single_elim') return size - 1 + (thirdPlace === 'match' ? 1 : 0)
  if (kind === 'all_places' && options.lowerRounds == null && options.eliminateAfter == null) return (size / 2) * log2(size)
  return placesBracket(size, { ...options, lowerRounds: kind === 'minus2' ? size : options.lowerRounds }).matches.length
}

/** Bracket sizes that are convenient to run (spec): other sizes get a recommendation. */
export const CONVENIENT_BRACKET_SIZES = [2, 4, 8, 16, 24, 32, 48, 64, 128] as const

/** Nearest convenient sizes around `players`, or null when the count is already convenient. */
export function recommendBracketSize(players: number): { lower: number | null; upper: number | null } | null {
  if ((CONVENIENT_BRACKET_SIZES as readonly number[]).includes(players)) return null
  const lower = [...CONVENIENT_BRACKET_SIZES].reverse().find((s) => s < players) ?? null
  const upper = CONVENIENT_BRACKET_SIZES.find((s) => s > players) ?? null
  return { lower, upper }
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
 * `seeds[i]` is the entry with seed i + 1, null for an empty slot (bye), undefined while still unknown
 * (the stage was opened before the group feeding that seed finished).
 * `results` maps a match number to its winner side.
 */
export function resolveBracket(
  bracket: Bracket,
  seeds: readonly (string | null | undefined)[],
  results: ReadonlyMap<number, 'home' | 'away'>,
): ResolvedMatch[] {
  const byNumber = new Map<number, ResolvedMatch>()
  const pending: Slot = { kind: 'pending' }
  const slotOf = (source: Source): Slot => {
    if (source.kind === 'seed') {
      const id = seeds[source.seed - 1]
      if (id === undefined && source.seed <= seeds.length) return pending
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
