// Tournament editing (T-2…T-4, T-7): edit draft / published, copy, series, cancel with reason.

import { Router } from 'express'
import { z } from 'zod'
import { estimateFormat, formatTemplate, validateFormat } from '@nomad/engine'
import type { TemplateParams, TournamentFormat } from '@nomad/engine'
import { assertTransition, ENTRY_OCCUPYING, tournamentStatus } from '@nomad/shared'
import type { EntryStatus } from '@nomad/shared'
import { db, json } from '../db/index.ts'
import type { TournamentUpdate } from '../db/types.ts'
import { audit } from '../audit.ts'
import { requireClubRight } from '../auth/access.ts'
import { conflict, handler, notFound, unprocessable } from '../http/errors.ts'
import { intParam, parseBody } from '../http/validate.ts'
import { notify } from '../notify/index.ts'
import { bus } from '../realtime/bus.ts'
import { clubOfTournament, createSchema, createTournament } from './tournaments.ts'

export const tournamentAdminRouter = Router()
export const seriesRouter = Router({ mergeParams: true })

// Same fields as creation without defaults: a missing field keeps its current value.
const updateSchema = z.object(
  Object.fromEntries(
    Object.entries(createSchema.omit({ hallId: true }).shape).map(([k, v]) => [k, (v instanceof z.ZodDefault ? v.unwrap() : v).optional()]),
  ) as unknown as { [K in Exclude<keyof typeof createSchema.shape, 'hallId'>]: z.ZodOptional<z.ZodType<z.infer<typeof createSchema>[K]>> },
)

tournamentAdminRouter.patch(
  '/:id',
  handler(async (req, res) => {
    const id = intParam(req, 'id')
    const { club_id, hall_id } = await clubOfTournament(id)
    const user = await requireClubRight(req, club_id, 'tournaments', { tournamentId: id, hallId: hall_id })
    const body = parseBody(updateSchema, req)
    const result = await db.transaction().execute(async (trx) => {
      const t = await trx.selectFrom('tournaments').selectAll().where('id', '=', id).forUpdate().executeTakeFirstOrThrow()
      if (!['draft', 'published', 'registration_closed'].includes(t.status)) throw conflict('tournament.not_editable')
      const taken = Number(
        (await trx.selectFrom('entries').select((eb) => eb.fn.countAll<number>().as('n')).where('tournament_id', '=', id).where('status', 'in', [...ENTRY_OCCUPYING]).executeTakeFirstOrThrow()).n,
      )
      const max = body.maxParticipants ?? t.max_participants
      if (max < taken) throw conflict('tournament.max_below_taken', { taken })
      const settings = { ...t.settings, ...body.settings }
      let format: TournamentFormat = t.format
      if (body.format) format = body.format as TournamentFormat
      else if (body.template) format = formatTemplate(body.template, max, (body.templateParams ?? {}) as TemplateParams)
      if (settings.restMinutes != null) format = { ...format, restMinutes: settings.restMinutes }
      const errors = validateFormat(format)
      if (errors.length) throw unprocessable('format.invalid', errors)
      let tableIds = t.table_ids
      if (body.tableIds?.length) {
        const valid = await trx.selectFrom('hall_tables').select('id').where('hall_id', '=', t.hall_id).where('id', 'in', body.tableIds).execute()
        tableIds = valid.map((x) => x.id)
        if (!tableIds.length) throw unprocessable('tournament.no_tables')
      }
      const startsAt = body.startsAt ? new Date(body.startsAt) : t.starts_at
      const estimate = estimateFormat(format, max, { tables: tableIds.length, avgMatchMinutes: settings.avgMatchMinutes ?? 20 })
      const patch: TournamentUpdate = {
        title: body.title,
        starts_at: startsAt,
        estimated_end_at: new Date(startsAt.getTime() + estimate.minutes * 60000),
        registration_closes_at: body.registrationClosesAt ? new Date(body.registrationClosesAt) : body.startsAt ? startsAt : undefined,
        max_participants: max,
        min_participants: body.minParticipants,
        fee: t.status === 'draft' ? body.fee : undefined, // fee is fixed once players could have paid
        restrictions: body.restrictions ? json(body.restrictions) : undefined,
        prizes: body.prizes,
        description: body.description,
        comment_for_players: body.commentForPlayers,
        staff_comment: body.staffComment,
        cover_url: body.coverUrl,
        is_rated: body.isRated,
        rating_coefficient: body.ratingCoefficient,
        refund_rules: body.refundRules ? json(body.refundRules) : undefined,
        series_id: body.seriesId,
        format: json(format),
        settings: json(settings),
        table_ids: tableIds,
      }
      const updated = await trx.updateTable('tournaments').set(patch).where('id', '=', id).returningAll().executeTakeFirstOrThrow()
      if (t.status !== 'draft') {
        await trx
          .updateTable('table_blocks')
          .set({ table_ids: updated.table_ids, starts_at: updated.starts_at, ends_at: updated.estimated_end_at, note: updated.title })
          .where('tournament_id', '=', id)
          .execute()
      }
      await audit({ actorUserId: user.id, clubId: club_id, entity: 'tournament', entityId: id, action: 'update', before: { title: t.title, startsAt: t.starts_at, max: t.max_participants }, after: body }, trx)
      return { estimate, status: updated.status }
    })
    bus.publish(`tournament:${id}`, 'tournament.updated', { tournamentId: id })
    bus.publish(`hall:${hall_id}`, 'hall.availability_changed', { hallId: hall_id })
    res.json(result)
  }),
)

/** Copy (T-7): a new draft with the same settings and a new date. */
tournamentAdminRouter.post(
  '/:id/copy',
  handler(async (req, res) => {
    const id = intParam(req, 'id')
    const { club_id } = await clubOfTournament(id)
    const user = await requireClubRight(req, club_id, 'tournaments')
    const { startsAt } = parseBody(z.object({ startsAt: z.iso.datetime({ offset: true }).optional() }).default({}), req)
    const created = await db.transaction().execute(async (trx) => {
      const t = await trx.selectFrom('tournaments').selectAll().where('id', '=', id).executeTakeFirstOrThrow()
      const start = startsAt ?? new Date(t.starts_at.getTime() + 7 * 86400000).toISOString()
      const copy = await createTournament(trx, club_id, user.id, {
        type: t.type,
        hallId: t.hall_id,
        title: t.title,
        startsAt: start,
        template: 'gs1',
        templateParams: {},
        format: t.format as never,
        seriesId: t.series_id,
        maxParticipants: t.max_participants,
        minParticipants: t.min_participants,
        fee: t.fee,
        restrictions: t.restrictions,
        prizes: t.prizes,
        description: t.description,
        commentForPlayers: t.comment_for_players,
        staffComment: t.staff_comment,
        coverUrl: t.cover_url,
        tableIds: t.table_ids,
        isRated: t.is_rated,
        ratingCoefficient: Number(t.rating_coefficient),
        refundRules: t.refund_rules,
        settings: t.settings,
      })
      await trx.updateTable('tournaments').set({ copied_from: t.id }).where('id', '=', copy.id).execute()
      await audit({ actorUserId: user.id, clubId: club_id, entity: 'tournament', entityId: copy.id, action: 'copy', after: { from: t.id } }, trx)
      return copy
    })
    res.status(201).json({ id: created.id, slug: created.slug })
  }),
)

/** Cancels a tournament with a reason; players are notified. Money refunds come with online payments (stage 4). */
export async function cancelTournament(tournamentId: number, actorUserId: number | null, reason: string) {
  const users = await db.transaction().execute(async (trx) => {
    const t = await trx.selectFrom('tournaments').selectAll().where('id', '=', tournamentId).forUpdate().executeTakeFirstOrThrow()
    assertTransition('tournament', tournamentStatus, t.status, 'cancelled')
    await trx.updateTable('tournaments').set({ status: 'cancelled', cancelled_reason: reason }).where('id', '=', tournamentId).execute()
    await trx.deleteFrom('table_blocks').where('tournament_id', '=', tournamentId).execute()
    const entries = await trx
      .selectFrom('entries as e')
      .innerJoin('players as p', 'p.id', 'e.player_id')
      .select(['e.id', 'e.status', 'p.user_id'])
      .where('e.tournament_id', '=', tournamentId)
      .where('e.status', 'in', ['awaiting_payment', 'paid', 'checked_in', 'waitlist', 'invited'])
      .execute()
    for (const e of entries) {
      const next: EntryStatus = ['paid', 'checked_in', 'waitlist'].includes(e.status) ? 'removed_by_club' : 'expired'
      await trx.updateTable('entries').set({ status: next, hold_until: null, updated_at: new Date() }).where('id', '=', e.id).execute()
    }
    await audit({ actorUserId, clubId: t.club_id, entity: 'tournament', entityId: tournamentId, action: 'cancel', reason, before: { status: t.status }, after: { status: 'cancelled' } }, trx)
    return { t, userIds: entries.map((e) => e.user_id).filter((x): x is number => x != null) }
  })
  for (const userId of users.userIds) {
    await notify({ userId, type: 'tournament_cancelled', urgent: true, data: { tournamentId, slug: users.t.slug, title: users.t.title, reason } })
  }
  bus.publish(`tournament:${tournamentId}`, 'tournament.updated', { tournamentId })
  bus.publish(`hall:${users.t.hall_id}`, 'hall.availability_changed', { hallId: users.t.hall_id })
}

tournamentAdminRouter.post(
  '/:id/cancel',
  handler(async (req, res) => {
    const id = intParam(req, 'id')
    const { club_id } = await clubOfTournament(id)
    const user = await requireClubRight(req, club_id, 'tournaments', { tournamentId: id })
    const { reason } = parseBody(z.object({ reason: z.string().trim().min(3).max(500) }), req)
    await cancelTournament(id, user.id, reason)
    res.json({ ok: true })
  }),
)

seriesRouter.get(
  '/',
  handler(async (req, res) => {
    const clubId = intParam(req, 'clubId')
    await requireClubRight(req, clubId, 'tournaments')
    const rows = await db
      .selectFrom('series as s')
      .select(['s.id', 's.name', (eb) => eb.selectFrom('tournaments').whereRef('series_id', '=', 's.id').select((x) => x.fn.countAll<number>().as('n')).as('tournaments')])
      .where('s.club_id', '=', clubId)
      .orderBy('s.name')
      .execute()
    res.json(rows.map((r) => ({ ...r, tournaments: Number(r.tournaments ?? 0) })))
  }),
)

seriesRouter.post(
  '/',
  handler(async (req, res) => {
    const clubId = intParam(req, 'clubId')
    const user = await requireClubRight(req, clubId, 'tournaments')
    const { name } = parseBody(z.object({ name: z.string().trim().min(2).max(100) }), req)
    const row = await db.insertInto('series').values({ club_id: clubId, name }).returning(['id', 'name']).executeTakeFirstOrThrow()
    await audit({ actorUserId: user.id, clubId, entity: 'series', entityId: row.id, action: 'create', after: { name } })
    res.status(201).json(row)
  }),
)

tournamentAdminRouter.get(
  '/series/:seriesId',
  handler(async (req, res) => {
    const s = await db.selectFrom('series').selectAll().where('id', '=', intParam(req, 'seriesId')).executeTakeFirst()
    if (!s) throw notFound('series.not_found')
    const items = await db.selectFrom('tournaments').select(['id', 'slug', 'title', 'status', 'starts_at']).where('series_id', '=', s.id).where('status', '<>', 'draft').orderBy('starts_at').execute()
    res.json({ id: s.id, name: s.name, tournaments: items })
  }),
)
