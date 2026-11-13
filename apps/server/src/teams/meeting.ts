// Team meeting on the server: blind line-ups (10 minutes after the call, then only the organiser),
// games built from the scheme, per-game calls and results; the finished meeting closes the parent match.

import { MEETING_SCHEMES, meetingGames, meetingScore, meetingTiebreakGames, validateLineup, validateMatchScore } from '@nomad/engine'
import type { GameScore, MeetingScheme } from '@nomad/engine'
import type { Transaction } from '../db/index.ts'
import { json } from '../db/index.ts'
import type { Database, Match, Tournament } from '../db/types.ts'
import { audit } from '../audit.ts'
import { badRequest, conflict, notFound, unprocessable } from '../http/errors.ts'
import { notify } from '../notify/index.ts'
import { playerName } from '../modules/players.ts'
import { recordResult, rulesOfMatch } from '../tournaments/structure.ts'

type Trx = Transaction<Database>
type Side = 'home' | 'away'

export const LINEUP_MINUTES = 10

export const schemeOf = (t: Pick<Tournament, 'settings'>): MeetingScheme => t.settings.meeting ?? MEETING_SCHEMES.wc

export async function loadMeeting(trx: Trx, t: Tournament, matchId: number): Promise<Match> {
  const m = await trx.selectFrom('matches').selectAll().where('id', '=', matchId).executeTakeFirst()
  if (!m || m.tournament_id !== t.id) throw notFound('match.not_found')
  if (t.type !== 'team') throw badRequest('meeting.not_team_tournament')
  return m
}

async function rosterOf(trx: Trx, entryId: number | null): Promise<number[]> {
  if (!entryId) return []
  return (await trx.selectFrom('entries').select('roster').where('id', '=', entryId).executeTakeFirstOrThrow()).roster ?? []
}

/** Side of the match the player captains, if any. */
export async function captainSide(trx: Trx, m: Match, playerId: number | null): Promise<Side | null> {
  if (!playerId) return null
  const rows = await trx
    .selectFrom('entries as e')
    .innerJoin('teams as tm', 'tm.id', 'e.team_id')
    .select(['e.id'])
    .where('e.id', 'in', [m.home_entry_id ?? 0, m.away_entry_id ?? 0])
    .where('tm.captain_player_id', '=', playerId)
    .execute()
  if (rows.some((r) => r.id === m.home_entry_id)) return 'home'
  if (rows.some((r) => r.id === m.away_entry_id)) return 'away'
  return null
}

export const lineupDeadline = (m: Pick<Match, 'called_at'>): Date | null => (m.called_at ? new Date(m.called_at.getTime() + LINEUP_MINUTES * 60000) : null)

export async function submitLineup(trx: Trx, t: Tournament, m: Match, side: Side, lineup: number[], actor: { userId: number; byOrganizer: boolean }, now = new Date()) {
  if (!['scheduled', 'called', 'playing'].includes(m.status)) throw conflict('match.not_playable')
  const scheme = schemeOf(t)
  const errors = validateLineup(scheme, lineup, await rosterOf(trx, side === 'home' ? m.home_entry_id : m.away_entry_id))
  if (errors.length) throw unprocessable('meeting.invalid_lineup', errors)
  const existing = await trx.selectFrom('meeting_lineups').select('side').where('match_id', '=', m.id).where('side', '=', side).executeTakeFirst()
  if (!actor.byOrganizer) {
    if (existing) throw conflict('meeting.lineup_already_submitted')
    const deadline = lineupDeadline(m)
    if (deadline && now > deadline) throw conflict('meeting.lineup_deadline_passed')
  }
  const started = await trx.selectFrom('meeting_games').select('id').where('match_id', '=', m.id).where('status', '<>', 'scheduled').executeTakeFirst()
  if (started) throw conflict('meeting.already_started')
  await trx
    .insertInto('meeting_lineups')
    .values({ match_id: m.id, side, lineup, submitted_by: actor.userId, by_organizer: actor.byOrganizer })
    .onConflict((oc) => oc.columns(['match_id', 'side']).doUpdateSet({ lineup, submitted_by: actor.userId, by_organizer: actor.byOrganizer, submitted_at: now }))
    .execute()
  await audit({ actorUserId: actor.userId, clubId: t.club_id, entity: 'match', entityId: m.id, action: 'lineup', after: { side, byOrganizer: actor.byOrganizer } }, trx)
  const lineups = await trx.selectFrom('meeting_lineups').selectAll().where('match_id', '=', m.id).execute()
  const home = lineups.find((l) => l.side === 'home')
  const away = lineups.find((l) => l.side === 'away')
  if (!home || !away) return { revealed: false }
  await trx.deleteFrom('meeting_games').where('match_id', '=', m.id).execute()
  await trx
    .insertInto('meeting_games')
    .values(meetingGames(scheme, home.lineup, away.lineup).map((g) => ({ match_id: m.id, game_index: g.index, kind: g.kind, home_players: g.home, away_players: g.away })))
    .execute()
  if (m.status !== 'playing') await trx.updateTable('matches').set({ status: 'playing', started_at: now, version: m.version + 1 }).where('id', '=', m.id).execute()
  return { revealed: true }
}

export async function meetingView(trx: Trx, t: Tournament, m: Match, viewer: { staff: boolean; side: Side | null }) {
  const scheme = schemeOf(t)
  const lineups = await trx.selectFrom('meeting_lineups').selectAll().where('match_id', '=', m.id).execute()
  const games = await trx.selectFrom('meeting_games').selectAll().where('match_id', '=', m.id).orderBy('game_index').execute()
  const revealed = lineups.length === 2
  const ids = new Set<number>([...(await rosterOf(trx, m.home_entry_id)), ...(await rosterOf(trx, m.away_entry_id))])
  const players = ids.size ? await trx.selectFrom('players').select(['id', 'first_name', 'last_name']).where('id', 'in', [...ids]).execute() : []
  const name = (id: number) => {
    const p = players.find((x) => x.id === id)
    return p ? playerName(p) : String(id)
  }
  const sideView = async (side: Side) => {
    const l = lineups.find((x) => x.side === side)
    const visible = revealed || viewer.staff || viewer.side === side
    return {
      roster: (await rosterOf(trx, side === 'home' ? m.home_entry_id : m.away_entry_id)).map((id) => ({ id, name: name(id) })),
      submitted: Boolean(l),
      byOrganizer: l?.by_organizer ?? false,
      lineup: l && visible ? l.lineup.map((id) => ({ id, name: name(id) })) : null,
    }
  }
  const state = meetingScore(scheme, scheme.games.map((_, i) => games.find((g) => g.game_index === i)?.winner ?? null))
  return {
    matchId: m.id,
    status: m.status,
    scheme,
    deadline: lineupDeadline(m),
    mySide: viewer.side,
    home: await sideView('home'),
    away: await sideView('away'),
    score: { home: state.home, away: state.away, winner: state.winner, finished: state.finished },
    games: games.map((g) => ({
      index: g.game_index,
      kind: g.kind,
      status: g.status,
      home: g.home_players.map((id) => ({ id, name: name(id) })),
      away: g.away_players.map((id) => ({ id, name: name(id) })),
      tableId: g.table_id,
      setsHome: g.sets_home,
      setsAway: g.sets_away,
      games: g.games,
      winner: g.winner,
    })),
  }
}

async function gameOf(trx: Trx, matchId: number, index: number) {
  const g = await trx.selectFrom('meeting_games').selectAll().where('match_id', '=', matchId).where('game_index', '=', index).forUpdate().executeTakeFirst()
  if (!g) throw notFound('meeting.game_not_found')
  return g
}

/** Per-game call (reuses the match_call notification): one or two tables of the tournament. */
export async function callGame(trx: Trx, t: Tournament, m: Match, index: number, tableId: number | null, actorUserId: number) {
  const g = await gameOf(trx, m.id, index)
  if (g.status !== 'scheduled') throw conflict('match.not_callable', { status: g.status })
  const scheme = schemeOf(t)
  const allowed = t.table_ids.slice(0, Math.max(1, scheme.tables))
  const pool = m.table_id ? [m.table_id, ...allowed.filter((x) => x !== m.table_id)].slice(0, scheme.tables) : allowed
  const busy = await trx.selectFrom('meeting_games').select('table_id').where('match_id', '=', m.id).where('status', '=', 'called').execute()
  const table = tableId ?? pool.find((x) => !busy.some((b) => b.table_id === x)) ?? null
  if (table == null) throw conflict('match.no_free_table')
  if (!t.table_ids.includes(table)) throw badRequest('match.table_not_in_tournament')
  const players = [...g.home_players, ...g.away_players]
  const playing = await trx
    .selectFrom('meeting_games')
    .select(['home_players', 'away_players'])
    .where('match_id', '=', m.id)
    .where('status', '=', 'called')
    .execute()
  if (playing.some((p) => [...p.home_players, ...p.away_players].some((x) => players.includes(x)))) throw conflict('match.player_busy')
  await trx.updateTable('meeting_games').set({ status: 'called', table_id: table, called_at: new Date() }).where('id', '=', g.id).execute()
  const number = (await trx.selectFrom('hall_tables').select('number').where('id', '=', table).executeTakeFirstOrThrow()).number
  const rows = await trx.selectFrom('players').select(['id', 'user_id', 'first_name', 'last_name']).where('id', 'in', players).execute()
  for (const p of rows) {
    if (!p.user_id) continue
    const opp = (g.home_players.includes(p.id) ? g.away_players : g.home_players).map((id) => rows.find((r) => r.id === id)).filter(Boolean)
    await notify({ userId: p.user_id, type: 'match_call', urgent: true, data: { tournamentId: t.id, slug: t.slug, title: t.title, matchId: m.id, game: index + 1, table: number, opponent: opp.map((o) => playerName(o!)).join(' / ') } }, trx)
  }
  await audit({ actorUserId, clubId: t.club_id, entity: 'meeting_game', entityId: g.id, action: 'call', after: { tableId: table } }, trx)
  return { tableId: table }
}

export async function recordGame(trx: Trx, t: Tournament, m: Match, index: number, score: { setsHome: number; setsAway: number; games: GameScore[] }, actorUserId: number | null) {
  if (!['scheduled', 'called', 'playing'].includes(m.status)) throw conflict('match.not_playable')
  const g = await gameOf(trx, m.id, index)
  if (g.status === 'finished' || g.status === 'skipped') throw conflict('match.already_recorded')
  const errors = validateMatchScore(score, await rulesOfMatch(trx, t.format, m))
  if (errors.length) throw unprocessable('match.invalid_score', errors)
  const winner: Side = score.setsHome > score.setsAway ? 'home' : 'away'
  await trx
    .updateTable('meeting_games')
    .set({ status: 'finished', sets_home: score.setsHome, sets_away: score.setsAway, games: json(score.games), winner, finished_at: new Date() })
    .where('id', '=', g.id)
    .execute()
  await audit({ actorUserId, clubId: t.club_id, entity: 'meeting_game', entityId: g.id, action: 'result', after: score }, trx)
  const games = await trx.selectFrom('meeting_games').selectAll().where('match_id', '=', m.id).orderBy('game_index').execute()
  const scheme = schemeOf(t)
  const state = meetingScore(scheme, scheme.games.map((_, i) => games.find((x) => x.game_index === i)?.winner ?? null))
  if (state.skipped.length) await trx.updateTable('meeting_games').set({ status: 'skipped' }).where('match_id', '=', m.id).where('game_index', 'in', state.skipped).execute()
  if (state.finished) {
    const played = games.filter((x) => x.status === 'finished' || x.game_index === index)
    await recordResult(trx, m.id, { setsHome: state.home, setsAway: state.away, games: meetingTiebreakGames(played.map((x) => ({ setsHome: x.sets_home ?? 0, setsAway: x.sets_away ?? 0 }))), teamMeeting: true }, actorUserId)
  }
  return { home: state.home, away: state.away, finished: state.finished }
}

/** Worker: line-ups still missing 10 minutes after the call — the organiser decides (one notice per match). */
export async function lineupOverdue(trx: Trx, now = new Date()): Promise<number> {
  const rows = await trx
    .selectFrom('matches as m')
    .innerJoin('tournaments as t', 't.id', 'm.tournament_id')
    .select(['m.id', 'm.called_at', 'm.number', 't.id as tournament_id', 't.club_id', 't.slug', 't.title'])
    .where('t.type', '=', 'team')
    .where('t.status', '=', 'running')
    .where('m.status', '=', 'called')
    .where('m.called_at', '<', new Date(now.getTime() - LINEUP_MINUTES * 60000))
    .execute()
  let sent = 0
  for (const r of rows) {
    const n = await trx.selectFrom('meeting_lineups').select((eb) => eb.fn.countAll<number>().as('n')).where('match_id', '=', r.id).executeTakeFirstOrThrow()
    if (Number(n.n) >= 2) continue
    const key = `lineup_overdue:${r.id}`
    const fresh = await trx.insertInto('notification_dedupe').values({ key }).onConflict((oc) => oc.column('key').doNothing()).returning('key').executeTakeFirst()
    if (!fresh) continue
    const staff = await trx.selectFrom('club_members').select('user_id').where('club_id', '=', r.club_id).where((eb) => eb.or([eb('role', '=', 'organizer'), eb(eb.val('conduct'), '=', eb.fn.any('rights'))])).execute()
    for (const s of staff) await notify({ userId: s.user_id, type: 'lineup_overdue', urgent: true, data: { tournamentId: r.tournament_id, slug: r.slug, title: r.title, matchId: r.id, text: `Встреча №${r.number}: расстановка не подана, решает организатор` } }, trx)
    sent++
  }
  return sent
}
