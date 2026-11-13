// Club «Сегодня» (4.10), verification documents (A-1), disputes raised by a club (4.8).

import express, { Router } from 'express'
import type { Request } from 'express'
import { sql } from 'kysely'
import { z } from 'zod'
import { audit } from '../audit.ts'
import { clubAccess, requireClubRight, requireUser } from '../auth/access.ts'
import { db } from '../db/index.ts'
import { badRequest, conflict, forbidden, handler, notFound } from '../http/errors.ts'
import { intParam, parseBody } from '../http/validate.ts'
import { removeFile, saveFile } from '../storage/index.ts'

export const clubDeskRouter = Router()

const OFFSET_MS = 5 * 3600_000

/** Start of today and of this week (Monday) in Almaty time. */
export function almatyDays(now = new Date()) {
  const local = new Date(now.getTime() + OFFSET_MS)
  const today = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - OFFSET_MS)
  const dow = (local.getUTCDay() + 6) % 7
  const week = new Date(today.getTime() - dow * 86400_000)
  return { today, tomorrow: new Date(today.getTime() + 86400_000), week, weekEnd: new Date(week.getTime() + 7 * 86400_000) }
}

async function member(req: Request, clubId: number) {
  const user = requireUser(req)
  const access = await clubAccess(user.id, clubId)
  if (!access && user.platformRole !== 'admin') throw forbidden('club.not_member')
  return { user, rights: access?.rights ?? [], organizer: access?.role === 'organizer' || (!access && user.platformRole === 'admin') }
}

const n = (r: { n: unknown } | undefined) => Number(r?.n ?? 0)
const count = sql<number>`count(*)::int`.as('n')

clubDeskRouter.get(
  '/:id/today',
  handler(async (req, res) => {
    const clubId = intParam(req, 'id')
    const { rights, organizer } = await member(req, clubId)
    const d = almatyDays()
    const [tournaments, bookings, money, scores, checkin, disputes, invitations] = await Promise.all([
      db
        .selectFrom('tournaments as t')
        .select(['t.id', 't.title', 't.slug', 't.starts_at', 't.status'])
        .select((eb) => [
          eb.selectFrom('entries as e').select(count).whereRef('e.tournament_id', '=', 't.id').where('e.status', 'in', ['awaiting_payment', 'paid', 'checked_in', 'playing', 'completed']).as('entries'),
          eb.selectFrom('entries as e').select(count).whereRef('e.tournament_id', '=', 't.id').where('e.status', 'in', ['checked_in', 'playing', 'completed']).as('checked_in'),
        ])
        .where('t.club_id', '=', clubId)
        .where('t.status', 'not in', ['draft', 'cancelled'])
        .where('t.starts_at', '>=', d.today)
        .where('t.starts_at', '<', d.tomorrow)
        .orderBy('t.starts_at')
        .execute(),
      db
        .selectFrom('bookings as b')
        .innerJoin('hall_tables as ht', 'ht.id', 'b.table_id')
        .leftJoin('players as p', 'p.id', 'b.player_id')
        .select(['b.id', 'b.starts_at', 'b.ends_at', 'b.status', 'ht.number as table', 'b.guest_name', 'p.first_name', 'p.last_name'])
        .where('b.club_id', '=', clubId)
        .where('b.status', 'in', ['held', 'confirmed', 'arrived', 'no_show'])
        .where('b.starts_at', '>=', d.today)
        .where('b.starts_at', '<', d.tomorrow)
        .orderBy('b.starts_at')
        .limit(100)
        .execute(),
      organizer || rights.includes('finance')
        ? db
            .selectFrom('payments')
            .select([sql<string>`coalesce(sum(amount), 0)`.as('expected'), sql<string>`coalesce(sum(amount) filter (where status = 'succeeded'), 0)`.as('collected')])
            .where('club_id', '=', clubId)
            .where('status', 'not in', ['declined', 'expired', 'refunded_full'])
            .where('created_at', '>=', d.week)
            .where('created_at', '<', d.weekEnd)
            .executeTakeFirst()
        : null,
      db
        .selectFrom('matches as m')
        .innerJoin('tournaments as t', 't.id', 'm.tournament_id')
        .select(count)
        .where('t.club_id', '=', clubId)
        .where((eb) => eb.or([eb.and([eb('m.reported_score', 'is not', null), eb('m.status', 'not in', ['finished', 'retired', 'walkover', 'annulled'])]), eb('m.disputed', '=', true)]))
        .executeTakeFirst(),
      db
        .selectFrom('entries as e')
        .innerJoin('tournaments as t', 't.id', 'e.tournament_id')
        .select(count)
        .where('t.club_id', '=', clubId)
        .where('t.status', 'in', ['published', 'registration_closed', 'running'])
        .where('t.starts_at', '>=', d.today)
        .where('t.starts_at', '<', d.tomorrow)
        .where('e.status', '=', 'paid')
        .executeTakeFirst(),
      db.selectFrom('disputes').select(count).where('club_id', '=', clubId).where('status', '=', 'open').executeTakeFirst(),
      db.selectFrom('club_invitations').select(count).where('club_id', '=', clubId).where('status', '=', 'sent').where('expires_at', '>', new Date()).executeTakeFirst(),
    ])
    res.json({
      date: new Date(d.today.getTime() + OFFSET_MS).toISOString().slice(0, 10),
      tournaments: tournaments.map((t) => ({ id: t.id, title: t.title, slug: t.slug, startsAt: t.starts_at, status: t.status, entries: Number(t.entries ?? 0), checkedIn: Number(t.checked_in ?? 0) })),
      bookings: bookings.map((b) => ({ id: b.id, startsAt: b.starts_at, endsAt: b.ends_at, status: b.status, table: b.table, name: b.last_name ? `${b.last_name} ${b.first_name}` : b.guest_name })),
      week: money ? { from: new Date(d.week.getTime() + OFFSET_MS).toISOString().slice(0, 10), expected: Number(money.expected), collected: Number(money.collected) } : null,
      tasks: { scores: n(scores), checkin: n(checkin), disputes: n(disputes), invitations: n(invitations) },
    })
  }),
)

// ---------------------------------------------------------------------------
// Documents

const DOC_TYPES: Record<string, string> = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png' }

export const listDocuments = (clubIds: number[]) =>
  clubIds.length
    ? db.selectFrom('club_documents').select(['id', 'club_id', 'name', 'url', 'mime', 'size', 'created_at']).where('club_id', 'in', clubIds).orderBy('id').execute()
    : Promise.resolve([])

const docView = (d: Awaited<ReturnType<typeof listDocuments>>[number]) => ({ id: d.id, name: d.name, url: d.url, mime: d.mime, size: d.size, createdAt: d.created_at })
export const documentsByClub = async (clubIds: number[]) => {
  const map = new Map<number, ReturnType<typeof docView>[]>()
  for (const d of await listDocuments(clubIds)) map.set(d.club_id, [...(map.get(d.club_id) ?? []), docView(d)])
  return map
}

clubDeskRouter.get(
  '/:id/documents',
  handler(async (req, res) => {
    const clubId = intParam(req, 'id')
    await requireClubRight(req, clubId, 'club')
    res.json((await listDocuments([clubId])).map(docView))
  }),
)

clubDeskRouter.post(
  '/:id/documents',
  express.raw({ type: Object.keys(DOC_TYPES), limit: 10 * 1024 * 1024 }),
  handler(async (req, res) => {
    const clubId = intParam(req, 'id')
    const user = await requireClubRight(req, clubId, 'club')
    const mime = req.get('content-type')?.split(';')[0]?.trim() ?? ''
    const ext = DOC_TYPES[mime]
    if (!ext || !Buffer.isBuffer(req.body) || req.body.length === 0) throw badRequest('upload.invalid_type')
    if (n(await db.selectFrom('club_documents').select(count).where('club_id', '=', clubId).executeTakeFirst()) >= 20) throw conflict('club.too_many_documents')
    let name = ''
    try {
      name = decodeURIComponent(req.get('x-file-name') ?? '').slice(0, 200)
    } catch {
      /* malformed name */
    }
    const url = await saveFile('club-docs', req.body, ext)
    const row = await db
      .insertInto('club_documents')
      .values({ club_id: clubId, name: name || `document.${ext}`, url, mime, size: req.body.length, uploaded_by: user.id })
      .returning('id')
      .executeTakeFirstOrThrow()
    await audit({ actorUserId: user.id, clubId, entity: 'club', entityId: clubId, action: 'document_add', after: { id: row.id, name } })
    res.status(201).json({ id: row.id, url })
  }),
)

clubDeskRouter.delete(
  '/:id/documents/:docId',
  handler(async (req, res) => {
    const clubId = intParam(req, 'id')
    const user = await requireClubRight(req, clubId, 'club')
    const doc = await db.deleteFrom('club_documents').where('id', '=', intParam(req, 'docId')).where('club_id', '=', clubId).returning(['id', 'name', 'url']).executeTakeFirst()
    if (!doc) throw notFound()
    await removeFile(doc.url)
    await audit({ actorUserId: user.id, clubId, entity: 'club', entityId: clubId, action: 'document_remove', before: { id: doc.id, name: doc.name } })
    res.json({ ok: true })
  }),
)

// ---------------------------------------------------------------------------
// Disputes raised by the club; only the platform admin resolves them.

const SUBJECTS = ['payment', 'booking', 'tournament', 'player', 'other'] as const

clubDeskRouter.post(
  '/:id/disputes',
  handler(async (req, res) => {
    const clubId = intParam(req, 'id')
    const user = await requireClubRight(req, clubId, 'organizer_only')
    const body = parseBody(z.object({ subject: z.enum(SUBJECTS), ref: z.string().trim().max(60).default(''), reason: z.string().trim().min(3).max(2000) }), req)
    const row = await db
      .insertInto('disputes')
      .values({ entity: `club_${body.subject}`, entity_id: body.ref || '-', club_id: clubId, user_id: user.id, reason: body.reason })
      .returning('id')
      .executeTakeFirstOrThrow()
    await audit({ actorUserId: user.id, clubId, entity: 'dispute', entityId: row.id, action: 'open', after: body })
    res.status(201).json({ id: row.id })
  }),
)
