// Table booking (spec 4.7): availability per table, booking with hold and payment, cancellation,
// the club desk (tables × time grid, phone bookings, arrived / no-show, blocks).

import { Router } from 'express'
import { z } from 'zod'
import { bookingPrice, canCancelFree, DEFAULT_BOOKING_SETTINGS, overlaps, tableSlots, validateBookingRequest } from '@nomad/engine'
import type { BookingSettings, Interval, OpeningHours } from '@nomad/engine'
import { addDays, assertTransition, BOOKING_OCCUPYING, bookingStatus, isoWeekday, utcToZoned, zonedToUtc } from '@nomad/shared'
import type { BookingStatus } from '@nomad/shared'
import { config } from '../config.ts'
import { db } from '../db/index.ts'
import type { Transaction } from '../db/index.ts'
import type { Database } from '../db/types.ts'
import { audit } from '../audit.ts'
import { requireClubRight, requireUser } from '../auth/access.ts'
import { conflict, forbidden, handler, notFound, unprocessable } from '../http/errors.ts'
import { intParam, isoDate, parseBody, parseQuery } from '../http/validate.ts'
import { startPayment } from '../payments/service.ts'
import { bus } from '../realtime/bus.ts'
import { playerName } from './players.ts'

type Trx = Transaction<Database> | typeof db

export const hallBookingsRouter = Router({ mergeParams: true })
export const bookingsRouter = Router()

async function loadHall(executor: Trx, hallId: number) {
  const hall = await executor.selectFrom('halls').selectAll().where('id', '=', hallId).executeTakeFirst()
  if (!hall) throw notFound('hall.not_found')
  const settings = await executor.selectFrom('booking_settings').select('settings').where('hall_id', '=', hallId).executeTakeFirst()
  return { hall, settings: (settings?.settings as BookingSettings | undefined) ?? DEFAULT_BOOKING_SETTINGS, hours: hall.opening_hours as OpeningHours }
}

/** Blocks (tournaments, trainings, closed days) of a hall that touch [from, to). */
async function blocksBetween(executor: Trx, hallId: number, from: Date, to: Date) {
  return executor
    .selectFrom('table_blocks')
    .selectAll()
    .where('hall_id', '=', hallId)
    .where('starts_at', '<', to)
    .where('ends_at', '>', from)
    .execute()
}

const blockCovers = (block: { table_ids: number[] }, tableId: number) => block.table_ids.length === 0 || block.table_ids.includes(tableId)

/** Availability of every table for one local date (B-5, B-7, B-13). */
hallBookingsRouter.get(
  '/availability',
  handler(async (req, res) => {
    const hallId = intParam(req, 'hallId')
    const { date } = parseQuery(z.object({ date: isoDate }), req)
    const { hall, settings, hours } = await loadHall(db, hallId)
    const from = zonedToUtc(date, 0, hall.timezone)
    const to = zonedToUtc(addDays(date, 1), 0, hall.timezone)
    const [tables, bookings, blocks] = await Promise.all([
      db.selectFrom('hall_tables').selectAll().where('hall_id', '=', hallId).orderBy('number').execute(),
      db
        .selectFrom('bookings')
        .select(['table_id', 'starts_at', 'ends_at'])
        .where('hall_id', '=', hallId)
        .where('status', 'in', [...BOOKING_OCCUPYING])
        .where('starts_at', '<', to)
        .where('ends_at', '>', from)
        .execute(),
      blocksBetween(db, hallId, from, to),
    ])
    const now = new Date()
    res.json({
      hallId,
      date,
      timezone: hall.timezone,
      plan: hall.plan,
      settings: { slotMinutes: settings.slotMinutes, minMinutes: settings.minMinutes, maxMinutes: settings.maxMinutes, horizonDays: settings.horizonDays, freeCancelHours: settings.freeCancelHours },
      open: hours[isoWeekday(date) as 1] ?? null,
      tables: tables.map((t) => {
        const busy: Interval[] = bookings.filter((b) => b.table_id === t.id).map((b) => ({ start: b.starts_at, end: b.ends_at }))
        const blocked: Interval[] = blocks.filter((b) => blockCovers(b, t.id)).map((b) => ({ start: b.starts_at, end: b.ends_at }))
        const available = t.bookable && t.status === 'active'
        const slots = available ? tableSlots({ date, timeZone: hall.timezone, hours, slotMinutes: settings.slotMinutes, busy, blocked, now }) : []
        return {
          id: t.id,
          number: t.number,
          label: t.label ?? `Стол ${t.number}`,
          x: t.x,
          y: t.y,
          rotation: t.rotation,
          bookable: t.bookable,
          status: t.status,
          slots: slots.map((s) => {
            const local = utcToZoned(s.start, hall.timezone)
            return {
              start: s.start,
              end: s.end,
              free: s.free,
              reason: s.reason ?? null,
              price: bookingPrice({ date, startMinutes: local.minutes, endMinutes: local.minutes + settings.slotMinutes, slotMinutes: settings.slotMinutes, tariffs: settings.tariffs, tablePricePerHour: t.price_per_hour, defaultPricePerHour: settings.defaultPricePerHour }),
            }
          }),
          blocks: blocks.filter((b) => blockCovers(b, t.id)).map((b) => ({ kind: b.kind, start: b.starts_at, end: b.ends_at, note: b.note, tournamentId: b.tournament_id })),
        }
      }),
    })
  }),
)

export type CreateBookingInput = {
  hallId: number
  tableId: number | null
  start: Date
  minutes: number
  playerId: number | null
  guestName?: string | null
  guestContact?: string | null
  note?: string
  source: 'online' | 'phone'
  actorUserId: number | null
}

/** Creates a booking: rules check, hold, payment; the DB EXCLUDE constraint rejects double booking (B-10). */
export async function createBooking(trx: Transaction<Database>, input: CreateBookingInput) {
  const { hall, settings, hours } = await loadHall(trx, input.hallId)
  const club = await trx.selectFrom('clubs').select(['id', 'status', 'hall_payment_enabled']).where('id', '=', hall.club_id).executeTakeFirstOrThrow()
  if (club.status !== 'active') throw forbidden('club.not_active')
  const end = new Date(input.start.getTime() + input.minutes * 60000)
  const local = utcToZoned(input.start, hall.timezone)
  const errors = validateBookingRequest(
    { start: input.start, end },
    { settings, hours, timeZone: hall.timezone, now: input.source === 'phone' ? new Date(Math.min(Date.now(), input.start.getTime())) : new Date(), date: local.date },
  )
  if (errors.length) throw unprocessable('booking.invalid', errors)
  const tables = await trx
    .selectFrom('hall_tables')
    .selectAll()
    .where('hall_id', '=', hall.id)
    .where('bookable', '=', true)
    .where('status', '=', 'active')
    .$if(input.tableId != null, (q) => q.where('id', '=', input.tableId!))
    .orderBy('number')
    .execute()
  if (!tables.length) throw unprocessable('booking.table_not_bookable')
  const blocks = await blocksBetween(trx, hall.id, input.start, end)
  const busy = await trx
    .selectFrom('bookings')
    .select('table_id')
    .where('hall_id', '=', hall.id)
    .where('status', 'in', [...BOOKING_OCCUPYING])
    .where('starts_at', '<', end)
    .where('ends_at', '>', input.start)
    .execute()
  // «Любой свободный»: the first table without a block or booking in the interval.
  const table = tables.find((t) => !blocks.some((b) => blockCovers(b, t.id) && overlaps({ start: b.starts_at, end: b.ends_at }, { start: input.start, end })) && !busy.some((b) => b.table_id === t.id))
  if (!table) throw conflict(input.tableId ? 'booking.slot_taken' : 'booking.no_free_table')
  const price = bookingPrice({ date: local.date, startMinutes: local.minutes, endMinutes: local.minutes + input.minutes, slotMinutes: settings.slotMinutes, tariffs: settings.tariffs, tablePricePerHour: table.price_per_hour, defaultPricePerHour: settings.defaultPricePerHour })
  const booking = await trx
    .insertInto('bookings')
    .values({
      hall_id: hall.id,
      table_id: table.id,
      club_id: hall.club_id,
      player_id: input.playerId,
      guest_name: input.guestName ?? null,
      guest_contact: input.guestContact ?? null,
      created_by: input.actorUserId,
      starts_at: input.start,
      ends_at: end,
      status: 'held',
      hold_until: new Date(Date.now() + settings.holdMinutes * 60000),
      price,
      source: input.source,
      note: input.note ?? '',
    })
    .returning(['id'])
    .executeTakeFirstOrThrow()
  const payment = await startPayment(trx, {
    purpose: 'booking',
    amount: price,
    clubId: hall.club_id,
    userId: input.actorUserId,
    description: `Бронь стола ${table.number}`,
    returnUrl: `${config.SITE_URL}/bookings/${booking.id}`,
    metadata: { bookingId: booking.id },
  })
  let status: BookingStatus = 'held'
  if (payment.confirmed) {
    assertTransition('booking', bookingStatus, 'held', 'confirmed')
    status = 'confirmed'
  }
  await trx.updateTable('bookings').set({ payment_id: payment.paymentId, status, hold_until: status === 'held' ? undefined : null }).where('id', '=', booking.id).execute()
  await audit({ actorUserId: input.actorUserId, clubId: hall.club_id, entity: 'booking', entityId: booking.id, action: 'create', after: { tableId: table.id, start: input.start, minutes: input.minutes, price, source: input.source, status } }, trx)
  return { id: booking.id, status, tableId: table.id, tableNumber: table.number, start: input.start, end, price, paymentMethod: payment.method, redirectUrl: payment.redirectUrl, hallId: hall.id }
}

const bookingRequest = z.object({
  hallId: z.number().int().positive(),
  tableId: z.number().int().positive().nullable().default(null),
  start: z.iso.datetime({ offset: true }),
  minutes: z.number().int().min(30).max(720),
})

bookingsRouter.post(
  '/',
  handler(async (req, res) => {
    const user = requireUser(req)
    if (!user.playerId) throw forbidden('player.profile_required')
    const body = parseBody(bookingRequest, req)
    const booking = await db.transaction().execute((trx) =>
      createBooking(trx, { hallId: body.hallId, tableId: body.tableId, start: new Date(body.start), minutes: body.minutes, playerId: user.playerId, source: 'online', actorUserId: user.id }),
    )
    bus.publish(`hall:${booking.hallId}`, 'booking.changed', { tableId: booking.tableId, start: booking.start, end: booking.end })
    res.status(201).json(booking)
  }),
)

/** Player cancels (B-8): free until `freeCancelHours` before the start; later the payment is not refunded. */
bookingsRouter.delete(
  '/:id',
  handler(async (req, res) => {
    const user = requireUser(req)
    const id = intParam(req, 'id')
    const result = await db.transaction().execute(async (trx) => {
      const b = await trx.selectFrom('bookings').selectAll().where('id', '=', id).forUpdate().executeTakeFirst()
      if (!b) throw notFound('booking.not_found')
      if (b.player_id == null || b.player_id !== user.playerId) throw forbidden()
      if (b.starts_at <= new Date()) throw conflict('booking.already_started')
      assertTransition('booking', bookingStatus, b.status, 'cancelled_by_player')
      const { settings } = await loadHall(trx, b.hall_id)
      const free = canCancelFree(b.starts_at, new Date(), settings.freeCancelHours)
      await trx.updateTable('bookings').set({ status: 'cancelled_by_player', updated_at: new Date() }).where('id', '=', id).execute()
      if (b.payment_id) {
        const p = await trx.selectFrom('payments').select(['method', 'status']).where('id', '=', b.payment_id).executeTakeFirstOrThrow()
        if (p.method === 'at_club' && p.status === 'created') await trx.updateTable('payments').set({ status: 'expired', updated_at: new Date() }).where('id', '=', b.payment_id).execute()
      }
      await audit({ actorUserId: user.id, clubId: b.club_id, entity: 'booking', entityId: id, action: 'cancel', before: { status: b.status }, after: { status: 'cancelled_by_player', freeCancellation: free } }, trx)
      return { hallId: b.hall_id, tableId: b.table_id, freeCancellation: free }
    })
    bus.publish(`hall:${result.hallId}`, 'booking.changed', { tableId: result.tableId })
    res.json({ freeCancellation: result.freeCancellation })
  }),
)

// ---------------------------------------------------------------------------
// Club desk (B-11, scenario 3.4)

async function hallClubId(hallId: number) {
  const h = await db.selectFrom('halls').select('club_id').where('id', '=', hallId).executeTakeFirst()
  if (!h) throw notFound('hall.not_found')
  return h.club_id
}

hallBookingsRouter.get(
  '/bookings',
  handler(async (req, res) => {
    const hallId = intParam(req, 'hallId')
    await requireClubRight(req, await hallClubId(hallId), 'bookings', { hallId })
    const { date, days } = parseQuery(z.object({ date: isoDate, days: z.coerce.number().int().min(1).max(7).default(1) }), req)
    const { hall } = await loadHall(db, hallId)
    const from = zonedToUtc(date, 0, hall.timezone)
    const to = zonedToUtc(addDays(date, days), 0, hall.timezone)
    const [tables, bookings, blocks] = await Promise.all([
      db.selectFrom('hall_tables').select(['id', 'number', 'label', 'bookable', 'status']).where('hall_id', '=', hallId).orderBy('number').execute(),
      db
        .selectFrom('bookings as b')
        .leftJoin('players as p', 'p.id', 'b.player_id')
        .leftJoin('payments as pay', 'pay.id', 'b.payment_id')
        .select(['b.id', 'b.table_id', 'b.starts_at', 'b.ends_at', 'b.status', 'b.source', 'b.price', 'b.guest_name', 'b.guest_contact', 'b.note', 'p.id as player_id', 'p.first_name', 'p.last_name', 'pay.method as payment_method', 'pay.status as payment_status'])
        .where('b.hall_id', '=', hallId)
        .where('b.status', 'not in', ['expired'])
        .where('b.starts_at', '<', to)
        .where('b.ends_at', '>', from)
        .orderBy('b.starts_at')
        .execute(),
      blocksBetween(db, hallId, from, to),
    ])
    res.json({
      hallId,
      date,
      days,
      timezone: hall.timezone,
      openingHours: hall.opening_hours,
      tables,
      bookings: bookings.map((b) => ({
        id: b.id,
        tableId: b.table_id,
        start: b.starts_at,
        end: b.ends_at,
        status: b.status,
        source: b.source,
        price: b.price,
        who: b.player_id ? { playerId: b.player_id, name: playerName({ first_name: b.first_name!, last_name: b.last_name! }) } : { guest: b.guest_name, contact: b.guest_contact },
        note: b.note,
        payment: { method: b.payment_method, status: b.payment_status },
      })),
      blocks: blocks.map((b) => ({ id: b.id, kind: b.kind, tableIds: b.table_ids, start: b.starts_at, end: b.ends_at, note: b.note, tournamentId: b.tournament_id })),
    })
  }),
)

const phoneBooking = z
  .object({
    tableId: z.number().int().positive(),
    start: z.iso.datetime({ offset: true }),
    minutes: z.number().int().min(30).max(720),
    playerId: z.number().int().positive().optional(),
    guestName: z.string().trim().min(2).max(120).optional(),
    guestContact: z.string().trim().max(120).optional(),
    note: z.string().max(500).optional(),
  })
  .refine((v) => v.playerId != null || v.guestName != null, { message: 'playerId or guestName is required', path: ['playerId'] })

hallBookingsRouter.post(
  '/bookings',
  handler(async (req, res) => {
    const hallId = intParam(req, 'hallId')
    const body = parseBody(phoneBooking, req)
    const user = await requireClubRight(req, await hallClubId(hallId), 'bookings', { hallId, tableId: body.tableId })
    const booking = await db.transaction().execute((trx) =>
      createBooking(trx, {
        hallId,
        tableId: body.tableId,
        start: new Date(body.start),
        minutes: body.minutes,
        playerId: body.playerId ?? null,
        guestName: body.guestName ?? null,
        guestContact: body.guestContact ?? null,
        note: body.note ?? '',
        source: 'phone',
        actorUserId: user.id,
      }),
    )
    bus.publish(`hall:${hallId}`, 'booking.changed', { tableId: booking.tableId })
    res.status(201).json(booking)
  }),
)

bookingsRouter.post(
  '/:id/status',
  handler(async (req, res) => {
    const id = intParam(req, 'id')
    const { status, reason } = parseBody(z.object({ status: z.enum(['arrived', 'no_show', 'cancelled_by_club']), reason: z.string().max(500).optional() }), req)
    const b = await db.selectFrom('bookings').selectAll().where('id', '=', id).executeTakeFirst()
    if (!b) throw notFound('booking.not_found')
    const user = await requireClubRight(req, b.club_id, 'bookings', { hallId: b.hall_id, tableId: b.table_id })
    assertTransition('booking', bookingStatus, b.status, status)
    await db.transaction().execute(async (trx) => {
      await trx.updateTable('bookings').set({ status, updated_at: new Date() }).where('id', '=', id).execute()
      await audit({ actorUserId: user.id, clubId: b.club_id, entity: 'booking', entityId: id, action: 'status', before: { status: b.status }, after: { status }, reason: reason ?? null }, trx)
    })
    bus.publish(`hall:${b.hall_id}`, 'booking.changed', { tableId: b.table_id })
    res.json({ ok: true })
  }),
)

/** Blocks for trainings or a closed hall (B-6); paid bookings inside are returned to be moved or refunded (3.4). */
hallBookingsRouter.post(
  '/blocks',
  handler(async (req, res) => {
    const hallId = intParam(req, 'hallId')
    const clubId = await hallClubId(hallId)
    const user = await requireClubRight(req, clubId, 'bookings', { hallId })
    const body = parseBody(
      z.object({
        kind: z.enum(['training', 'closed', 'maintenance']),
        tableIds: z.array(z.number().int()).default([]),
        start: z.iso.datetime({ offset: true }),
        end: z.iso.datetime({ offset: true }),
        note: z.string().max(300).default(''),
      }),
      req,
    )
    const start = new Date(body.start)
    const end = new Date(body.end)
    if (end <= start) throw unprocessable('block.invalid_interval')
    const result = await db.transaction().execute(async (trx) => {
      const block = await trx
        .insertInto('table_blocks')
        .values({ hall_id: hallId, table_ids: body.tableIds, starts_at: start, ends_at: end, kind: body.kind, note: body.note, created_by: user.id })
        .returning('id')
        .executeTakeFirstOrThrow()
      const conflicts = await trx
        .selectFrom('bookings')
        .select(['id', 'table_id', 'starts_at', 'ends_at', 'player_id', 'guest_name'])
        .where('hall_id', '=', hallId)
        .where('status', '=', 'confirmed')
        .where('starts_at', '<', end)
        .where('ends_at', '>', start)
        .$if(body.tableIds.length > 0, (q) => q.where('table_id', 'in', body.tableIds))
        .execute()
      await audit({ actorUserId: user.id, clubId, entity: 'table_block', entityId: block.id, action: 'create', after: body }, trx)
      return { id: block.id, conflicts }
    })
    bus.publish(`hall:${hallId}`, 'hall.availability_changed', { hallId })
    res.status(201).json(result)
  }),
)

// ---------------------------------------------------------------------------
// Player cabinet (S-7)

export const myBookingsRouter = Router()

myBookingsRouter.get(
  '/bookings',
  handler(async (req, res) => {
    const user = requireUser(req)
    if (!user.playerId) {
      res.json([])
      return
    }
    const rows = await db
      .selectFrom('bookings as b')
      .innerJoin('hall_tables as t', 't.id', 'b.table_id')
      .innerJoin('halls as h', 'h.id', 'b.hall_id')
      .innerJoin('clubs as c', 'c.id', 'b.club_id')
      .select(['b.id', 'b.starts_at', 'b.ends_at', 'b.status', 'b.price', 't.number as table_number', 'h.name as hall', 'h.address', 'h.timezone', 'c.name as club', 'c.slug as club_slug'])
      .where('b.player_id', '=', user.playerId)
      .where('b.status', 'not in', ['expired'])
      .orderBy('b.starts_at', 'desc')
      .limit(100)
      .execute()
    res.json(rows)
  }),
)

myBookingsRouter.get(
  '/entries',
  handler(async (req, res) => {
    const user = requireUser(req)
    if (!user.playerId) {
      res.json([])
      return
    }
    const rows = await db
      .selectFrom('entries as e')
      .innerJoin('tournaments as t', 't.id', 'e.tournament_id')
      .innerJoin('clubs as c', 'c.id', 't.club_id')
      .leftJoin('payments as p', 'p.id', 'e.payment_id')
      .select(['e.id', 'e.status', 'e.waitlist_position', 'e.hold_until', 'e.final_place', 't.id as tournament_id', 't.slug', 't.title', 't.starts_at', 't.status as tournament_status', 't.fee', 'c.name as club', 'p.method as payment_method', 'p.status as payment_status'])
      .where('e.player_id', '=', user.playerId)
      .where('e.status', 'not in', ['expired'])
      .orderBy('t.starts_at', 'desc')
      .limit(100)
      .execute()
    res.json(rows)
  }),
)
