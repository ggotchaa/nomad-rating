// B-10 against a real database: two simultaneous bookings of one slot → exactly one succeeds.
// Runs only with DATABASE_URL pointing at a seeded database (`npm run dev:reset`).

import { afterAll, describe, expect, it } from 'vitest'

const enabled = Boolean(process.env.DATABASE_URL)

describe.skipIf(!enabled)('booking concurrency (database)', () => {
  const created: number[] = []
  let close: (() => Promise<void>) | undefined

  afterAll(async () => {
    if (!close) return
    const { db } = await import('../db/index.ts')
    if (created.length) await db.deleteFrom('bookings').where('id', 'in', created).execute()
    await close()
  })

  it('lets only one of two parallel requests take the slot', async () => {
    const { db } = await import('../db/index.ts')
    const { createBooking } = await import('../modules/bookings.ts')
    const { addDays, isoWeekday, utcToZoned, zonedToUtc } = await import('@nomad/shared')
    close = () => db.destroy()

    const hall = await db
      .selectFrom('halls as h')
      .innerJoin('clubs as c', 'c.id', 'h.club_id')
      .innerJoin('hall_tables as t', 't.hall_id', 'h.id')
      .select(['h.id', 'h.timezone', 'h.opening_hours', 't.id as table_id'])
      .where('c.status', '=', 'active')
      .where('t.bookable', '=', true)
      .where('t.status', '=', 'active')
      .executeTakeFirst()
    expect(hall, "seeded hall").toBeTruthy()
    if (!hall) return
    const players = await db.selectFrom('players').select('id').limit(2).execute()
    // A day 3–9 days ahead that is open, at its last full hour (rarely booked by the seed).
    let start: Date | null = null
    for (let d = 3; d < 10 && !start; d++) {
      const date = addDays(utcToZoned(new Date(), hall.timezone).date, d)
      const day = (hall.opening_hours as Record<string, { open: number; close: number } | null>)[String(isoWeekday(date))]
      if (day) start = zonedToUtc(date, day.close - 60, hall.timezone)
    }
    expect(start, "open day").toBeTruthy()
    if (!start) return
    await db.deleteFrom('bookings').where('table_id', '=', hall.table_id).where('starts_at', '=', start).execute()
    await db.deleteFrom('table_blocks').where('hall_id', '=', hall.id).where('starts_at', '<', new Date(start.getTime() + 3600_000)).where('ends_at', '>', start).where('kind', '!=', 'tournament').execute()

    const attempt = (playerId: number) =>
      db.transaction().execute((trx) => createBooking(trx, { hallId: hall.id, tableId: hall.table_id, start: start!, minutes: 60, playerId, source: 'phone', actorUserId: null }))
    const results = await Promise.allSettled(players.map((p) => attempt(p.id)))
    for (const r of results) if (r.status === 'fulfilled') created.push(r.value.id)
    const failed = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[]
    expect(created).toHaveLength(1)
    expect(failed).toHaveLength(1)
    expect(String((failed[0]!.reason as { code?: string; message?: string }).code ?? failed[0]!.reason)).toMatch(/slot_taken|bookings_no_overlap|23P01/)
  })
})
