// Reminder one hour before a booking (worker, every 5 minutes). `reminded_at` makes it fire once.

import { db } from '../db/index.ts'
import { notifyBooking } from '../booking/resolve.ts'

export async function remindBookings(now = new Date()): Promise<{ sent: number }> {
  const due = await db
    .updateTable('bookings')
    .set({ reminded_at: now })
    .where('status', '=', 'confirmed')
    .where('reminded_at', 'is', null)
    .where('starts_at', '>', now)
    .where('starts_at', '<=', new Date(now.getTime() + 3600_000))
    .where('player_id', 'is not', null)
    .returning('id')
    .execute()
  for (const b of due) await notifyBooking(db, b.id, 'booking_reminder')
  return { sent: due.length }
}
