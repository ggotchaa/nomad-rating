// Expired holds (spec 4.3, 4.9): unpaid entries after 15 min, waiting-list invitations after 30 min,
// held bookings after 10 min. Run every minute by the worker.

import { db } from '../db/index.ts'
import { audit } from '../audit.ts'
import { bus } from '../realtime/bus.ts'

export async function expireHolds(now = new Date()): Promise<{ entries: number; bookings: number }> {
  return db.transaction().execute(async (trx) => {
    const entries = await trx
      .updateTable('entries')
      .set({ status: 'expired', updated_at: now })
      .where('status', 'in', ['awaiting_payment', 'invited'])
      .where('hold_until', '<', now)
      .returning(['id', 'tournament_id'])
      .execute()
    const bookings = await trx
      .updateTable('bookings')
      .set({ status: 'expired', updated_at: now })
      .where('status', '=', 'held')
      .where('hold_until', '<', now)
      .returning(['id', 'hall_id'])
      .execute()
    for (const e of entries) await audit({ actorUserId: null, entity: 'entry', entityId: e.id, action: 'hold_expired' }, trx)
    for (const b of bookings) await audit({ actorUserId: null, entity: 'booking', entityId: b.id, action: 'hold_expired' }, trx)
    for (const tid of new Set(entries.map((e) => e.tournament_id))) bus.publish(`tournament:${tid}`, 'tournament.entries_changed', { tournamentId: tid })
    for (const hid of new Set(bookings.map((b) => b.hall_id))) bus.publish(`hall:${hid}`, 'booking.changed', { hallId: hid })
    return { entries: entries.length, bookings: bookings.length }
  })
}
