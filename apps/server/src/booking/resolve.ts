// Moving and cancelling bookings by the club: drag on the desk, tournament over a booking, closed hall (B-7, 3.4).

import { DEFAULT_BOOKING_SETTINGS, dayWindow, suggestMoves } from '@nomad/engine'
import type { BookingSettings, OpeningHours } from '@nomad/engine'
import { assertTransition, BOOKING_OCCUPYING, bookingStatus, utcToZoned } from '@nomad/shared'
import { audit } from '../audit.ts'
import { config } from '../config.ts'
import type { Transaction } from '../db/index.ts'
import { db, isExclusionViolation } from '../db/index.ts'
import type { Database } from '../db/types.ts'
import { conflict, notFound, unprocessable } from '../http/errors.ts'
import { notify } from '../notify/index.ts'
import { coversTable, hallBlocks, lockHall } from './blocks.ts'

type Trx = Transaction<Database>

const when = (d: Date, tz: string) => d.toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: tz })

/** Notifies the booking's player (if he has an account) — reaches push / Telegram by his prefs. */
export async function notifyBooking(executor: Trx | typeof db, bookingId: number, type: string, extra: Record<string, unknown> = {}) {
  const b = await executor
    .selectFrom('bookings as b')
    .innerJoin('hall_tables as t', 't.id', 'b.table_id')
    .innerJoin('halls as h', 'h.id', 'b.hall_id')
    .innerJoin('clubs as c', 'c.id', 'b.club_id')
    .leftJoin('players as p', 'p.id', 'b.player_id')
    .select(['b.id', 'b.starts_at', 'b.ends_at', 'b.price', 'b.cancel_token', 't.number', 'h.timezone', 'h.address', 'c.name as club', 'p.user_id'])
    .where('b.id', '=', bookingId)
    .executeTakeFirst()
  if (!b?.user_id) return
  const site = config.SITE_URL.replace(/\/$/, '')
  await notify(
    {
      userId: b.user_id,
      type,
      data: { bookingId: b.id, table: b.number, club: b.club, address: b.address, price: b.price, startsAtText: when(b.starts_at, b.timezone), cancelUrl: `${site}/booking/${b.cancel_token}`, ...extra },
    },
    executor,
  )
}

async function loadBooking(trx: Trx, id: number) {
  const b = await trx.selectFrom('bookings').selectAll().where('id', '=', id).forUpdate().executeTakeFirst()
  if (!b) throw notFound('booking.not_found')
  return b
}

/** Free places for a booking: other tables at the same time, then later slots that day. */
export async function moveOptions(executor: Trx | typeof db, bookingId: number) {
  const b = await executor.selectFrom('bookings').selectAll().where('id', '=', bookingId).executeTakeFirst()
  if (!b) throw notFound('booking.not_found')
  const hall = await executor.selectFrom('halls').select(['timezone', 'opening_hours']).where('id', '=', b.hall_id).executeTakeFirstOrThrow()
  const settings = ((await executor.selectFrom('booking_settings').select('settings').where('hall_id', '=', b.hall_id).executeTakeFirst())?.settings as BookingSettings | undefined) ?? DEFAULT_BOOKING_SETTINGS
  const date = utcToZoned(b.starts_at, hall.timezone).date
  const window = dayWindow(date, hall.opening_hours as OpeningHours, hall.timezone)
  const from = window?.start ?? b.starts_at
  const to = window?.end ?? b.ends_at
  const [tables, bookings, blocks] = await Promise.all([
    executor.selectFrom('hall_tables').select(['id', 'number']).where('hall_id', '=', b.hall_id).where('bookable', '=', true).where('status', '=', 'active').orderBy('number').execute(),
    executor.selectFrom('bookings').select(['table_id', 'starts_at', 'ends_at']).where('hall_id', '=', b.hall_id).where('id', '!=', b.id).where('status', 'in', [...BOOKING_OCCUPYING]).where('starts_at', '<', to).where('ends_at', '>', from).execute(),
    hallBlocks(executor, b.hall_id, from, to, hall.timezone),
  ])
  const busy = [...bookings.map((x) => ({ tableIds: [x.table_id], start: x.starts_at, end: x.ends_at })), ...blocks.map((x) => ({ tableIds: x.tableIds, start: x.start, end: x.end }))]
  const options = suggestMoves({ booking: { tableId: b.table_id, start: b.starts_at, end: b.ends_at }, tables, busy, window, slotMinutes: settings.slotMinutes, limit: 6 })
  return options.map((o) => ({ ...o, tableNumber: tables.find((t) => t.id === o.tableId)!.number }))
}

/** Moves a booking to another table and/or time; the EXCLUDE constraint guards against overlaps. */
export async function moveBooking(trx: Trx, id: number, target: { tableId: number; start: Date }, actorUserId: number) {
  const hallId = (await trx.selectFrom('bookings').select('hall_id').where('id', '=', id).executeTakeFirst())?.hall_id
  if (hallId) await lockHall(trx, hallId)
  const b = await loadBooking(trx, id)
  if (!(BOOKING_OCCUPYING as readonly string[]).includes(b.status) || b.status === 'no_show') throw conflict('booking.not_movable')
  const table = await trx.selectFrom('hall_tables').select(['id', 'number', 'hall_id']).where('id', '=', target.tableId).executeTakeFirst()
  if (!table || table.hall_id !== b.hall_id) throw unprocessable('booking.table_not_bookable')
  const end = new Date(target.start.getTime() + (b.ends_at.getTime() - b.starts_at.getTime()))
  const hall = await trx.selectFrom('halls').select('timezone').where('id', '=', b.hall_id).executeTakeFirstOrThrow()
  const blocks = await hallBlocks(trx, b.hall_id, target.start, end, hall.timezone)
  if (blocks.some((x) => coversTable(x, table.id))) throw conflict('booking.slot_blocked')
  try {
    await trx.updateTable('bookings').set({ table_id: table.id, starts_at: target.start, ends_at: end, updated_at: new Date() }).where('id', '=', id).execute()
  } catch (err) {
    if (isExclusionViolation(err)) throw conflict('booking.slot_taken')
    throw err
  }
  await audit({ actorUserId, clubId: b.club_id, entity: 'booking', entityId: id, action: 'move', before: { tableId: b.table_id, start: b.starts_at }, after: { tableId: table.id, start: target.start } }, trx)
  await notifyBooking(trx, id, 'booking_moved')
  return { hallId: b.hall_id, tableId: table.id, tableNumber: table.number, start: target.start, end }
}

export async function cancelByClub(trx: Trx, id: number, reason: string, actorUserId: number) {
  const b = await loadBooking(trx, id)
  assertTransition('booking', bookingStatus, b.status, 'cancelled_by_club')
  await trx.updateTable('bookings').set({ status: 'cancelled_by_club', updated_at: new Date() }).where('id', '=', id).execute()
  if (b.payment_id) await trx.updateTable('payments').set({ status: 'expired', updated_at: new Date() }).where('id', '=', b.payment_id).where('method', '=', 'at_club').where('status', '=', 'created').execute()
  await audit({ actorUserId, clubId: b.club_id, entity: 'booking', entityId: id, action: 'cancel_by_club', before: { status: b.status }, after: { status: 'cancelled_by_club' }, reason }, trx)
  await notifyBooking(trx, id, 'booking_cancelled', { reason })
  return { hallId: b.hall_id, tableId: b.table_id }
}
