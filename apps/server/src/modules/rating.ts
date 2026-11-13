// Rating routes: replay status, correction of finished matches (72 h for the club, then admin only),
// «Счёт неверный» disputes, preliminary delta during a tournament, «Мой турнир».

import { Router } from 'express'
import { z } from 'zod'
import { emptyCalibration, gameWinner, isRatedResult, preliminaryDelta, rateTournament } from '@nomad/engine'
import type { PlayerRatingState, RatedMatch } from '@nomad/engine'
import { audit } from '../audit.ts'
import { clubAccess, requireUser } from '../auth/access.ts'
import { db, json } from '../db/index.ts'
import { badRequest, conflict, forbidden, handler, notFound } from '../http/errors.ts'
import { intParam, parseBody, parseQuery } from '../http/validate.ts'
import { notify } from '../notify/index.ts'
import { recalcStatus, requestRecalc } from '../rating/recalc.ts'
import { eloParams } from '../rating/service.ts'
import { playerName } from './players.ts'

export const ratingRouter = Router()

const CORRECTION_HOURS = 72
const FINISHED_T = ['finished', 'finished_early'] as const

ratingRouter.get(
  '/status',
  handler(async (_req, res) => {
    res.json(await recalcStatus())
  }),
)

async function canFixClub(userId: number, clubId: number): Promise<boolean> {
  const access = await clubAccess(userId, clubId)
  return Boolean(access?.rights.includes('score_fix'))
}

const correction = z.object({
  games: z.array(z.object({ home: z.number().int().min(0).max(99), away: z.number().int().min(0).max(99) })).min(1).max(9),
  resultType: z.enum(['normal', 'retired']).default('normal'),
  winner: z.enum(['home', 'away']).optional(),
  reason: z.string().trim().min(3).max(500),
})

/** Corrects the score of a match in a finished tournament and replays ratings from that tournament. */
ratingRouter.post(
  '/matches/:id/correct',
  handler(async (req, res) => {
    const user = requireUser(req)
    const id = intParam(req, 'id')
    const body = parseBody(correction, req)
    const m = await db
      .selectFrom('matches as m')
      .innerJoin('tournaments as t', 't.id', 'm.tournament_id')
      .select(['m.id', 'm.tournament_id', 'm.home_entry_id', 'm.away_entry_id', 'm.games', 'm.sets_home', 'm.sets_away', 'm.winner_entry_id', 'm.result_type', 't.club_id', 't.status', 't.finished_at'])
      .where('m.id', '=', id)
      .executeTakeFirst()
    if (!m) throw notFound('match.not_found')
    if (!(FINISHED_T as readonly string[]).includes(m.status) || !m.finished_at) throw conflict('rating.tournament_not_finished')
    if (m.home_entry_id == null || m.away_entry_id == null) throw conflict('match.players_unknown')
    const withinWindow = Date.now() - m.finished_at.getTime() <= CORRECTION_HOURS * 3600_000
    const admin = user.platformRole === 'admin'
    if (!admin) {
      if (!(await canFixClub(user.id, m.club_id))) throw forbidden('club.right_missing')
      if (!withinWindow) throw forbidden('rating.correction_window_closed')
    }
    const setsHome = body.games.filter((g) => gameWinner(g) === 'home').length
    const setsAway = body.games.length - setsHome
    const winnerSide = body.resultType === 'retired' ? body.winner : setsHome === setsAway ? undefined : setsHome > setsAway ? 'home' : 'away'
    if (!winnerSide) throw badRequest('score.winner_unknown')
    const after = {
      games: body.games,
      sets_home: setsHome,
      sets_away: setsAway,
      result_type: body.resultType,
      winner_entry_id: winnerSide === 'home' ? m.home_entry_id : m.away_entry_id,
    }
    await db.transaction().execute(async (trx) => {
      await trx
        .updateTable('matches')
        .set({ ...after, games: json(body.games), status: body.resultType === 'retired' ? 'retired' : 'finished' })
        .where('id', '=', id)
        .execute()
      await audit(
        {
          actorUserId: user.id,
          clubId: m.club_id,
          entity: 'match',
          entityId: id,
          action: 'correct_finished',
          before: { games: m.games, sets_home: m.sets_home, sets_away: m.sets_away, winner_entry_id: m.winner_entry_id, result_type: m.result_type },
          after,
          reason: body.reason + (admin && !withinWindow ? ' [admin, after 72h]' : ''),
        },
        trx,
      )
    })
    await requestRecalc(m.tournament_id)
    res.json({ ok: true, recalculating: true })
  }),
)

const disputeBody = z.object({ reason: z.string().trim().min(3).max(1000) })

ratingRouter.post(
  '/matches/:id/dispute',
  handler(async (req, res) => {
    const user = requireUser(req)
    const id = intParam(req, 'id')
    const { reason } = parseBody(disputeBody, req)
    const m = await db
      .selectFrom('matches as m')
      .innerJoin('tournaments as t', 't.id', 'm.tournament_id')
      .leftJoin('entries as he', 'he.id', 'm.home_entry_id')
      .leftJoin('entries as ae', 'ae.id', 'm.away_entry_id')
      .select(['m.id', 'm.status', 'm.tournament_id', 't.club_id', 'he.player_id as home_player', 'ae.player_id as away_player'])
      .where('m.id', '=', id)
      .executeTakeFirst()
    if (!m) throw notFound('match.not_found')
    if (!user.playerId || ![m.home_player, m.away_player].includes(user.playerId)) throw forbidden('dispute.not_participant')
    if (!['finished', 'retired', 'walkover'].includes(m.status)) throw conflict('dispute.match_not_finished')
    const open = await db
      .selectFrom('disputes')
      .select('id')
      .where('entity', '=', 'match')
      .where('entity_id', '=', String(id))
      .where('user_id', '=', user.id)
      .where('status', '=', 'open')
      .executeTakeFirst()
    if (open) throw conflict('dispute.already_open')
    const row = await db
      .insertInto('disputes')
      .values({ entity: 'match', entity_id: String(id), tournament_id: m.tournament_id, club_id: m.club_id, user_id: user.id, reason })
      .returning('id')
      .executeTakeFirstOrThrow()
    await audit({ actorUserId: user.id, clubId: m.club_id, entity: 'dispute', entityId: row.id, action: 'open', after: { matchId: id, reason } })
    res.status(201).json({ id: row.id })
  }),
)

const disputeList = (clubId: number | null, status?: string) => {
  let q = db
    .selectFrom('disputes as d')
    .innerJoin('users as u', 'u.id', 'd.user_id')
    .leftJoin('players as p', 'p.user_id', 'd.user_id')
    .leftJoin('tournaments as t', 't.id', 'd.tournament_id')
    .leftJoin('clubs as c', 'c.id', 'd.club_id')
    .select(['d.id', 'd.entity', 'd.entity_id', 'd.reason', 'd.status', 'd.resolution', 'd.created_at', 'd.resolved_at', 't.title', 't.slug', 'c.name as club', 'p.first_name', 'p.last_name', 'u.email'])
  if (clubId != null) q = q.where('d.club_id', '=', clubId)
  if (status) q = q.where('d.status', '=', status as 'open')
  return q.orderBy('d.created_at', 'desc').limit(200).execute()
}

const listQuery = z.object({ status: z.enum(['open', 'resolved', 'rejected']).optional() })

const disputeView = (rows: Awaited<ReturnType<typeof disputeList>>) =>
  rows.map((r) => ({
    id: r.id,
    entity: r.entity,
    entityId: r.entity_id,
    reason: r.reason,
    status: r.status,
    resolution: r.resolution,
    createdAt: r.created_at,
    resolvedAt: r.resolved_at,
    tournament: r.title ? { title: r.title, slug: r.slug } : null,
    club: r.club,
    author: r.first_name ? playerName({ first_name: r.first_name, last_name: r.last_name! }) : r.email,
  }))

ratingRouter.get(
  '/disputes',
  handler(async (req, res) => {
    const user = requireUser(req)
    if (user.platformRole !== 'admin') throw forbidden()
    res.json(disputeView(await disputeList(null, parseQuery(listQuery, req).status)))
  }),
)

ratingRouter.get(
  '/clubs/:clubId/disputes',
  handler(async (req, res) => {
    const user = requireUser(req)
    const clubId = intParam(req, 'clubId')
    if (user.platformRole !== 'admin' && !(await canFixClub(user.id, clubId))) throw forbidden('club.right_missing')
    res.json(disputeView(await disputeList(clubId, parseQuery(listQuery, req).status)))
  }),
)

ratingRouter.patch(
  '/disputes/:id',
  handler(async (req, res) => {
    const user = requireUser(req)
    const id = intParam(req, 'id')
    const body = parseBody(z.object({ status: z.enum(['resolved', 'rejected']), resolution: z.string().trim().max(1000).default('') }), req)
    const d = await db.selectFrom('disputes').selectAll().where('id', '=', id).executeTakeFirst()
    if (!d) throw notFound('dispute.not_found')
    if (user.platformRole !== 'admin' && (d.entity.startsWith('club_') || !(d.club_id && (await canFixClub(user.id, d.club_id))))) throw forbidden('club.right_missing')
    if (d.status !== 'open') throw conflict('dispute.closed')
    await db.updateTable('disputes').set({ status: body.status, resolution: body.resolution, resolved_by: user.id, resolved_at: new Date() }).where('id', '=', id).execute()
    await audit({ actorUserId: user.id, clubId: d.club_id, entity: 'dispute', entityId: id, action: body.status, before: { status: d.status }, after: body })
    await notify({ userId: d.user_id, type: 'dispute_update', data: { disputeId: id, status: body.status, resolution: body.resolution } })
    res.json({ ok: true })
  }),
)

/** Preliminary rating change of every player in a running tournament («+12»), from frozen ratings at start. */
async function preliminary(tournamentId: number): Promise<Map<number, number>> {
  const entries = await db
    .selectFrom('entries as e')
    .innerJoin('players as p', 'p.id', 'e.player_id')
    .leftJoin('player_ratings as r', (j) => j.onRef('r.player_id', '=', 'e.player_id').on('r.kind', '=', 'singles'))
    .select(['e.id', 'e.player_id', 'e.rating_at_start', 'p.start_level', 'r.rated_matches', 'r.source', 'r.calibration', 'r.rating'])
    .where('e.tournament_id', '=', tournamentId)
    .where('e.status', 'in', ['checked_in', 'playing', 'completed', 'withdrew'])
    .execute()
  const playerOf = new Map(entries.map((e) => [e.id, e.player_id]))
  const states = new Map<string, PlayerRatingState>()
  for (const e of entries) {
    states.set(String(e.player_id), {
      rating: e.rating_at_start ?? e.rating,
      source: e.source ?? null,
      ratedMatches: e.rated_matches ?? 0,
      startLevel: e.start_level,
      calibration: { ...emptyCalibration(), ...(e.calibration ?? {}) },
    })
  }
  const matches = await db
    .selectFrom('matches')
    .select(['id', 'home_entry_id', 'away_entry_id', 'winner_entry_id', 'is_rated', 'result_type', 'games'])
    .where('tournament_id', '=', tournamentId)
    .where('status', 'in', ['finished', 'retired', 'walkover'])
    .execute()
  const t = await db.selectFrom('tournaments').select(['is_rated', 'rating_coefficient']).where('id', '=', tournamentId).executeTakeFirstOrThrow()
  const list: RatedMatch[] = matches
    .filter((m) => m.home_entry_id && m.away_entry_id && playerOf.has(m.home_entry_id) && playerOf.has(m.away_entry_id))
    .map((m) => ({
      id: String(m.id),
      a: String(playerOf.get(m.home_entry_id!)),
      b: String(playerOf.get(m.away_entry_id!)),
      winner: m.winner_entry_id === m.home_entry_id ? 'a' : 'b',
      rated: t.is_rated && m.is_rated && isRatedResult(m.result_type, m.games),
    }))
  const params = await db.transaction().execute((trx) => eloParams(trx))
  const results = rateTournament(states, list, { params, coefficient: Number(t.rating_coefficient) })
  return new Map(entries.map((e) => [e.player_id, preliminaryDelta(results, String(e.player_id))]))
}

ratingRouter.get(
  '/tournaments/:id/preliminary',
  handler(async (req, res) => {
    const id = intParam(req, 'id')
    const t = await db.selectFrom('tournaments').select('status').where('id', '=', id).executeTakeFirst()
    if (!t) throw notFound('tournament.not_found')
    if (t.status !== 'running') return void res.json({ running: false, deltas: {} })
    res.json({ running: true, deltas: Object.fromEntries(await preliminary(id)) })
  }),
)

/** Running tournaments of the current player with his preliminary delta (cabinet). */
ratingRouter.get(
  '/me/live',
  handler(async (req, res) => {
    const user = requireUser(req)
    if (!user.playerId) return void res.json([])
    const rows = await db
      .selectFrom('entries as e')
      .innerJoin('tournaments as t', 't.id', 'e.tournament_id')
      .select(['t.id', 't.slug', 't.title'])
      .where('e.player_id', '=', user.playerId)
      .where('t.status', '=', 'running')
      .execute()
    res.json(await Promise.all(rows.map(async (r) => ({ tournamentId: r.id, slug: r.slug, title: r.title, delta: (await preliminary(r.id)).get(user.playerId!) ?? 0 }))))
  }),
)

/** «Мой турнир»: my group position, my next match and its place in the queue. Read-only. */
ratingRouter.get(
  '/me/tournaments/:slug',
  handler(async (req, res) => {
    const user = requireUser(req)
    if (!user.playerId) throw forbidden('player.profile_required')
    const t = await db.selectFrom('tournaments').select(['id', 'slug', 'title', 'status', 'starts_at', 'hall_id']).where('slug', '=', req.params.slug as string).executeTakeFirst()
    if (!t) throw notFound('tournament.not_found')
    const entry = await db.selectFrom('entries').select(['id', 'status', 'seed', 'final_place', 'final_place_to', 'rating_at_start']).where('tournament_id', '=', t.id).where('player_id', '=', user.playerId).executeTakeFirst()
    if (!entry) throw notFound('entry.not_found')

    const membership = await db
      .selectFrom('group_members as gm')
      .innerJoin('groups as g', 'g.id', 'gm.group_id')
      .innerJoin('stages as s', 's.id', 'g.stage_id')
      .select(['g.id', 'g.code', 'g.standings', 's.name as stage'])
      .where('gm.entry_id', '=', entry.id)
      .orderBy('s.order_index', 'desc')
      .executeTakeFirst()
    let group: { code: string; stage: string; place: number | null; wins: number; losses: number; size: number } | null = null
    if (membership) {
      const members = await db.selectFrom('group_members').select('entry_id').where('group_id', '=', membership.id).execute()
      const gm = await db.selectFrom('matches').select(['winner_entry_id', 'home_entry_id', 'away_entry_id', 'status']).where('group_id', '=', membership.id).execute()
      const mine = gm.filter((x) => (x.home_entry_id === entry.id || x.away_entry_id === entry.id) && x.winner_entry_id != null)
      group = {
        code: membership.code,
        stage: membership.stage,
        place: membership.standings?.rows.find((r) => r.id === String(entry.id))?.place ?? null,
        wins: mine.filter((x) => x.winner_entry_id === entry.id).length,
        losses: mine.filter((x) => x.winner_entry_id !== entry.id).length,
        size: members.length,
      }
    }

    const queue = await db
      .selectFrom('matches as m')
      .leftJoin('hall_tables as ht', 'ht.id', 'm.table_id')
      .select(['m.id', 'm.number', 'm.status', 'm.stage_label', 'm.home_entry_id', 'm.away_entry_id', 'm.called_at', 'ht.number as table'])
      .where('m.tournament_id', '=', t.id)
      .where('m.status', 'in', ['scheduled', 'called', 'playing'])
      .orderBy('m.round')
      .orderBy('m.number')
      .execute()
    const waiting = queue.filter((m) => m.status === 'scheduled')
    const nextIndex = queue.findIndex((m) => m.home_entry_id === entry.id || m.away_entry_id === entry.id)
    let next = null
    if (nextIndex >= 0) {
      const m = queue[nextIndex]!
      const opponentEntry = m.home_entry_id === entry.id ? m.away_entry_id : m.home_entry_id
      const opp = opponentEntry
        ? await db.selectFrom('entries as e').innerJoin('players as p', 'p.id', 'e.player_id').select(['p.id', 'p.first_name', 'p.last_name', 'e.rating_at_start']).where('e.id', '=', opponentEntry).executeTakeFirst()
        : undefined
      next = {
        matchId: m.id,
        number: m.number,
        status: m.status,
        round: m.stage_label,
        table: m.table,
        calledAt: m.called_at,
        opponent: opp ? { id: opp.id, name: playerName(opp), rating: opp.rating_at_start } : null,
        queuePosition: m.status === 'scheduled' ? waiting.indexOf(m) + 1 : 0,
      }
    }
    const deltas = t.status === 'running' ? await preliminary(t.id) : null
    res.json({
      tournament: { id: t.id, slug: t.slug, title: t.title, status: t.status, startsAt: t.starts_at },
      entry: { status: entry.status, seed: entry.seed, place: entry.final_place, placeTo: entry.final_place_to, ratingAtStart: entry.rating_at_start },
      group,
      next,
      queueLength: waiting.length,
      preliminaryDelta: deltas?.get(user.playerId) ?? null,
    })
  }),
)
