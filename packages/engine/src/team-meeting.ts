// Team meeting (spec 4.11, D-5…D-7): a scheme of singles/doubles games between line-up slots,
// played until one team reaches «first to N» (or all games with play-all).

import type { GameScore } from './scoring.ts'

export type MeetingGameSpec = { kind: 'singles' | 'doubles'; home: number[]; away: number[] }

export type MeetingScheme = {
  id: string
  name: string
  /** Line-up slots per team (A, B, C… / X, Y, Z…). */
  slots: number
  games: MeetingGameSpec[]
  firstTo: number
  playAll: boolean
  tables: 1 | 2
}

const s = (h: number, a: number): MeetingGameSpec => ({ kind: 'singles', home: [h], away: [a] })

export const MEETING_SCHEMES: Record<'wc' | 'olympic' | 'swaythling', MeetingScheme> = {
  // A-X, B-Y, C-Z, A-Y, B-X
  wc: { id: 'wc', name: 'Формат ЧМ', slots: 3, games: [s(0, 0), s(1, 1), s(2, 2), s(0, 1), s(1, 0)], firstTo: 3, playAll: false, tables: 1 },
  // BC-YZ, A-X, C-Z, A-Y, B-X
  olympic: {
    id: 'olympic',
    name: 'Олимпийская',
    slots: 3,
    games: [{ kind: 'doubles', home: [1, 2], away: [1, 2] }, s(0, 0), s(2, 2), s(0, 1), s(1, 0)],
    firstTo: 3,
    playAll: false,
    tables: 1,
  },
  swaythling: {
    id: 'swaythling',
    name: 'Свэтлинг',
    slots: 3,
    games: [s(0, 0), s(1, 1), s(2, 2), s(1, 0), s(0, 2), s(2, 1), s(1, 2), s(2, 0), s(0, 1)],
    firstTo: 5,
    playAll: false,
    tables: 1,
  },
}

export function validateScheme(scheme: MeetingScheme): string[] {
  const errors: string[] = []
  if (scheme.slots < 1 || scheme.slots > 8) errors.push('scheme.slots')
  if (!scheme.games.length) errors.push('scheme.no_games')
  if (scheme.firstTo < 1 || scheme.firstTo * 2 - 1 > scheme.games.length) errors.push('scheme.first_to')
  scheme.games.forEach((g, i) => {
    const size = g.kind === 'singles' ? 1 : 2
    if (g.home.length !== size || g.away.length !== size) errors.push(`scheme.game_size:${i + 1}`)
    if ([...g.home, ...g.away].some((x) => x < 0 || x >= scheme.slots)) errors.push(`scheme.slot:${i + 1}`)
    if (new Set(g.home).size !== g.home.length || new Set(g.away).size !== g.away.length) errors.push(`scheme.duplicate:${i + 1}`)
  })
  return errors
}

/** Line-up = player id per slot. Every slot filled, players unique, all from the roster. */
export function validateLineup(scheme: MeetingScheme, lineup: readonly number[], roster: readonly number[]): string[] {
  if (lineup.length !== scheme.slots) return ['lineup.size']
  if (new Set(lineup).size !== lineup.length) return ['lineup.duplicate']
  if (lineup.some((p) => !roster.includes(p))) return ['lineup.not_in_roster']
  return []
}

export type MeetingGame = { index: number; kind: 'singles' | 'doubles'; home: number[]; away: number[] }

export function meetingGames(scheme: MeetingScheme, home: readonly number[], away: readonly number[]): MeetingGame[] {
  return scheme.games.map((g, index) => ({ index, kind: g.kind, home: g.home.map((i) => home[i]!), away: g.away.map((i) => away[i]!) }))
}

export type MeetingState = {
  home: number
  away: number
  /** Winner decided by «first to N». */
  winner: 'home' | 'away' | null
  /** All games that still have to be played are done. */
  finished: boolean
  /** Indexes of games that will not be played. */
  skipped: number[]
}

/** Score of a meeting from game winners in scheme order (null = not played yet). */
export function meetingScore(scheme: Pick<MeetingScheme, 'firstTo' | 'playAll' | 'games'>, winners: readonly ('home' | 'away' | null)[]): MeetingState {
  let home = 0
  let away = 0
  let decidedAt = -1
  for (let i = 0; i < scheme.games.length; i++) {
    const w = winners[i]
    if (w === 'home') home++
    if (w === 'away') away++
    if (decidedAt < 0 && (home >= scheme.firstTo || away >= scheme.firstTo)) decidedAt = i
  }
  const winner = home >= scheme.firstTo ? 'home' : away >= scheme.firstTo ? 'away' : null
  const skipped = winner && !scheme.playAll ? scheme.games.map((_, i) => i).filter((i) => i > decidedAt && winners[i] == null) : []
  const finished = winner != null && scheme.games.every((_, i) => winners[i] != null || skipped.includes(i))
  return { home, away, winner, finished, skipped }
}

/**
 * Team group tie-breaks: meeting points → games ratio → sets ratio. The meeting is stored as a match whose
 * «sets» are games won and whose «game points» are the sets of each game, so the regular standings
 * (h2h_points, h2h_sets_ratio, h2h_points_ratio) rank teams by exactly these criteria.
 */
export const meetingTiebreakGames = (games: readonly { setsHome: number; setsAway: number }[]): GameScore[] =>
  games.map((g) => ({ home: g.setsHome, away: g.setsAway }))
