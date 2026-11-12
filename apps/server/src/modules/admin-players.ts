// Platform admin (4.8): player search, merge, manual rating correction with replay, block / unblock users.

import { Router } from 'express'
import { z } from 'zod'
import { searchWords } from '@nomad/shared'
import { audit } from '../audit.ts'
import { requirePlatformAdmin } from '../auth/access.ts'
import { db, json } from '../db/index.ts'
import { badRequest, conflict, handler, notFound } from '../http/errors.ts'
import { intParam, parseBody, parseQuery } from '../http/validate.ts'
import { runRecalc } from '../rating/recalc.ts'
import { mergePlayers } from './club-players.ts'
import { playerName } from './players.ts'

export const adminPlayersRouter = Router()

adminPlayersRouter.get(
  '/players',
  handler(async (req, res) => {
    requirePlatformAdmin(req)
    const { q } = parseQuery(z.object({ q: z.string().trim().max(100).default('') }), req)
    let query = db
      .selectFrom('players as p')
      .leftJoin('users as u', 'u.id', 'p.user_id')
      .leftJoin('cities as c', 'c.id', 'p.city_id')
      .leftJoin('player_ratings as r', (j) => j.onRef('r.player_id', '=', 'p.id').on('r.kind', '=', 'singles'))
      .select(['p.id', 'p.first_name', 'p.last_name', 'p.birth_year', 'c.name_ru as city', 'r.rating', 'r.tournaments', 'u.id as user_id', 'u.email', 'u.blocked_at'])
    if (q.includes('@')) query = query.where('u.email', 'ilike', `%${q}%`)
    else if (/^\d+$/.test(q)) query = query.where('p.id', '=', Number(q))
    else for (const word of searchWords(q)) query = query.where('p.search_name', 'like', `%${word}%`)
    const rows = await query.orderBy('p.last_name').orderBy('p.first_name').limit(50).execute()
    res.json(rows.map((r) => ({ id: r.id, name: playerName(r), birthYear: r.birth_year, city: r.city, rating: r.rating, tournaments: r.tournaments ?? 0, user: r.user_id ? { id: r.user_id, email: r.email, blocked: r.blocked_at != null } : null })))
  }),
)

adminPlayersRouter.get(
  '/players/:id',
  handler(async (req, res) => {
    requirePlatformAdmin(req)
    const id = intParam(req, 'id')
    const p = await db.selectFrom('players').select(['id', 'first_name', 'last_name', 'birth_year', 'user_id']).where('id', '=', id).executeTakeFirst()
    if (!p) throw notFound('player.not_found')
    const [rating, history, adjustments] = await Promise.all([
      db.selectFrom('player_ratings').selectAll().where('player_id', '=', id).where('kind', '=', 'singles').executeTakeFirst(),
      db
        .selectFrom('rating_snapshots as s')
        .innerJoin('tournaments as t', 't.id', 's.tournament_id')
        .select(['t.id', 't.title', 's.at', 's.rating_before', 's.rating_after', 's.delta'])
        .where('s.player_id', '=', id)
        .where('s.kind', '=', 'singles')
        .orderBy('s.at', 'desc')
        .limit(30)
        .execute(),
      db.selectFrom('rating_adjustments').selectAll().where('player_id', '=', id).orderBy('created_at', 'desc').limit(20).execute(),
    ])
    res.json({ id: p.id, name: playerName(p), birthYear: p.birth_year, userId: p.user_id, rating: rating?.rating ?? null, source: rating?.source ?? null, history, adjustments })
  }),
)

adminPlayersRouter.post(
  '/players/merge',
  handler(async (req, res) => {
    const admin = requirePlatformAdmin(req)
    const body = parseBody(z.object({ sourceId: z.number().int().positive(), targetId: z.number().int().positive(), reason: z.string().trim().min(3).max(500) }), req)
    if (body.sourceId === body.targetId) throw badRequest('merge.same_player')
    await db.transaction().execute(async (trx) => {
      await audit({ actorUserId: admin.id, entity: 'player', entityId: body.targetId, action: 'merge', before: { source: body.sourceId }, reason: body.reason }, trx)
      await mergePlayers(trx, body.sourceId, body.targetId)
    })
    res.json({ ok: true })
  }),
)

/**
 * Manual rating correction. With `fromTournamentId` the player's state before that tournament is set to the new
 * rating and every later tournament is replayed (Stage 3 `recalculateFrom`); without it the current rating is set.
 */
adminPlayersRouter.post(
  '/players/:id/rating',
  handler(async (req, res) => {
    const admin = requirePlatformAdmin(req)
    const id = intParam(req, 'id')
    const body = parseBody(z.object({ rating: z.number().int().min(100).max(4000), fromTournamentId: z.number().int().positive().nullable().default(null), reason: z.string().trim().min(3).max(500) }), req)
    const current = await db.selectFrom('player_ratings').select('rating').where('player_id', '=', id).where('kind', '=', 'singles').executeTakeFirst()
    await db.transaction().execute(async (trx) => {
      const player = await trx.selectFrom('players').select('id').where('id', '=', id).executeTakeFirst()
      if (!player) throw notFound('player.not_found')
      if (body.fromTournamentId) {
        const snap = await trx.selectFrom('rating_snapshots').select(['state_before']).where('player_id', '=', id).where('kind', '=', 'singles').where('tournament_id', '=', body.fromTournamentId).executeTakeFirst()
        if (!snap) throw conflict('rating.player_not_in_tournament')
        const state = { rated_matches: 0, tournaments: 0, matches: 0, wins: 0, max_rating: null, last_rated_at: null, calibration: {}, ...(snap.state_before ?? {}), rating: body.rating, source: 'admin' as const }
        await trx.updateTable('rating_snapshots').set({ state_before: json(state), rating_before: body.rating }).where('player_id', '=', id).where('kind', '=', 'singles').where('tournament_id', '=', body.fromTournamentId).execute()
      } else {
        await trx
          .insertInto('player_ratings')
          .values({ player_id: id, kind: 'singles', rating: body.rating, source: 'admin' })
          .onConflict((oc) => oc.columns(['player_id', 'kind']).doUpdateSet({ rating: body.rating, source: 'admin', updated_at: new Date() }))
          .execute()
      }
      await trx.insertInto('rating_adjustments').values({ player_id: id, rating_before: current?.rating ?? null, rating_after: body.rating, from_tournament_id: body.fromTournamentId, reason: body.reason, created_by: admin.id }).execute()
      await audit({ actorUserId: admin.id, entity: 'player_rating', entityId: id, action: 'correct', before: { rating: current?.rating ?? null }, after: { rating: body.rating, fromTournamentId: body.fromTournamentId }, reason: body.reason }, trx)
    })
    const replay = body.fromTournamentId ? await runRecalc(body.fromTournamentId) : null
    const after = await db.selectFrom('player_ratings').select('rating').where('player_id', '=', id).where('kind', '=', 'singles').executeTakeFirst()
    res.json({ rating: after?.rating ?? null, replay })
  }),
)

adminPlayersRouter.post(
  '/users/:id/block',
  handler(async (req, res) => {
    const admin = requirePlatformAdmin(req)
    const id = intParam(req, 'id')
    const body = parseBody(z.object({ blocked: z.boolean(), reason: z.string().trim().max(500).default('') }), req)
    if (id === admin.id) throw badRequest('admin.cannot_block_self')
    if (body.blocked && !body.reason) throw badRequest('admin.reason_required')
    await db.transaction().execute(async (trx) => {
      const u = await trx.selectFrom('users').select(['blocked_at', 'platform_role']).where('id', '=', id).executeTakeFirst()
      if (!u) throw notFound('user.not_found')
      await trx.updateTable('users').set({ blocked_at: body.blocked ? new Date() : null }).where('id', '=', id).execute()
      if (body.blocked) await trx.deleteFrom('sessions').where('user_id', '=', id).execute()
      await audit({ actorUserId: admin.id, entity: 'user', entityId: id, action: body.blocked ? 'block' : 'unblock', before: { blocked: u.blocked_at != null }, reason: body.reason || null }, trx)
    })
    res.json({ blocked: body.blocked })
  }),
)
