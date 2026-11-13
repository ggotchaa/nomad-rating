// Running a tournament (M-1…M-8): tables screen, calls with player answers, special situations,
// corrections, early finish, players-enter-score mode (M-5).

import { Router } from 'express'
import type { Request } from 'express'
import { z } from 'zod'
import { matchRulesFor, validateMatchScore } from '@nomad/engine'
import { db, json } from '../db/index.ts'
import type { CallAnswer, CallResponses, Match, Tournament } from '../db/types.ts'
import { audit } from '../audit.ts'
import { requireClubRight, requireUser } from '../auth/access.ts'
import { badRequest, conflict, forbidden, handler, notFound, unprocessable } from '../http/errors.ts'
import { intParam, parseBody } from '../http/validate.ts'
import { notify } from '../notify/index.ts'
import { bus } from '../realtime/bus.ts'
import { conductState } from '../tournaments/queue.ts'
import { correctResult, finishTournament, recordResult, rulesOfMatch, withdrawEntry } from '../tournaments/structure.ts'
import { playerName } from './players.ts'

export const conductRouter = Router()
export const myCallsRouter = Router()

async function staffTournament(req: Request) {
  const id = intParam(req, 'id')
  const t = await db.selectFrom('tournaments').selectAll().where('id', '=', id).executeTakeFirst()
  if (!t) throw notFound('tournament.not_found')
  const user = await requireClubRight(req, t.club_id, 'conduct', { tournamentId: id, hallId: t.hall_id })
  return { t, user }
}

async function matchOf(t: Tournament, matchId: number): Promise<Match> {
  const m = await db.selectFrom('matches').selectAll().where('id', '=', matchId).executeTakeFirst()
  if (!m || m.tournament_id !== t.id) throw notFound('match.not_found')
  return m
}

const changed = (tournamentId: number, matchId?: number) => bus.publish(`tournament:${tournamentId}`, 'match.updated', { tournamentId, matchId })

const scoreSchema = z.object({
  setsHome: z.number().int().min(0).max(4),
  setsAway: z.number().int().min(0).max(4),
  games: z.array(z.object({ home: z.number().int().min(0), away: z.number().int().min(0) })).max(7).default([]),
  resultType: z.enum(['normal', 'walkover', 'retired']).default('normal'),
  winner: z.enum(['home', 'away']).optional(),
})

conductRouter.get(
  '/:id/conduct',
  handler(async (req, res) => {
    const { t } = await staffTournament(req)
    res.json({
      tournament: { id: t.id, slug: t.slug, title: t.title, status: t.status, startsAt: t.starts_at, settings: t.settings, match: t.format.match, restMinutes: t.settings.restMinutes ?? t.format.restMinutes, minParticipants: t.min_participants },
      ...(await conductState(t)),
    })
  }),
)

/** Players of a match with their user accounts (for notifications). */
async function sides(m: Pick<Match, 'home_entry_id' | 'away_entry_id'>) {
  const rows = await db
    .selectFrom('entries as e')
    .innerJoin('players as p', 'p.id', 'e.player_id')
    .select(['e.id', 'p.id as player_id', 'p.user_id', 'p.first_name', 'p.last_name'])
    .where('e.id', 'in', [m.home_entry_id ?? 0, m.away_entry_id ?? 0])
    .execute()
  const home = rows.find((r) => r.id === m.home_entry_id)
  const away = rows.find((r) => r.id === m.away_entry_id)
  return { home, away }
}

async function sendCall(t: Tournament, m: Match, tableNumber: number, repeat = false) {
  const { home, away } = await sides(m)
  for (const [me, opponent, side] of [[home, away, 'home'], [away, home, 'away']] as const) {
    if (!me?.user_id) continue
    await notify({
      userId: me.user_id,
      type: 'match_call',
      urgent: true,
      data: { tournamentId: t.id, slug: t.slug, title: t.title, matchId: m.id, table: tableNumber, opponent: opponent ? playerName(opponent) : null, side, repeat },
    })
  }
}

/** Call to a table (M-3): the table is free, both players are not busy elsewhere. */
conductRouter.post(
  '/:id/matches/:matchId/call',
  handler(async (req, res) => {
    const { t, user } = await staffTournament(req)
    const { tableId } = parseBody(z.object({ tableId: z.number().int().positive().optional() }).default({}), req)
    if (t.status !== 'running') throw conflict('tournament.not_running')
    const m = await db.transaction().execute(async (trx) => {
      const m = await trx.selectFrom('matches').selectAll().where('id', '=', intParam(req, 'matchId')).forUpdate().executeTakeFirst()
      if (!m || m.tournament_id !== t.id) throw notFound('match.not_found')
      if (m.status !== 'scheduled') throw conflict('match.not_callable', { status: m.status })
      const active = await trx.selectFrom('matches').select(['id', 'table_id', 'home_entry_id', 'away_entry_id']).where('tournament_id', '=', t.id).where('status', 'in', ['called', 'playing']).execute()
      const busy = active.some((a) => [a.home_entry_id, a.away_entry_id].some((x) => x === m.home_entry_id || x === m.away_entry_id))
      if (busy) throw conflict('match.player_busy')
      const used = new Set(active.map((a) => a.table_id))
      let table = tableId
      if (table == null) {
        const tables = await trx.selectFrom('hall_tables').select('id').where('id', 'in', t.table_ids).orderBy('number').execute()
        table = tables.find((x) => !used.has(x.id))?.id
        if (table == null) throw conflict('match.no_free_table')
      } else if (!t.table_ids.includes(table)) throw badRequest('match.table_not_in_tournament')
      else if (used.has(table)) throw conflict('match.table_busy')
      const updated = await trx
        .updateTable('matches')
        .set({ status: 'called', table_id: table, called_at: new Date(), call_count: 1, call_responses: json({}), version: m.version + 1 })
        .where('id', '=', m.id)
        .returningAll()
        .executeTakeFirstOrThrow()
      await audit({ actorUserId: user.id, clubId: t.club_id, entity: 'match', entityId: m.id, action: 'call', after: { tableId: table } }, trx)
      return updated
    })
    const number = await db.selectFrom('hall_tables').select('number').where('id', '=', m.table_id!).executeTakeFirstOrThrow()
    await sendCall(t, m, number.number)
    changed(t.id, m.id)
    res.json({ ok: true, tableId: m.table_id })
  }),
)

/** Repeat the call now (also done automatically by the worker after 3 minutes without an answer). */
conductRouter.post(
  '/:id/matches/:matchId/recall',
  handler(async (req, res) => {
    const { t } = await staffTournament(req)
    const m = await matchOf(t, intParam(req, 'matchId'))
    if (m.status !== 'called') throw conflict('match.not_called')
    const updated = await db.updateTable('matches').set({ called_at: new Date(), call_count: m.call_count + 1 }).where('id', '=', m.id).returningAll().executeTakeFirstOrThrow()
    const table = await db.selectFrom('hall_tables').select('number').where('id', '=', m.table_id!).executeTakeFirstOrThrow()
    await sendCall(t, updated, table.number, true)
    changed(t.id, m.id)
    res.json({ ok: true })
  }),
)

conductRouter.post(
  '/:id/matches/:matchId/uncall',
  handler(async (req, res) => {
    const { t, user } = await staffTournament(req)
    const m = await matchOf(t, intParam(req, 'matchId'))
    if (m.status !== 'called') throw conflict('match.not_called')
    await db.updateTable('matches').set({ status: 'scheduled', table_id: null, called_at: null, call_count: 0, call_responses: json({}), version: m.version + 1 }).where('id', '=', m.id).execute()
    await audit({ actorUserId: user.id, clubId: t.club_id, entity: 'match', entityId: m.id, action: 'uncall' })
    changed(t.id, m.id)
    res.json({ ok: true })
  }),
)

conductRouter.post(
  '/:id/matches/:matchId/play',
  handler(async (req, res) => {
    const { t } = await staffTournament(req)
    const m = await matchOf(t, intParam(req, 'matchId'))
    if (m.status !== 'called') throw conflict('match.not_called')
    await db.updateTable('matches').set({ status: 'playing', started_at: new Date(), version: m.version + 1 }).where('id', '=', m.id).execute()
    changed(t.id, m.id)
    res.json({ ok: true })
  }),
)

/** No-show (M-4): the absent player loses by walkover, the match is not rated. */
conductRouter.post(
  '/:id/matches/:matchId/no-show',
  handler(async (req, res) => {
    const { t, user } = await staffTournament(req)
    const { absent } = parseBody(z.object({ absent: z.enum(['home', 'away']) }), req)
    await db.transaction().execute((trx) =>
      recordResult(trx, intParam(req, 'matchId'), { setsHome: 0, setsAway: 0, resultType: 'walkover', winner: absent === 'home' ? 'away' : 'home' }, user.id),
    )
    changed(t.id)
    res.json({ ok: true })
  }),
)

conductRouter.post(
  '/:id/matches/:matchId/correct',
  handler(async (req, res) => {
    const { t, user } = await staffTournament(req)
    const body = parseBody(scoreSchema.extend({ reason: z.string().trim().min(3).max(500) }), req)
    await db.transaction().execute((trx) => correctResult(trx, intParam(req, 'matchId'), body, body.reason, user.id))
    changed(t.id)
    res.json({ ok: true })
  }),
)

conductRouter.post(
  '/:id/entries/:entryId/withdraw',
  handler(async (req, res) => {
    const { t, user } = await staffTournament(req)
    const { reason } = parseBody(z.object({ reason: z.string().trim().min(3).max(500) }), req)
    const entryId = intParam(req, 'entryId')
    const entry = await db.selectFrom('entries').select('tournament_id').where('id', '=', entryId).executeTakeFirst()
    if (entry?.tournament_id !== t.id) throw notFound('entry.not_found')
    await db.transaction().execute((trx) => withdrawEntry(trx, entryId, user.id, reason))
    changed(t.id)
    bus.publish(`tournament:${t.id}`, 'tournament.entries_changed', { tournamentId: t.id })
    res.json({ ok: true })
  }),
)

/** Early finish (M-8): unplayed matches are annulled, places so far are final. */
conductRouter.post(
  '/:id/finish-early',
  handler(async (req, res) => {
    const { t, user } = await staffTournament(req)
    const { reason } = parseBody(z.object({ reason: z.string().trim().min(3).max(500) }), req)
    await db.transaction().execute(async (trx) => {
      await finishTournament(trx, t.id, user.id, new Date(), { early: true })
      await trx.updateTable('tournaments').set({ cancelled_reason: reason }).where('id', '=', t.id).execute()
    })
    bus.publish(`tournament:${t.id}`, 'tournament.finished', { tournamentId: t.id })
    res.json({ ok: true })
  }),
)

// ---------------------------------------------------------------------------
// Player side: answers to a call, score reports (M-5)

async function playerMatch(req: Request) {
  const user = requireUser(req)
  if (!user.playerId) throw forbidden('player.profile_required')
  const t = await db.selectFrom('tournaments').selectAll().where('id', '=', intParam(req, 'id')).executeTakeFirst()
  if (!t) throw notFound('tournament.not_found')
  const m = await matchOf(t, intParam(req, 'matchId'))
  const { home, away } = await sides(m)
  const side = home?.player_id === user.playerId ? 'home' : away?.player_id === user.playerId ? 'away' : null
  if (!side) throw forbidden('match.not_your_match')
  const entryId = side === 'home' ? m.home_entry_id! : m.away_entry_id!
  return { user, t, m, side, entryId } as const
}

conductRouter.post(
  '/:id/matches/:matchId/respond',
  handler(async (req, res) => {
    const { t, m, side } = await playerMatch(req)
    const { answer, reason } = parseBody(z.object({ answer: z.enum(['delivered', 'going', 'cannot']), reason: z.string().trim().max(300).optional() }), req)
    if (m.status !== 'called' && m.status !== 'playing') throw conflict('match.not_called')
    const responses = { ...(m.call_responses as CallResponses) }
    // «delivered» never overwrites a real answer.
    if (!(answer === 'delivered' && responses[side])) responses[side] = { answer: answer as CallAnswer, reason, at: new Date().toISOString() }
    await db.updateTable('matches').set({ call_responses: json(responses) }).where('id', '=', m.id).execute()
    changed(t.id, m.id)
    res.json({ ok: true })
  }),
)

conductRouter.post(
  '/:id/matches/:matchId/report',
  handler(async (req, res) => {
    const { t, m, side, entryId } = await playerMatch(req)
    if ((t.settings.scoreEntry ?? 'staff') !== 'players') throw forbidden('match.players_entry_off')
    if (!['called', 'playing'].includes(m.status)) throw conflict('match.not_playable')
    const body = parseBody(scoreSchema.pick({ setsHome: true, setsAway: true, games: true }), req)
    const errors = validateMatchScore(body, await rulesOfMatch(db, t.format, m))
    if (errors.length) throw unprocessable('match.invalid_score', errors)
    await db.updateTable('matches').set({ reported_score: json(body), reported_by: entryId, disputed: false }).where('id', '=', m.id).execute()
    const { home, away } = await sides(m)
    const opponent = side === 'home' ? away : home
    if (opponent?.user_id) await notify({ userId: opponent.user_id, type: 'score_confirm', urgent: true, data: { tournamentId: t.id, slug: t.slug, matchId: m.id, ...body } })
    changed(t.id, m.id)
    res.json({ ok: true })
  }),
)

conductRouter.post(
  '/:id/matches/:matchId/confirm',
  handler(async (req, res) => {
    const { user, t, m, entryId } = await playerMatch(req)
    const { agree } = parseBody(z.object({ agree: z.boolean() }), req)
    if (!m.reported_score || m.reported_by == null) throw conflict('match.nothing_to_confirm')
    if (m.reported_by === entryId) throw forbidden('match.confirm_by_opponent')
    if (agree) await db.transaction().execute((trx) => recordResult(trx, m.id, m.reported_score!, user.id))
    else await db.updateTable('matches').set({ disputed: true }).where('id', '=', m.id).execute()
    changed(t.id, m.id)
    res.json({ ok: true })
  }),
)

/** The signed-in player's current call or match (restores the popup after a reload). */
myCallsRouter.get(
  '/',
  handler(async (req, res) => {
    const user = requireUser(req)
    if (!user.playerId) return void res.json([])
    const rows = await db
      .selectFrom('matches as m')
      .innerJoin('tournaments as t', 't.id', 'm.tournament_id')
      .innerJoin('entries as e', (j) => j.on((eb) => eb.or([eb('e.id', '=', eb.ref('m.home_entry_id')), eb('e.id', '=', eb.ref('m.away_entry_id'))])))
      .leftJoin('hall_tables as ht', 'ht.id', 'm.table_id')
      .innerJoin('stages as st', 'st.id', 'm.stage_id')
      .select(['st.stage_key', 'm.stage_label', 'm.id', 'm.status', 'm.home_entry_id', 'm.away_entry_id', 'm.call_responses', 'm.reported_score', 'm.reported_by', 'e.id as my_entry', 't.id as tournament_id', 't.slug', 't.title', 't.settings', 't.format', 'ht.number as table'])
      .where('t.status', '=', 'running')
      .where('e.player_id', '=', user.playerId)
      .where('m.status', 'in', ['called', 'playing'])
      .execute()
    const result = []
    for (const r of rows) {
      const { home, away } = await sides(r)
      const side = r.my_entry === r.home_entry_id ? 'home' : 'away'
      const opponent = side === 'home' ? away : home
      result.push({
        matchId: r.id,
        tournamentId: r.tournament_id,
        slug: r.slug,
        title: r.title,
        status: r.status,
        table: r.table,
        side,
        opponent: opponent ? playerName(opponent) : null,
        myAnswer: (r.call_responses as CallResponses)[side]?.answer ?? null,
        scoreEntry: r.settings.scoreEntry ?? 'staff',
        rules: matchRulesFor(r.format, r.stage_key, r.stage_label),
        reportedScore: r.reported_score,
        reportedByMe: r.reported_by === r.my_entry,
      })
    }
    res.json(result)
  }),
)
