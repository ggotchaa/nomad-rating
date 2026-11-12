// Booking settings of a hall (B-5…B-9): settings, one-off and recurring blocks, conflicts with existing bookings.

import { Router } from 'express'
import { z } from 'zod'
import { DEFAULT_BOOKING_SETTINGS } from '@nomad/engine'
import type { BookingSettings } from '@nomad/engine'
import { addDays, utcToZoned, zonedToUtc } from '@nomad/shared'
import { audit } from '../audit.ts'
import { requireClubRight } from '../auth/access.ts'
import { hallBlocks } from '../booking/blocks.ts'
import { db } from '../db/index.ts'
import { conflict, handler, notFound, unprocessable } from '../http/errors.ts'
import { intParam, isoDate, parseBody } from '../http/validate.ts'
import { bus } from '../realtime/bus.ts'

export const hallSettingsRouter = Router({ mergeParams: true })

async function hallOf(hallId: number) {
  const h = await db.selectFrom('halls').select(['club_id', 'timezone', 'opening_hours']).where('id', '=', hallId).executeTakeFirst()
  if (!h) throw notFound('hall.not_found')
  return h
}

hallSettingsRouter.get(
  '/booking-settings',
  handler(async (req, res) => {
    const hallId = intParam(req, 'hallId')
    const hall = await hallOf(hallId)
    await requireClubRight(req, hall.club_id, 'bookings', { hallId })
    const [settings, recurring, once] = await Promise.all([
      db.selectFrom('booking_settings').select('settings').where('hall_id', '=', hallId).executeTakeFirst(),
      db.selectFrom('recurring_blocks').selectAll().where('hall_id', '=', hallId).orderBy('id').execute(),
      db.selectFrom('table_blocks').selectAll().where('hall_id', '=', hallId).where('ends_at', '>', new Date()).orderBy('starts_at').limit(200).execute(),
    ])
    res.json({
      timezone: hall.timezone,
      openingHours: hall.opening_hours,
      settings: (settings?.settings as BookingSettings | undefined) ?? DEFAULT_BOOKING_SETTINGS,
      recurring: recurring.map((r) => ({ id: r.id, kind: r.kind, tableIds: r.table_ids, weekdays: r.weekdays, startMinutes: r.start_minutes, endMinutes: r.end_minutes, validFrom: r.valid_from, validUntil: r.valid_until, note: r.note })),
      blocks: once.map((b) => ({ id: b.id, kind: b.kind, tableIds: b.table_ids, start: b.starts_at, end: b.ends_at, note: b.note, tournamentId: b.tournament_id })),
    })
  }),
)

const recurringSchema = z
  .object({
    kind: z.enum(['training', 'closed', 'maintenance']),
    tableIds: z.array(z.number().int().positive()).max(200).default([]),
    weekdays: z.array(z.number().int().min(1).max(7)).min(1).max(7),
    startMinutes: z.number().int().min(0).max(1439),
    endMinutes: z.number().int().min(0).max(1440),
    validFrom: isoDate,
    validUntil: isoDate.nullable().default(null),
    note: z.string().trim().max(300).default(''),
  })
  .refine((v) => v.startMinutes !== v.endMinutes, { message: 'empty interval', path: ['endMinutes'] })
  .refine((v) => !v.validUntil || v.validUntil >= v.validFrom, { message: 'until before from', path: ['validUntil'] })

/** Active bookings that a new block would cover within the next horizon (the club then moves or cancels them). */
async function affectedBookings(hallId: number, timezone: string, tableIds: number[]) {
  const now = new Date()
  const to = zonedToUtc(addDays(utcToZoned(now, timezone).date, 90), 0, timezone)
  const blocks = await hallBlocks(db, hallId, now, to, timezone)
  const bookings = await db
    .selectFrom('bookings as b')
    .leftJoin('players as p', 'p.id', 'b.player_id')
    .select(['b.id', 'b.table_id', 'b.starts_at', 'b.ends_at', 'b.player_id', 'b.guest_name', 'p.first_name', 'p.last_name'])
    .where('b.hall_id', '=', hallId)
    .where('b.status', 'in', ['held', 'confirmed'])
    .where('b.starts_at', '>', now)
    .where('b.starts_at', '<', to)
    .$if(tableIds.length > 0, (q) => q.where('b.table_id', 'in', tableIds))
    .execute()
  return { blocks, bookings: bookings.map(({ first_name, last_name, ...b }) => ({ ...b, guest_name: b.guest_name ?? (last_name ? `${last_name} ${first_name}` : null) })) }
}

hallSettingsRouter.post(
  '/recurring-blocks',
  handler(async (req, res) => {
    const hallId = intParam(req, 'hallId')
    const hall = await hallOf(hallId)
    const user = await requireClubRight(req, hall.club_id, 'bookings', { hallId })
    const body = parseBody(recurringSchema, req)
    if ((await db.selectFrom('recurring_blocks').select('id').where('hall_id', '=', hallId).execute()).length >= 100) throw unprocessable('block.too_many')
    const row = await db
      .insertInto('recurring_blocks')
      .values({ hall_id: hallId, kind: body.kind, table_ids: body.tableIds, weekdays: body.weekdays, start_minutes: body.startMinutes, end_minutes: body.endMinutes, valid_from: body.validFrom, valid_until: body.validUntil, note: body.note, created_by: user.id })
      .returning('id')
      .executeTakeFirstOrThrow()
    await audit({ actorUserId: user.id, clubId: hall.club_id, entity: 'recurring_block', entityId: row.id, action: 'create', after: body })
    const { blocks, bookings } = await affectedBookings(hallId, hall.timezone, body.tableIds)
    const mine = blocks.filter((b) => b.recurringId === row.id)
    const conflicts = bookings.filter((bk) => mine.some((b) => (b.tableIds.length === 0 || b.tableIds.includes(bk.table_id)) && b.start < bk.ends_at && bk.starts_at < b.end))
    bus.publish(`hall:${hallId}`, 'hall.availability_changed', { hallId })
    res.status(201).json({ id: row.id, conflicts })
  }),
)

hallSettingsRouter.delete(
  '/recurring-blocks/:id',
  handler(async (req, res) => {
    const hallId = intParam(req, 'hallId')
    const hall = await hallOf(hallId)
    const user = await requireClubRight(req, hall.club_id, 'bookings', { hallId })
    const id = intParam(req, 'id')
    const row = await db.deleteFrom('recurring_blocks').where('id', '=', id).where('hall_id', '=', hallId).returningAll().executeTakeFirst()
    if (!row) throw notFound('block.not_found')
    await audit({ actorUserId: user.id, clubId: hall.club_id, entity: 'recurring_block', entityId: id, action: 'delete', before: row })
    bus.publish(`hall:${hallId}`, 'hall.availability_changed', { hallId })
    res.json({ ok: true })
  }),
)

hallSettingsRouter.delete(
  '/blocks/:id',
  handler(async (req, res) => {
    const hallId = intParam(req, 'hallId')
    const hall = await hallOf(hallId)
    const user = await requireClubRight(req, hall.club_id, 'bookings', { hallId })
    const id = intParam(req, 'id')
    const row = await db.selectFrom('table_blocks').selectAll().where('id', '=', id).where('hall_id', '=', hallId).executeTakeFirst()
    if (!row) throw notFound('block.not_found')
    if (row.kind === 'tournament') throw conflict('block.tournament_managed')
    await db.deleteFrom('table_blocks').where('id', '=', id).execute()
    await audit({ actorUserId: user.id, clubId: hall.club_id, entity: 'table_block', entityId: id, action: 'delete', before: row })
    bus.publish(`hall:${hallId}`, 'hall.availability_changed', { hallId })
    res.json({ ok: true })
  }),
)

/** Bookings of the hall that overlap a block (tournament or closed hall) and still need a decision. */
hallSettingsRouter.get(
  '/conflicts',
  handler(async (req, res) => {
    const hallId = intParam(req, 'hallId')
    const hall = await hallOf(hallId)
    await requireClubRight(req, hall.club_id, 'bookings', { hallId })
    const { blocks, bookings } = await affectedBookings(hallId, hall.timezone, [])
    const list = bookings
      .map((bk) => ({ booking: bk, block: blocks.find((b) => (b.tableIds.length === 0 || b.tableIds.includes(bk.table_id)) && b.start < bk.ends_at && bk.starts_at < b.end) }))
      .filter((x) => x.block)
      .map((x) => ({ id: x.booking.id, tableId: x.booking.table_id, start: x.booking.starts_at, end: x.booking.ends_at, who: x.booking.guest_name, playerId: x.booking.player_id, block: { kind: x.block!.kind, note: x.block!.note, tournamentId: x.block!.tournamentId } }))
    res.json(list)
  }),
)
