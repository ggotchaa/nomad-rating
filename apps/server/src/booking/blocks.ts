// One-off and recurring blocks of a hall as a single list of intervals (B-6, B-7).

import { expandRecurring } from '@nomad/engine'
import { addDays, utcToZoned } from '@nomad/shared'
import { sql } from 'kysely'
import type { Transaction } from '../db/index.ts'
import { db } from '../db/index.ts'
import type { Database } from '../db/types.ts'

type Trx = Transaction<Database> | typeof db

export type HallBlock = {
  id: number
  kind: string
  tableIds: number[]
  start: Date
  end: Date
  note: string
  tournamentId: number | null
  recurringId: number | null
}

export const coversTable = (block: { tableIds: number[] }, tableId: number) => block.tableIds.length === 0 || block.tableIds.includes(tableId)

export async function hallBlocks(executor: Trx, hallId: number, from: Date, to: Date, timeZone: string): Promise<HallBlock[]> {
  const [once, recurring] = await Promise.all([
    executor.selectFrom('table_blocks').selectAll().where('hall_id', '=', hallId).where('starts_at', '<', to).where('ends_at', '>', from).execute(),
    executor.selectFrom('recurring_blocks').selectAll().where('hall_id', '=', hallId).execute(),
  ])
  const list: HallBlock[] = once.map((b) => ({ id: b.id, kind: b.kind, tableIds: b.table_ids, start: b.starts_at, end: b.ends_at, note: b.note, tournamentId: b.tournament_id, recurringId: null }))
  if (recurring.length) {
    const byId = new Map(recurring.map((r) => [r.id, r]))
    const occurrences = expandRecurring(
      recurring.map((r) => ({ id: r.id, tableIds: r.table_ids, weekdays: r.weekdays, startMinutes: r.start_minutes, endMinutes: r.end_minutes, validFrom: r.valid_from, validUntil: r.valid_until })),
      addDays(utcToZoned(from, timeZone).date, -1),
      addDays(utcToZoned(to, timeZone).date, 1),
      timeZone,
    )
    for (const o of occurrences) {
      if (o.start >= to || o.end <= from) continue
      const r = byId.get(o.blockId)!
      list.push({ id: -r.id, kind: r.kind, tableIds: r.table_ids, start: o.start, end: o.end, note: r.note, tournamentId: null, recurringId: r.id })
    }
  }
  return list
}

/**
 * Serialises booking writes per hall: without it two parallel inserts can deadlock on the EXCLUDE index;
 * with it the second request sees the first booking and gets a clean 409.
 */
export async function lockHall(trx: Transaction<Database>, hallId: number) {
  await sql`select pg_advisory_xact_lock(${7_000_000_000 + hallId})`.execute(trx)
}
