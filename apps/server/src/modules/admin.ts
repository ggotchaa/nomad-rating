// Platform admin (A-1 and stage 1 queues): club verification, player merge requests, overview counters.

import { Router } from 'express'
import { sql } from 'kysely'
import { z } from 'zod'
import { clubStatus } from '@nomad/shared'
import type { ClubStatus } from '@nomad/shared'
import { db, json } from '../db/index.ts'
import { audit } from '../audit.ts'
import { requirePlatformAdmin } from '../auth/access.ts'
import { badRequest, handler, notFound } from '../http/errors.ts'
import { intParam, isoDate, parseBody, parseQuery } from '../http/validate.ts'
import { documentsByClub } from './club-desk.ts'
import { setClubStatus } from './club-manage.ts'
import { mergePlayers } from './club-players.ts'

export const adminRouter = Router()

adminRouter.get(
  '/overview',
  handler(async (req, res) => {
    requirePlatformAdmin(req)
    const count = (q: Promise<{ n: number } | undefined>) => q.then((r) => Number(r?.n ?? 0))
    const [clubs, merges, claims] = await Promise.all([
      count(db.selectFrom('clubs').select((eb) => eb.fn.countAll<number>().as('n')).where('status', '=', 'review').executeTakeFirst()),
      count(db.selectFrom('player_merge_requests').select((eb) => eb.fn.countAll<number>().as('n')).where('status', '=', 'open').executeTakeFirst()),
      count(db.selectFrom('rttf_claims').select((eb) => eb.fn.countAll<number>().as('n')).where('status', 'in', ['conflict', 'pending']).executeTakeFirst()),
    ])
    res.json({ clubs, merges, rttf: claims })
  }),
)

adminRouter.get(
  '/clubs',
  handler(async (req, res) => {
    requirePlatformAdmin(req)
    const { status } = parseQuery(z.object({ status: z.enum(clubStatus.states as [ClubStatus, ...ClubStatus[]]).default('review') }), req)
    const rows = await db
      .selectFrom('clubs as c')
      .innerJoin('cities as ci', 'ci.id', 'c.city_id')
      .innerJoin('users as u', 'u.id', 'c.owner_user_id')
      .select(['c.id', 'c.slug', 'c.name', 'c.description', 'c.status', 'c.status_reason', 'c.requisites', 'c.contact_email', 'c.contact_telegram', 'c.created_at', 'ci.name_ru as city', 'u.email as owner'])
      .where('c.status', '=', status)
      .select('c.commission')
      .orderBy('c.created_at')
      .execute()
    const docs = await documentsByClub(rows.map((r) => r.id))
    res.json(rows.map((r) => ({ ...r, documents: docs.get(r.id) ?? [] })))
  }),
)

adminRouter.post(
  '/clubs/:id/status',
  handler(async (req, res) => {
    const admin = requirePlatformAdmin(req)
    const body = parseBody(z.object({ status: z.enum(['active', 'rejected', 'blocked']), reason: z.string().trim().max(1000).default('') }), req)
    if (body.status !== 'active' && !body.reason) throw badRequest('club.reason_required')
    await setClubStatus(intParam(req, 'id'), body.status, admin.id, body.reason || null)
    res.json({ status: body.status })
  }),
)

const playerBrief = (prefix: 's' | 't') =>
  [`${prefix}.id as ${prefix}_id`, `${prefix}.first_name as ${prefix}_first`, `${prefix}.last_name as ${prefix}_last`, `${prefix}.birth_year as ${prefix}_year`, `${prefix}.user_id as ${prefix}_user`] as const

adminRouter.get(
  '/merge-requests',
  handler(async (req, res) => {
    requirePlatformAdmin(req)
    const rows = await db
      .selectFrom('player_merge_requests as m')
      .innerJoin('players as s', 's.id', 'm.source_player_id')
      .innerJoin('players as t', 't.id', 'm.target_player_id')
      .leftJoin('clubs as c', 'c.id', 'm.club_id')
      .select(['m.id', 'm.reason', 'm.created_at', 'c.name as club', ...playerBrief('s'), ...playerBrief('t')])
      .where('m.status', '=', 'open')
      .orderBy('m.created_at')
      .execute()
    res.json(
      rows.map((r) => ({
        id: r.id,
        reason: r.reason,
        club: r.club,
        createdAt: r.created_at,
        source: { id: r.s_id, name: `${r.s_last} ${r.s_first}`, birthYear: r.s_year, hasAccount: r.s_user != null },
        target: { id: r.t_id, name: `${r.t_last} ${r.t_first}`, birthYear: r.t_year, hasAccount: r.t_user != null },
      })),
    )
  }),
)

adminRouter.post(
  '/merge-requests/:id',
  handler(async (req, res) => {
    const admin = requirePlatformAdmin(req)
    const id = intParam(req, 'id')
    const { action } = parseBody(z.object({ action: z.enum(['merge', 'reject']) }), req)
    await db.transaction().execute(async (trx) => {
      const mr = await trx.selectFrom('player_merge_requests').selectAll().where('id', '=', id).where('status', '=', 'open').forUpdate().executeTakeFirst()
      if (!mr) throw notFound('merge.not_found')
      // Update first: deleting the source cascades to this request.
      await trx.updateTable('player_merge_requests').set({ status: action === 'merge' ? 'merged' : 'rejected', resolved_by: admin.id, resolved_at: new Date() }).where('id', '=', id).execute()
      await audit({ actorUserId: admin.id, clubId: mr.club_id, entity: 'merge_request', entityId: id, action, before: { source: mr.source_player_id, target: mr.target_player_id } }, trx)
      if (action === 'merge') await mergePlayers(trx, mr.source_player_id, mr.target_player_id)
    })
    res.json({ ok: true })
  }),
)

const rate = z.object({ percent: z.number().min(0).max(100), minimum: z.number().int().min(0).nullable() }).nullable()

/** Per-club commission for tournaments and bookings (stored only: online payments are off). null = platform default. */
adminRouter.put(
  '/clubs/:id/commission',
  handler(async (req, res) => {
    const admin = requirePlatformAdmin(req)
    const id = intParam(req, 'id')
    const body = parseBody(z.object({ tournament: rate, booking: rate }), req)
    const before = await db.selectFrom('clubs').select('commission').where('id', '=', id).executeTakeFirst()
    if (!before) throw notFound('club.not_found')
    const value = body.tournament || body.booking ? body : null
    await db.updateTable('clubs').set({ commission: value ? json(value) : null }).where('id', '=', id).execute()
    await audit({ actorUserId: admin.id, clubId: id, entity: 'club', entityId: id, action: 'commission', before: before.commission, after: value })
    res.json({ commission: value })
  }),
)

const OFFSET = '+05:00'

/** A-7: platform totals for a period (Almaty dates, default the last 30 days). */
adminRouter.get(
  '/dashboard',
  handler(async (req, res) => {
    requirePlatformAdmin(req)
    const q = parseQuery(z.object({ from: isoDate.optional(), to: isoDate.optional() }), req)
    const today = new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10)
    const to = q.to ?? today
    const from = q.from ?? new Date(Date.parse(`${to}T00:00:00Z`) - 29 * 86400_000).toISOString().slice(0, 10)
    if (to < from) throw badRequest('finance.bad_period')
    const start = new Date(`${from}T00:00:00${OFFSET}`)
    const end = new Date(new Date(`${to}T00:00:00${OFFSET}`).getTime() + 86400_000)
    const n = sql<number>`count(*)::int`.as('n')
    const [tournaments, players, bookings, money, clubs, merges, rttf, disputes] = await Promise.all([
      db.selectFrom('tournaments').select(['status', n]).where('starts_at', '>=', start).where('starts_at', '<', end).where('status', '<>', 'draft').groupBy('status').execute(),
      sql<{ n: number }>`
        SELECT count(DISTINCT player_id)::int AS n FROM (
          SELECT e.player_id FROM entries e JOIN tournaments t ON t.id = e.tournament_id
            WHERE t.starts_at >= ${start} AND t.starts_at < ${end} AND e.status IN ('checked_in', 'playing', 'completed', 'withdrew')
          UNION SELECT b.player_id FROM bookings b
            WHERE b.player_id IS NOT NULL AND b.starts_at >= ${start} AND b.starts_at < ${end} AND b.status IN ('confirmed', 'arrived')
        ) x`.execute(db),
      db.selectFrom('bookings').select(['status', n]).where('starts_at', '>=', start).where('starts_at', '<', end).groupBy('status').execute(),
      db
        .selectFrom('payments')
        .select([
          'purpose',
          sql<string>`coalesce(sum(amount), 0)`.as('expected'),
          sql<string>`coalesce(sum(amount) filter (where status = 'succeeded'), 0)`.as('collected'),
          sql<string>`coalesce(sum(commission), 0)`.as('commission'),
        ])
        .where('created_at', '>=', start)
        .where('created_at', '<', end)
        .where('status', 'not in', ['declined', 'expired', 'refunded_full'])
        .groupBy('purpose')
        .execute(),
      db.selectFrom('clubs').select(n).where('status', '=', 'review').executeTakeFirst(),
      db.selectFrom('player_merge_requests').select(n).where('status', '=', 'open').executeTakeFirst(),
      db.selectFrom('rttf_claims').select(n).where('status', 'in', ['conflict', 'pending']).executeTakeFirst(),
      db.selectFrom('disputes').select(n).where('status', '=', 'open').executeTakeFirst(),
    ])
    const byStatus = (rows: { status: string; n: number }[]) => Object.fromEntries(rows.map((r) => [r.status, Number(r.n)]))
    const sum = (k: 'expected' | 'collected' | 'commission') => money.reduce((s, r) => s + Number(r[k]), 0)
    res.json({
      from,
      to,
      tournaments: byStatus(tournaments),
      activePlayers: Number(players.rows[0]?.n ?? 0),
      bookings: byStatus(bookings),
      money: {
        expected: sum('expected'),
        collected: sum('collected'),
        commission: sum('commission'),
        bySource: money.map((r) => ({ source: r.purpose, expected: Number(r.expected), collected: Number(r.collected), commission: Number(r.commission) })),
      },
      queues: { clubs: Number(clubs?.n ?? 0), merges: Number(merges?.n ?? 0), rttf: Number(rttf?.n ?? 0), disputes: Number(disputes?.n ?? 0) },
    })
  }),
)
