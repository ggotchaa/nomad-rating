// Club registration and verification (C-1…C-3, A-1), requisites (organiser only), halls.

import { Router } from 'express'
import { z } from 'zod'
import { assertTransition, clubStatus, slugify } from '@nomad/shared'
import type { ClubStatus } from '@nomad/shared'
import { db, json } from '../db/index.ts'
import { audit } from '../audit.ts'
import { clubAccess, requireClubRight, requireUser } from '../auth/access.ts'
import { badRequest, forbidden, handler, notFound } from '../http/errors.ts'
import { intParam, parseBody } from '../http/validate.ts'
import { bus } from '../realtime/bus.ts'

export const clubManageRouter = Router()

const DEFAULT_HOURS = Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((d) => [String(d), { open: 9 * 60, close: 22 * 60 }]))

async function uniqueSlug(name: string): Promise<string> {
  const base = slugify(name) || 'club'
  for (let i = 0; ; i++) {
    const slug = i ? `${base}-${i + 1}` : base
    if (!(await db.selectFrom('clubs').select('id').where('slug', '=', slug).executeTakeFirst())) return slug
  }
}

const newClub = z.object({
  name: z.string().trim().min(2).max(120),
  cityId: z.number().int().positive(),
  description: z.string().max(5000).default(''),
  contactEmail: z.email().optional(),
  contactTelegram: z.string().max(100).optional(),
  hall: z.object({ name: z.string().trim().min(1).max(120), address: z.string().trim().min(3).max(300) }),
})

/** Any signed-in user can register a club; it starts as a draft with one hall. */
clubManageRouter.post(
  '/',
  handler(async (req, res) => {
    const user = requireUser(req)
    const body = parseBody(newClub, req)
    const city = await db.selectFrom('cities').select('timezone').where('id', '=', body.cityId).executeTakeFirst()
    if (!city) throw badRequest('city.not_found')
    const slug = await uniqueSlug(body.name)
    const club = await db.transaction().execute(async (trx) => {
      const c = await trx
        .insertInto('clubs')
        .values({
          slug,
          name: body.name,
          description: body.description,
          city_id: body.cityId,
          owner_user_id: user.id,
          contact_email: body.contactEmail ?? null,
          contact_telegram: body.contactTelegram ?? null,
        })
        .returning(['id', 'slug'])
        .executeTakeFirstOrThrow()
      await trx.insertInto('club_members').values({ club_id: c.id, user_id: user.id, role: 'organizer' }).execute()
      await trx
        .insertInto('halls')
        .values({ club_id: c.id, name: body.hall.name, address: body.hall.address, timezone: city.timezone, opening_hours: json(DEFAULT_HOURS), is_default: true })
        .execute()
      await audit({ actorUserId: user.id, clubId: c.id, entity: 'club', entityId: c.id, action: 'register', after: body }, trx)
      return c
    })
    await db.updateTable('sessions').set({ active_club_id: club.id }).where('id', '=', user.sessionId).execute()
    res.status(201).json(club)
  }),
)

/** Cabinet view of the club. Requisites are returned to the organiser only. */
clubManageRouter.get(
  '/:id/manage',
  handler(async (req, res) => {
    const clubId = intParam(req, 'id')
    const user = requireUser(req)
    const access = await clubAccess(user.id, clubId)
    if (!access) throw forbidden('club.not_member')
    const club = await db.selectFrom('clubs').selectAll().where('id', '=', clubId).executeTakeFirstOrThrow()
    const halls = await db
      .selectFrom('halls')
      .select(['id', 'name', 'address', 'timezone', 'is_default', (eb) => eb.selectFrom('hall_tables as t').whereRef('t.hall_id', '=', 'halls.id').select((x) => x.fn.countAll<number>().as('n')).as('tables')])
      .where('club_id', '=', clubId)
      .orderBy('is_default', 'desc')
      .orderBy('id')
      .execute()
    res.json({
      id: club.id,
      slug: club.slug,
      name: club.name,
      description: club.description,
      cityId: club.city_id,
      logoUrl: club.logo_url,
      coverUrl: club.cover_url,
      status: club.status,
      statusReason: club.status_reason,
      commentForPlayers: club.comment_for_players,
      contactEmail: club.contact_email,
      contactTelegram: club.contact_telegram,
      telegramUrl: club.telegram_url,
      instagramUrl: club.instagram_url,
      tournamentDefaults: club.tournament_defaults,
      requisites: access.role === 'organizer' ? club.requisites : null,
      role: access.role,
      halls: halls.map((h) => ({ id: h.id, name: h.name, address: h.address, timezone: h.timezone, isDefault: h.is_default, tables: Number(h.tables ?? 0) })),
    })
  }),
)

export async function setClubStatus(clubId: number, to: ClubStatus, actorUserId: number, reason: string | null): Promise<void> {
  await db.transaction().execute(async (trx) => {
    const club = await trx.selectFrom('clubs').select(['status']).where('id', '=', clubId).forUpdate().executeTakeFirst()
    if (!club) throw notFound('club.not_found')
    assertTransition('club', clubStatus, club.status, to)
    await trx
      .updateTable('clubs')
      .set({ status: to, status_reason: reason, ...(to === 'active' && { verified_at: new Date() }) })
      .where('id', '=', clubId)
      .execute()
    await audit({ actorUserId, clubId, entity: 'club', entityId: clubId, action: 'status', before: { status: club.status }, after: { status: to }, reason }, trx)
  })
  bus.publish(`club:${clubId}`, 'club.status', { status: to })
}

clubManageRouter.post(
  '/:id/submit',
  handler(async (req, res) => {
    const clubId = intParam(req, 'id')
    const user = await requireClubRight(req, clubId, 'organizer_only')
    await setClubStatus(clubId, 'review', user.id, null)
    res.json({ status: 'review' })
  }),
)

const requisites = z.object({
  legalName: z.string().trim().min(2).max(200),
  bin: z.string().regex(/^\d{12}$/, 'BIN/IIN: 12 digits'),
  iban: z
    .string()
    .transform((v) => v.replace(/\s+/g, '').toUpperCase())
    .pipe(z.string().regex(/^KZ\d{2}[A-Z0-9]{16}$/, 'IBAN KZ…')),
  bank: z.string().trim().max(200).default(''),
  bik: z.string().trim().max(20).default(''),
})

clubManageRouter.put(
  '/:id/requisites',
  handler(async (req, res) => {
    const clubId = intParam(req, 'id')
    const user = await requireClubRight(req, clubId, 'organizer_only')
    const body = parseBody(requisites, req)
    await db.updateTable('clubs').set({ requisites: json(body) }).where('id', '=', clubId).execute()
    // Requisites are not copied into the audit log, only the fact of the change.
    await audit({ actorUserId: user.id, clubId, entity: 'club', entityId: clubId, action: 'requisites' })
    res.json(body)
  }),
)

clubManageRouter.post(
  '/:id/halls',
  handler(async (req, res) => {
    const clubId = intParam(req, 'id')
    const user = await requireClubRight(req, clubId, 'club')
    const body = parseBody(
      z.object({ name: z.string().trim().min(1).max(120), address: z.string().trim().min(3).max(300), timezone: z.string().max(60).default('Asia/Almaty') }),
      req,
    )
    const hall = await db
      .insertInto('halls')
      .values({ club_id: clubId, name: body.name, address: body.address, timezone: body.timezone, opening_hours: json(DEFAULT_HOURS) })
      .returning('id')
      .executeTakeFirstOrThrow()
    await audit({ actorUserId: user.id, clubId, entity: 'hall', entityId: hall.id, action: 'create', after: body })
    res.status(201).json({ id: hall.id })
  }),
)
