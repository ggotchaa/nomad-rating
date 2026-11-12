// Recurring blocks (B-6) and conflict resolution for bookings displaced by a tournament or a closed hall (B-7, 3.4).

import { addDays, isoWeekday, zonedToUtc } from '@nomad/shared'
import { overlaps } from './booking.ts'
import type { Interval } from './booking.ts'

export type RecurringBlock = {
  id: number
  tableIds: number[]
  weekdays: number[]
  startMinutes: number
  endMinutes: number
  validFrom: string
  validUntil: string | null
}

export type BlockOccurrence = Interval & { blockId: number; tableIds: number[] }

/** Occurrences of recurring blocks on local dates [fromDate, toDate). End before start = through midnight. */
export function expandRecurring(blocks: readonly RecurringBlock[], fromDate: string, toDate: string, timeZone: string): BlockOccurrence[] {
  const out: BlockOccurrence[] = []
  for (let date = fromDate; date < toDate; date = addDays(date, 1)) {
    const weekday = isoWeekday(date)
    for (const b of blocks) {
      if (date < b.validFrom || (b.validUntil && date > b.validUntil) || !b.weekdays.includes(weekday)) continue
      const end = b.endMinutes > b.startMinutes ? b.endMinutes : b.endMinutes + 1440
      const start = zonedToUtc(date, b.startMinutes, timeZone)
      out.push({ blockId: b.id, tableIds: b.tableIds, start, end: new Date(start.getTime() + (end - b.startMinutes) * 60000) })
    }
  }
  return out
}

export type MoveOption = { tableId: number; start: Date; end: Date }

/**
 * Where a displaced booking can go: first another free table at the same time (preferring the nearest number),
 * then later slots the same day on any table. `busy` must hold bookings and blocks per table (empty tableIds = all).
 */
export function suggestMoves(input: {
  booking: Interval & { tableId: number }
  tables: readonly { id: number; number: number }[]
  busy: readonly (Interval & { tableIds: number[] })[]
  window: Interval | null
  slotMinutes: number
  limit?: number
}): MoveOption[] {
  const { booking, tables, busy, window, slotMinutes } = input
  const limit = input.limit ?? 5
  const length = booking.end.getTime() - booking.start.getTime()
  const current = tables.find((t) => t.id === booking.tableId)?.number ?? 0
  const free = (tableId: number, iv: Interval) => !busy.some((b) => (b.tableIds.length === 0 || b.tableIds.includes(tableId)) && overlaps(b, iv))
  const ordered = [...tables].sort((a, b) => Math.abs(a.number - current) - Math.abs(b.number - current) || a.number - b.number)
  const out: MoveOption[] = []
  for (const t of ordered) if (t.id !== booking.tableId && free(t.id, booking)) out.push({ tableId: t.id, start: booking.start, end: booking.end })
  if (window) {
    const step = slotMinutes * 60000
    for (let s = booking.start.getTime() + step; s + length <= window.end.getTime() && out.length < limit; s += step) {
      const iv = { start: new Date(s), end: new Date(s + length) }
      const t = ordered.find((x) => free(x.id, iv))
      if (t) out.push({ tableId: t.id, ...iv })
    }
  }
  return out.slice(0, limit)
}

