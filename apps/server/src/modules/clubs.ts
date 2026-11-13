// Clubs, halls and tables (spec 4.13, C-1…C-10) and club-added players (R-8, R-9).

import express, { Router } from 'express'
import { z } from 'zod'
import { DEFAULT_BOOKING_SETTINGS } from '@nomad/engine'
import type { BookingSettings } from '@nomad/engine'
import { START_LEVELS } from '@nomad/shared'
import { db, json } from '../db/index.ts'
import { audit } from '../audit.ts'
import { requireClubRight, requireUser } from '../auth/access.ts'
import { badRequest, conflict, handler, notFound } from '../http/errors.ts'
import { IMAGE_MAX_BYTES, IMAGE_TYPES, saveFile } from '../storage/index.ts'
import { intParam, parseBody } from '../http/validate.ts'
import { playerName } from './players.ts'
import { notify } from '../notify/index.ts'
import { moveBooking, moveOptions } from '../booking/resolve.ts'
import { createClubPlayer, findDuplicates } from './club-players.ts'

export const clubsRouter = Router()
export const hallsRouter = Router()

const ACTIVE_TOURNAMENT = ['published', 'registration_closed', 'running'] as const

export async function hallView(hallId: number) {
  const hall = await db.selectFrom('halls').selectAll().where('id', '=', hallId).executeTakeFirst()
  if (!hall) throw notFound('hall.not_found')
  const tables = await db.selectFrom('hall_tables').selectAll().where('hall_id', '=', hallId).orderBy('number').execute()
  const settings = await db.selectFrom('booking_settings').select('settings').where('hall_id', '=', hallId).executeTakeFirst()
  return {
    id: hall.id,
    clubId: hall.club_id,
    name: hall.name,
    address: hall.address,
    location: hall.lat != null && hall.lng != null ? { lat: hall.lat, lng: hall.lng } : null,
    howToFind: hall.how_to_find,
    parking: hall.parking,
    timezone: hall.timezone,
    openingHours: hall.opening_hours,
    commentForPlayers: hall.comment_for_players,
    equipment: hall.equipment,
    plan: hall.plan,
    tables: tables.map((t) => ({
      id: t.id,
      number: t.number,
      label: t.label ?? `Стол ${t.number}`,
      x: t.x,
      y: t.y,
      rotation: t.rotation,
      bookable: t.bookable,
      pricePerHour: t.price_per_hour,
      model: t.model,
      status: t.status,
    })),
    booking: (settings?.settings as BookingSettings | undefined) ?? DEFAULT_BOOKING_SETTINGS,
  }
}

clubsRouter.get(
  '/',
  handler(async (req, res) => {
    const { city } = z.object({ city: z.string().optional() }).parse(req.query)
    let q = db
      .selectFrom('clubs as c')
      .innerJoin('cities as ci', 'ci.id', 'c.city_id')
      .select([
        'c.id',
        'c.slug',
        'c.name',
        'c.description',
        'c.logo_url',
        'c.cover_url',
        'ci.name_ru as city',
        'ci.slug as city_slug',
        (eb) => eb.selectFrom('halls as h').innerJoin('hall_tables as t', 't.hall_id', 'h.id').whereRef('h.club_id', '=', 'c.id').select((x) => x.fn.countAll<number>().as('n')).as('tables'),
        (eb) =>
          eb
            .selectFrom('halls as h')
            .innerJoin('hall_tables as t', 't.hall_id', 'h.id')
            .whereRef('h.club_id', '=', 'c.id')
            .where('t.bookable', '=', true)
            .select((x) => x.fn.countAll<number>().as('n'))
            .as('bookable_tables'),
        (eb) =>
          eb
            .selectFrom('tournaments as t')
            .whereRef('t.club_id', '=', 'c.id')
            .where('t.status', 'in', [...ACTIVE_TOURNAMENT])
            .where('t.starts_at', '>', new Date())
            .select((x) => x.fn.min('t.starts_at').as('d'))
            .as('next_tournament_at'),
        (eb) => eb.selectFrom('halls as h').whereRef('h.club_id', '=', 'c.id').select('h.address').orderBy('h.is_default', 'desc').limit(1).as('address'),
      ])
      .where('c.status', '=', 'active')
    if (city) q = q.where('ci.slug', '=', city)
    const rows = await q.orderBy('c.name').execute()
    res.json(
      rows.map((r) => ({
        id: r.id,
        slug: r.slug,
        name: r.name,
        description: r.description,
        logoUrl: r.logo_url,
        coverUrl: r.cover_url,
        city: r.city,
        citySlug: r.city_slug,
        address: r.address,
        tables: Number(r.tables ?? 0),
        bookingAvailable: Number(r.bookable_tables ?? 0) > 0,
        nextTournamentAt: r.next_tournament_at,
      })),
    )
  }),
)

clubsRouter.get(
  '/:slug',
  handler(async (req, res) => {
    const club = await db
      .selectFrom('clubs as c')
      .innerJoin('cities as ci', 'ci.id', 'c.city_id')
      .selectAll('c')
      .select(['ci.name_ru as city', 'ci.slug as city_slug'])
      .where('c.slug', '=', String(req.params.slug))
      .executeTakeFirst()
    if (!club || (club.status !== 'active' && !req.user)) throw notFound('club.not_found')
    const halls = await db.selectFrom('halls').select('id').where('club_id', '=', club.id).orderBy('is_default', 'desc').orderBy('id').execute()
    const tournaments = await db
      .selectFrom('tournaments')
      .select(['id', 'slug', 'title', 'starts_at', 'status', 'fee', 'max_participants', 'restrictions'])
      .where('club_id', '=', club.id)
      .where('status', '<>', 'draft')
      .orderBy('starts_at', 'desc')
      .limit(30)
      .execute()
    const now = new Date()
    res.json({
      id: club.id,
      slug: club.slug,
      name: club.name,
      description: club.description,
      city: club.city,
      citySlug: club.city_slug,
      logoUrl: club.logo_url,
      coverUrl: club.cover_url,
      status: club.status,
      commentForPlayers: club.comment_for_players,
      contacts: { telegram: club.contact_telegram, email: club.contact_email, telegramChannel: club.telegram_url, instagram: club.instagram_url },
      hallPaymentEnabled: club.hall_payment_enabled,
      halls: await Promise.all(halls.map((h) => hallView(h.id))),
      upcomingTournaments: tournaments.filter((t) => t.starts_at >= now && t.status !== 'cancelled').reverse(),
      pastTournaments: tournaments.filter((t) => t.starts_at < now).slice(0, 10),
      leagues: await db.selectFrom('leagues').select(['id', 'slug', 'name', 'format']).where('club_id', '=', club.id).orderBy('name').execute(),
    })
  }),
)

// ---------------------------------------------------------------------------
// Club cabinet

const clubUpdate = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  description: z.string().max(5000).optional(),
  cityId: z.number().int().positive().optional(),
  logoUrl: z.string().max(500).nullable().optional(),
  coverUrl: z.string().max(500).nullable().optional(),
  telegramUrl: z.string().max(200).nullable().optional(),
  instagramUrl: z.string().max(200).nullable().optional(),
  contactEmail: z.email().nullable().optional(),
  contactTelegram: z.string().max(100).nullable().optional(),
  tournamentDefaults: z.record(z.string(), z.unknown()).optional(),
  commentForPlayers: z.string().max(5000).optional(),
})

clubsRouter.patch(
  '/:id',
  handler(async (req, res) => {
    const clubId = intParam(req, 'id')
    const user = await requireClubRight(req, clubId, 'club')
    const body = parseBody(clubUpdate, req)
    const before = await db.selectFrom('clubs').selectAll().where('id', '=', clubId).executeTakeFirstOrThrow()
    const values = {
      ...(body.name !== undefined && { name: body.name }),
      ...(body.description !== undefined && { description: body.description }),
      ...(body.cityId !== undefined && { city_id: body.cityId }),
      ...(body.logoUrl !== undefined && { logo_url: body.logoUrl }),
      ...(body.coverUrl !== undefined && { cover_url: body.coverUrl }),
      ...(body.telegramUrl !== undefined && { telegram_url: body.telegramUrl }),
      ...(body.instagramUrl !== undefined && { instagram_url: body.instagramUrl }),
      ...(body.contactEmail !== undefined && { contact_email: body.contactEmail }),
      ...(body.contactTelegram !== undefined && { contact_telegram: body.contactTelegram }),
      ...(body.tournamentDefaults !== undefined && { tournament_defaults: json(body.tournamentDefaults) }),
      ...(body.commentForPlayers !== undefined && { comment_for_players: body.commentForPlayers }),
    }
    if (Object.keys(values).length) await db.updateTable('clubs').set(values).where('id', '=', clubId).execute()
    await audit({ actorUserId: user.id, clubId, entity: 'club', entityId: clubId, action: 'update', before: pick(before, Object.keys(body)), after: body })
    res.json({ ok: true })
  }),
)

clubsRouter.post(
  '/:id/media/:kind',
  express.raw({ type: Object.keys(IMAGE_TYPES), limit: IMAGE_MAX_BYTES }),
  handler(async (req, res) => {
    const clubId = intParam(req, 'id')
    const kind = z.enum(['logo', 'cover']).parse(req.params.kind)
    const user = await requireClubRight(req, clubId, 'club')
    const ext = IMAGE_TYPES[req.get('content-type')?.split(';')[0]?.trim() ?? '']
    if (!ext || !Buffer.isBuffer(req.body) || req.body.length === 0) throw badRequest('upload.invalid_type')
    const url = await saveFile('clubs', req.body, ext)
    await db.updateTable('clubs').set(kind === 'logo' ? { logo_url: url } : { cover_url: url }).where('id', '=', clubId).execute()
    await audit({ actorUserId: user.id, clubId, entity: 'club', entityId: clubId, action: kind, after: { url } })
    res.json({ url })
  }),
)

const pick = (obj: Record<string, unknown>, keys: string[]) => Object.fromEntries(keys.map((k) => [k, obj[k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)]]))

const hoursSchema = z.record(z.string().regex(/^[1-7]$/), z.object({ open: z.number().int().min(0).max(1440), close: z.number().int().min(0).max(1440) }).nullable())

const hallUpdate = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  address: z.string().max(300).optional(),
  location: z.object({ lat: z.number(), lng: z.number() }).nullable().optional(),
  howToFind: z.string().max(2000).optional(),
  parking: z.string().max(1000).optional(),
  timezone: z.string().max(60).optional(),
  openingHours: hoursSchema.optional(),
  commentForPlayers: z.string().max(5000).optional(),
  equipment: z.object({ tables: z.string().max(100), balls: z.string().max(100), floor: z.string().max(100) }).partial().optional(),
  plan: z
    .object({
      width: z.number().positive().max(200),
      length: z.number().positive().max(200),
      landmarks: z.array(z.object({ kind: z.enum(['entrance', 'locker', 'window', 'zone', 'other']), label: z.string().max(60), x: z.number(), y: z.number(), w: z.number().optional(), h: z.number().optional() })),
    })
    .optional(),
})

async function hallClub(hallId: number): Promise<number> {
  const hall = await db.selectFrom('halls').select('club_id').where('id', '=', hallId).executeTakeFirst()
  if (!hall) throw notFound('hall.not_found')
  return hall.club_id
}

hallsRouter.get(
  '/:id',
  handler(async (req, res) => {
    res.json(await hallView(intParam(req, 'id')))
  }),
)

hallsRouter.patch(
  '/:id',
  handler(async (req, res) => {
    const hallId = intParam(req, 'id')
    const clubId = await hallClub(hallId)
    const user = await requireClubRight(req, clubId, 'club', { hallId })
    const body = parseBody(hallUpdate, req)
    const before = await hallView(hallId)
    await db
      .updateTable('halls')
      .set({
        ...(body.name !== undefined && { name: body.name }),
        ...(body.address !== undefined && { address: body.address }),
        ...(body.location !== undefined && { lat: body.location?.lat ?? null, lng: body.location?.lng ?? null }),
        ...(body.howToFind !== undefined && { how_to_find: body.howToFind }),
        ...(body.parking !== undefined && { parking: body.parking }),
        ...(body.timezone !== undefined && { timezone: body.timezone }),
        ...(body.openingHours !== undefined && { opening_hours: json(body.openingHours) }),
        ...(body.commentForPlayers !== undefined && { comment_for_players: body.commentForPlayers }),
        ...(body.equipment !== undefined && { equipment: json(Object.fromEntries(Object.entries(body.equipment).filter(([, v]) => v?.trim()))) }),
        ...(body.plan !== undefined && { plan: json(body.plan) }),
      })
      .where('id', '=', hallId)
      .execute()
    await audit({ actorUserId: user.id, clubId, entity: 'hall', entityId: hallId, action: 'update', before: { address: before.address, openingHours: before.openingHours }, after: body })
    if ((body.address !== undefined && body.address !== before.address) || (body.name !== undefined && body.name !== before.name)) await notifyVenueChange(hallId)
    res.json(await hallView(hallId))
  }),
)

/** Registered players of the hall's upcoming tournaments learn about the new address / hall name. */
async function notifyVenueChange(hallId: number) {
  const rows = await db
    .selectFrom('entries as e')
    .innerJoin('tournaments as t', 't.id', 'e.tournament_id')
    .innerJoin('players as p', 'p.id', 'e.player_id')
    .innerJoin('halls as h', 'h.id', 't.hall_id')
    .select(['p.user_id', 't.id', 't.title', 't.slug', 'h.name', 'h.address'])
    .where('t.hall_id', '=', hallId)
    .where('t.status', 'in', ['published', 'registration_closed'])
    .where('t.starts_at', '>', new Date())
    .where('e.status', 'in', ['awaiting_payment', 'paid', 'checked_in'])
    .where('p.user_id', 'is not', null)
    .execute()
  for (const r of rows) await notify({ userId: r.user_id!, type: 'tournament_venue_changed', data: { tournamentId: r.id, title: r.title, slug: r.slug, hall: r.name, address: r.address } })
}

const tablesSchema = z.object({
  tables: z
    .array(
      z.object({
        id: z.number().int().optional(),
        number: z.number().int().min(1).max(999),
        label: z.string().max(40).nullable().optional(),
        x: z.number().min(0),
        y: z.number().min(0),
        rotation: z.union([z.literal(0), z.literal(90)]).default(0),
        bookable: z.boolean().default(true),
        pricePerHour: z.number().int().min(0).nullable().optional(),
        model: z.string().max(80).nullable().optional(),
        status: z.enum(['active', 'broken']).default('active'),
      }),
    )
    .max(200),
})

/**
 * Replaces the table list of a hall. Removing a table or marking it broken while future bookings or tournaments
 * use it is refused (C-6) unless `relocate` is set: bookings then move to a free table, tournaments get a spare one.
 */
hallsRouter.put(
  '/:id/tables',
  handler(async (req, res) => {
    const hallId = intParam(req, 'id')
    const clubId = await hallClub(hallId)
    const user = await requireClubRight(req, clubId, 'club', { hallId })
    const { tables, relocate } = parseBody(tablesSchema.extend({ relocate: z.boolean().default(false) }), req)
    await db.transaction().execute(async (trx) => {
      const existing = await trx.selectFrom('hall_tables').select(['id', 'number', 'status']).where('hall_id', '=', hallId).execute()
      const keep = new Set(tables.filter((t) => t.id).map((t) => t.id))
      const removed = existing.filter((t) => !keep.has(t.id))
      const broken = existing.filter((e) => e.status !== 'broken' && tables.some((t) => t.id === e.id && t.status === 'broken'))
      const ids = [...removed, ...broken].map((t) => t.id)
      if (ids.length) {
        const busy = await trx
          .selectFrom('bookings')
          .select(['id', 'table_id', 'starts_at'])
          .where('table_id', 'in', ids)
          .where('status', 'in', ['held', 'confirmed'])
          .where('ends_at', '>', new Date())
          .orderBy('starts_at')
          .execute()
        const inTournaments = await trx
          .selectFrom('tournaments')
          .select(['id', 'title', 'table_ids'])
          .where('hall_id', '=', hallId)
          .where('status', 'in', ['draft', ...ACTIVE_TOURNAMENT])
          .execute()
        const tournamentConflicts = inTournaments.filter((t) => t.table_ids.some((id) => ids.includes(id)))
        if ((busy.length || tournamentConflicts.length) && !relocate)
          throw conflict('hall.table_in_use', { bookings: busy, tournaments: tournamentConflicts.map((t) => ({ id: t.id, title: t.title })) })
        for (const b of busy) {
          const options = (await moveOptions(trx, b.id)).filter((o) => !ids.includes(o.tableId))
          const pick = options.find((o) => new Date(o.start).getTime() === b.starts_at.getTime()) ?? options[0]
          if (!pick) throw conflict('hall.no_free_table', { bookingId: b.id })
          await moveBooking(trx, b.id, { tableId: pick.tableId, start: new Date(pick.start) }, user.id)
        }
        const spare = existing.filter((e) => e.status === 'active' && !ids.includes(e.id)).sort((x, y) => x.number - y.number)
        for (const t of tournamentConflicts) {
          const free = spare.filter((e) => !t.table_ids.includes(e.id))
          const swap = new Map(t.table_ids.filter((id) => ids.includes(id)).map((id) => [id, free.shift()?.id ?? null]))
          const next = t.table_ids.map((id) => (swap.has(id) ? swap.get(id) : id)).filter((id): id is number => id != null)
          if (!next.length) throw conflict('hall.no_free_table', { tournamentId: t.id })
          await trx.updateTable('tournaments').set({ table_ids: next }).where('id', '=', t.id).execute()
          await trx.updateTable('table_blocks').set({ table_ids: next }).where('tournament_id', '=', t.id).execute()
          for (const [from, to] of swap)
            await trx.updateTable('matches').set({ table_id: to }).where('tournament_id', '=', t.id).where('table_id', '=', from).where('status', 'in', ['waiting', 'scheduled', 'called']).execute()
          await audit({ actorUserId: user.id, clubId, entity: 'tournament', entityId: t.id, action: 'tables_moved', before: t.table_ids, after: next }, trx)
        }
        if (removed.length) await trx.deleteFrom('hall_tables').where('id', 'in', removed.map((t) => t.id)).execute()
      }
      for (const t of tables) {
        const values = {
          number: t.number,
          label: t.label ?? null,
          x: t.x,
          y: t.y,
          rotation: t.rotation,
          bookable: t.bookable,
          price_per_hour: t.pricePerHour ?? null,
          model: t.model ?? null,
          status: t.status,
        }
        if (t.id) await trx.updateTable('hall_tables').set(values).where('id', '=', t.id).where('hall_id', '=', hallId).execute()
        else await trx.insertInto('hall_tables').values({ hall_id: hallId, ...values }).execute()
      }
      await audit({ actorUserId: user.id, clubId, entity: 'hall', entityId: hallId, action: 'tables', before: existing, after: tables }, trx)
    })
    res.json(await hallView(hallId))
  }),
)

const bookingSettingsSchema = z.object({
  slotMinutes: z.union([z.literal(30), z.literal(60)]),
  minMinutes: z.number().int().min(30).max(600),
  maxMinutes: z.number().int().min(30).max(720),
  horizonDays: z.number().int().min(1).max(90),
  holdMinutes: z.number().int().min(5).max(30),
  freeCancelHours: z.number().int().min(0).max(168),
  defaultPricePerHour: z.number().int().min(0),
  tariffs: z.array(
    z.object({ name: z.string().max(40), days: z.array(z.number().int().min(1).max(7)), from: z.number().int().min(0).max(1440), to: z.number().int().min(0).max(1440), pricePerHour: z.number().int().min(0) }),
  ),
})

hallsRouter.put(
  '/:id/booking-settings',
  handler(async (req, res) => {
    const hallId = intParam(req, 'id')
    const clubId = await hallClub(hallId)
    const user = await requireClubRight(req, clubId, 'club', { hallId })
    const settings = parseBody(bookingSettingsSchema, req)
    await db
      .insertInto('booking_settings')
      .values({ hall_id: hallId, settings: json(settings) })
      .onConflict((oc) => oc.column('hall_id').doUpdateSet({ settings: json(settings) }))
      .execute()
    await audit({ actorUserId: user.id, clubId, entity: 'hall', entityId: hallId, action: 'booking_settings', after: settings })
    res.json(settings)
  }),
)

// ---------------------------------------------------------------------------
// Club players (R-8, R-9)

clubsRouter.get(
  '/:id/players',
  handler(async (req, res) => {
    const clubId = intParam(req, 'id')
    await requireClubRight(req, clubId, 'players')
    const rows = await db
      .selectFrom('players as p')
      .leftJoin('cities as c', 'c.id', 'p.city_id')
      .leftJoin('player_ratings as r', (j) => j.onRef('r.player_id', '=', 'p.id').on('r.kind', '=', 'singles'))
      .select([
        'p.id',
        'p.first_name',
        'p.last_name',
        'p.birth_year',
        'p.gender',
        'p.user_id',
        'p.added_by_club_id',
        'p.start_level',
        'p.requested_level',
        'p.level_status',
        'c.name_ru as city',
        'r.rating',
        (eb) =>
          eb
            .selectFrom('entries as e')
            .innerJoin('tournaments as t', 't.id', 'e.tournament_id')
            .whereRef('e.player_id', '=', 'p.id')
            .where('t.club_id', '=', clubId)
            .select((x) => x.fn.countAll<number>().as('n'))
            .as('tournaments'),
        (eb) =>
          eb
            .selectFrom('bookings as b')
            .whereRef('b.player_id', '=', 'p.id')
            .where('b.club_id', '=', clubId)
            .where('b.status', '=', 'no_show')
            .select((x) => x.fn.countAll<number>().as('n'))
            .as('no_shows'),
      ])
      .where((eb) =>
        eb.or([
          eb('p.added_by_club_id', '=', clubId),
          eb.and([eb('p.level_status', '=', 'pending'), eb('p.city_id', '=', eb.selectFrom('clubs').select('city_id').where('id', '=', clubId))]),
          eb.exists(eb.selectFrom('entries as e').innerJoin('tournaments as t', 't.id', 'e.tournament_id').whereRef('e.player_id', '=', 'p.id').where('t.club_id', '=', clubId).select('e.id')),
          eb.exists(eb.selectFrom('bookings as b').whereRef('b.player_id', '=', 'p.id').where('b.club_id', '=', clubId).select('b.id')),
        ]),
      )
      .orderBy('p.last_name')
      .execute()
    res.json(
      rows.map((r) => ({
        id: r.id,
        name: playerName(r),
        birthYear: r.birth_year,
        gender: r.gender,
        city: r.city,
        rating: r.rating,
        startLevel: r.start_level,
        requestedLevel: r.requested_level,
        levelStatus: r.level_status,
        hasAccount: r.user_id != null,
        addedByClub: r.added_by_club_id === clubId,
        tournaments: Number(r.tournaments ?? 0),
        bookingNoShows: Number(r.no_shows ?? 0),
      })),
    )
  }),
)

const newPlayer = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  middleName: z.string().trim().max(80).optional(),
  gender: z.enum(['m', 'f']),
  birthYear: z.number().int().min(1920).max(new Date().getFullYear() - 5),
  cityId: z.number().int().positive(),
  email: z.email().optional(),
  startLevel: z.enum(Object.keys(START_LEVELS) as [keyof typeof START_LEVELS]).default('amateur'),
  /** Create even if similar players exist (the organiser checked the list). */
  force: z.boolean().default(false),
})

clubsRouter.post(
  '/:id/players',
  handler(async (req, res) => {
    const clubId = intParam(req, 'id')
    const user = await requireClubRight(req, clubId, 'players')
    const body = parseBody(newPlayer, req)
    if (!body.force) {
      const similar = await findDuplicates(db, body)
      if (similar.length) throw conflict('player.possible_duplicates', similar)
    }
    const player = await db.transaction().execute((trx) =>
      createClubPlayer(trx, clubId, user.id, { ...body, middleName: body.middleName ?? null, email: body.email ?? null }),
    )
    res.status(201).json({ id: player.id, claimCode: player.claim_code })
  }),
)

export const myRouter = Router()

myRouter.get(
  '/clubs',
  handler(async (req, res) => {
    const user = requireUser(req)
    const rows = await db
      .selectFrom('club_members as m')
      .innerJoin('clubs as c', 'c.id', 'm.club_id')
      .select(['c.id', 'c.slug', 'c.name', 'c.status', 'm.role', 'm.rights', 'm.scope'])
      .where('m.user_id', '=', user.id)
      .execute()
    res.json(await Promise.all(rows.map(async (r) => ({ ...r, halls: await db.selectFrom('halls').select(['id', 'name']).where('club_id', '=', r.id).execute() }))))
  }),
)
