// Club finance (spec 4.10 «Финансы»): payments collected at the club, grouped by source, with the platform commission.

import { Router } from 'express'
import ExcelJS from 'exceljs'
import { sql } from 'kysely'
import { z } from 'zod'
import { toTenge } from '@nomad/shared'
import { requireClubRight } from '../auth/access.ts'
import { db } from '../db/index.ts'
import { handler, unprocessable } from '../http/errors.ts'
import { intParam, isoDate, pageQuery, parseQuery } from '../http/validate.ts'

export const financeRouter = Router()

const OFFSET = '+05:00'
const SOURCES = ['tournament_entry', 'booking', 'season'] as const
type Source = (typeof SOURCES)[number]

const query = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  source: z.enum(SOURCES).optional(),
  ...pageQuery,
})

function period(from?: string, to?: string) {
  const now = new Date(Date.now() + 5 * 3600_000)
  const y = now.getUTCFullYear()
  const m = now.getUTCMonth()
  const f = from ?? new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10)
  const t = to ?? new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10)
  if (t < f) throw unprocessable('finance.bad_period')
  const end = new Date(`${t}T00:00:00${OFFSET}`)
  end.setUTCDate(end.getUTCDate() + 1)
  return { from: f, to: t, start: new Date(`${f}T00:00:00${OFFSET}`), end }
}

function base(clubId: number, start: Date, end: Date, source?: Source) {
  return db
    .selectFrom('payments as pay')
    .where('pay.club_id', '=', clubId)
    .where('pay.created_at', '>=', start)
    .where('pay.created_at', '<', end)
    .$if(source != null, (q) => q.where('pay.purpose', '=', source as Source))
}

function rows(clubId: number, start: Date, end: Date, source?: Source) {
  return base(clubId, start, end, source)
    .leftJoin('entries as e', 'e.payment_id', 'pay.id')
    .leftJoin('tournaments as t', 't.id', 'e.tournament_id')
    .leftJoin('bookings as b', 'b.payment_id', 'pay.id')
    .leftJoin('halls as h', 'h.id', 'b.hall_id')
    .leftJoin('players as p', (j) => j.on(sql<boolean>`p.id = coalesce(e.player_id, b.player_id)`))
    .select([
      'pay.id',
      'pay.created_at',
      'pay.purpose',
      'pay.amount',
      'pay.commission',
      'pay.status',
      'pay.method',
      't.id as tournament_id',
      't.title as tournament_title',
      'b.id as booking_id',
      'b.starts_at as booking_starts_at',
      'h.name as hall_name',
      'b.guest_name',
      'p.first_name',
      'p.last_name',
    ])
    .orderBy('pay.created_at', 'desc')
    .orderBy('pay.id', 'desc')
}

type Row = Awaited<ReturnType<ReturnType<typeof rows>['execute']>>[number]

const mapRow = (r: Row) => ({
  id: r.id,
  date: r.created_at,
  source: r.purpose,
  title: r.tournament_title ?? r.hall_name ?? null,
  tournamentId: r.tournament_id,
  bookingId: r.booking_id,
  bookingStartsAt: r.booking_starts_at,
  payer: r.last_name ? `${r.last_name} ${r.first_name}` : r.guest_name,
  amount: r.amount,
  commission: r.commission,
  net: r.amount - r.commission,
  status: r.status,
  method: r.method,
})

financeRouter.get(
  '/:id/finance',
  handler(async (req, res) => {
    const clubId = intParam(req, 'id')
    await requireClubRight(req, clubId, 'finance')
    const q = parseQuery(query, req)
    const p = period(q.from, q.to)
    const [groups, list, total] = await Promise.all([
      base(clubId, p.start, p.end)
        // At-club payments stay «created» until collected; only cancelled / failed ones are left out.
        .where('pay.status', 'not in', ['declined', 'expired', 'refunded_full'])
        .select(['pay.purpose', sql<string>`sum(pay.amount)`.as('gross'), sql<string>`sum(pay.commission)`.as('commission'), sql<string>`count(*)`.as('count')])
        .groupBy('pay.purpose')
        .execute(),
      rows(clubId, p.start, p.end, q.source).limit(q.limit).offset(q.offset).execute(),
      base(clubId, p.start, p.end, q.source).select(sql<string>`count(*)`.as('n')).executeTakeFirstOrThrow(),
    ])
    const bySource = SOURCES.map((source) => {
      const g = groups.find((x) => x.purpose === source)
      const gross = Number(g?.gross ?? 0)
      const commission = Number(g?.commission ?? 0)
      return { source, gross, commission, net: gross - commission, count: Number(g?.count ?? 0) }
    })
    const sum = (k: 'gross' | 'commission' | 'net' | 'count') => bySource.reduce((s, x) => s + x[k], 0)
    res.json({
      from: p.from,
      to: p.to,
      bySource,
      totals: { gross: sum('gross'), commission: sum('commission'), net: sum('net'), count: sum('count') },
      rows: list.map(mapRow),
      total: Number(total.n),
    })
  }),
)

financeRouter.get(
  '/:id/finance/export',
  handler(async (req, res) => {
    const clubId = intParam(req, 'id')
    await requireClubRight(req, clubId, 'finance')
    const q = parseQuery(query, req)
    const p = period(q.from, q.to)
    const list = (await rows(clubId, p.start, p.end, q.source).limit(20000).execute()).map(mapRow)
    const book = new ExcelJS.Workbook()
    const sheet = book.addWorksheet('Payments')
    sheet.columns = [
      { header: 'ID', key: 'id', width: 8 },
      { header: 'Date', key: 'date', width: 20 },
      { header: 'Source', key: 'source', width: 18 },
      { header: 'Title', key: 'title', width: 32 },
      { header: 'Payer', key: 'payer', width: 28 },
      { header: 'Amount, ₸', key: 'amount', width: 12 },
      { header: 'Commission, ₸', key: 'commission', width: 14 },
      { header: 'Net, ₸', key: 'net', width: 12 },
      { header: 'Status', key: 'status', width: 12 },
      { header: 'Method', key: 'method', width: 10 },
    ]
    for (const r of list) {
      sheet.addRow({ ...r, date: new Date(r.date), amount: toTenge(r.amount), commission: toTenge(r.commission), net: toTenge(r.net) })
    }
    sheet.getRow(1).font = { bold: true }
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename="finance-${clubId}-${p.from}_${p.to}.xlsx"`)
    res.send(Buffer.from(await book.xlsx.writeBuffer()))
  }),
)
