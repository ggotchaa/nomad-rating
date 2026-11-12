// Platform admin (A-1 and stage 1 queues): club verification, player merge requests, overview counters.

import { Router } from 'express'
import { z } from 'zod'
import { clubStatus } from '@nomad/shared'
import type { ClubStatus } from '@nomad/shared'
import { db } from '../db/index.ts'
import { audit } from '../audit.ts'
import { requirePlatformAdmin } from '../auth/access.ts'
import { badRequest, handler, notFound } from '../http/errors.ts'
import { intParam, parseBody, parseQuery } from '../http/validate.ts'
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
      .orderBy('c.created_at')
      .execute()
    res.json(rows)
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
