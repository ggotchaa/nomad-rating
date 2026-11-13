// Tournaments: formats and preview (F-2, F-4), calendar (T-5), page (T-6, R-19), creation from club
// defaults (T-1, C-3), publication with table blocking (B-7), registration with eligibility, waiting list,
// overlap rule and payment (R-3…R-6, R-28), and the running endpoints (start / result / finish).

import { Router } from 'express'
import { sql } from 'kysely'
import type { ExpressionBuilder } from 'kysely'
import { z } from 'zod'
import { estimateFormat, FORMAT_TEMPLATES, formatTemplate, MEETING_SCHEMES, validateFormat, validateScheme } from '@nomad/engine'
import type { Bracket, FormatTemplateId, StandingsResult, TemplateParams, TournamentFormat } from '@nomad/engine'
import { assertTransition, ENTRY_ACTIVE, ENTRY_OCCUPYING, entryStatus, slugify, tournamentStatus } from '@nomad/shared'
import type { EntryStatus } from '@nomad/shared'
import { config } from '../config.ts'
import { db, json } from '../db/index.ts'
import type { Transaction } from '../db/index.ts'
import type { Database, RefundRule, Tournament, TournamentRestrictions, TournamentsTable } from '../db/types.ts'
import { audit } from '../audit.ts'
import { requireClubRight, requireUser } from '../auth/access.ts'
import { badRequest, conflict, forbidden, handler, notFound, unprocessable } from '../http/errors.ts'
import { intParam, parseBody, parseQuery } from '../http/validate.ts'
import { startPayment } from '../payments/service.ts'
import { bus } from '../realtime/bus.ts'
import { notify } from '../notify/index.ts'
import { finishTournament, recordResult, startTournament } from '../tournaments/structure.ts'
import { playerName } from './players.ts'

export const tournamentsRouter = Router()
export const formatsRouter = Router()
export const clubTournamentsRouter = Router({ mergeParams: true })

type Trx = Transaction<Database>

const FORMAT_NAMES: Record<FormatTemplateId, string> = {
  round_robin: 'Круговая',
  olympic: 'Олимпийская сетка',
  gs1: 'ГС-1. Группы → сетка N на все места',
  gs2: 'ГС-2. Группы → олимпийка N с матчем за 3-е место',
  gs3: 'ГС-3. Группы, выходят все → сетка',
  groups_main_consolation: 'Группы по 4 → основная + утешительная',
}

const stageSchema = z.discriminatedUnion('kind', [
  z.object({ id: z.string().min(1).max(30), kind: z.literal('groups'), name: z.string().min(1).max(60), groupSize: z.number().int(), seeding: z.enum(['snake', 'random', 'manual']), separateClubs: z.boolean().optional() }),
  z.object({ id: z.string().min(1).max(30), kind: z.literal('round_robin'), name: z.string().min(1).max(60) }),
  z.object({ id: z.string().min(1).max(30), kind: z.literal('single_elim'), name: z.string().min(1).max(60), thirdPlace: z.enum(['match', 'shared']) }),
  z.object({ id: z.string().min(1).max(30), kind: z.literal('all_places'), name: z.string().min(1).max(60) }),
])

/** Custom format from the constructor (F-1…F-3); deeper rules are checked by validateFormat (F-5). */
export const formatSchema = z.object({
  version: z.literal(1).default(1),
  template: z.string().default('custom'),
  stages: z.array(stageSchema).min(1).max(6),
  transitions: z.array(
    z.object({
      from: z.string(),
      to: z.string(),
      rule: z.discriminatedUnion('by', [
        z.object({ by: z.literal('places'), places: z.array(z.number().int().min(1).max(8)).min(1) }),
        z.object({ by: z.literal('top'), count: z.number().int().min(2).max(128) }),
        z.object({ by: z.literal('all') }),
        z.object({ by: z.literal('best_of_place'), place: z.number().int().min(1).max(8), count: z.number().int().min(1).max(64) }),
      ]),
    }),
  ),
  placement: z.array(z.object({ stage: z.string(), who: z.enum(['all', 'not_advanced']) })),
  match: z.object({ winsNeeded: z.number().int(), pointsToWin: z.number().int().min(5).max(21).default(11), gamePoints: z.enum(['none', 'optional', 'required']) }),
  groupPoints: z.object({ win: z.number().int(), loss: z.number().int(), walkover: z.number().int() }).default({ win: 2, loss: 1, walkover: 0 }),
  tiebreaks: z.array(z.enum(['h2h_points', 'h2h_sets_ratio', 'h2h_points_ratio', 'rating', 'lots'])).min(1),
  restMinutes: z.number().int(),
})

const templateParams = z
  .object({
    groupSize: z.number().int().min(3).max(8).optional(),
    advance: z.union([z.literal(4), z.literal(8), z.literal(16), z.literal(32), z.literal(64)]).optional(),
    bracket: z.enum(['all_places', 'single_elim']).optional(),
    match: z.object({ winsNeeded: z.number().int().min(2).max(4).optional(), gamePoints: z.enum(['none', 'optional', 'required']).optional() }).optional(),
    restMinutes: z.number().int().min(0).max(30).optional(),
  })
  .default({})

formatsRouter.get('/', (_req, res) => {
  res.json(FORMAT_TEMPLATES.map((id) => ({ id, name: FORMAT_NAMES[id] })))
})

/** Preview before publishing (F-4): stages, matches, duration. */
formatsRouter.post(
  '/preview',
  handler(async (req, res) => {
    const body = parseBody(
      z.object({
        template: z.enum(FORMAT_TEMPLATES).optional(),
        format: formatSchema.optional(),
        params: templateParams,
        players: z.number().int().min(2).max(256),
        tables: z.number().int().min(1).max(100),
        avgMatchMinutes: z.number().int().min(5).max(90).default(20),
      }),
      req,
    )
    const format = body.format ? (body.format as TournamentFormat) : formatTemplate(body.template ?? 'gs1', body.players, body.params as TemplateParams)
    res.json({ format, errors: validateFormat(format), estimate: estimateFormat(format, body.players, { tables: body.tables, avgMatchMinutes: body.avgMatchMinutes }) })
  }),
)

// ---------------------------------------------------------------------------
// Calendar and page

const calendarQuery = z.object({
  city: z.string().optional(),
  club: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  when: z.enum(['upcoming', 'live', 'finished', 'all']).default('upcoming'),
  ratingMin: z.coerce.number().int().optional(),
  ratingMax: z.coerce.number().int().optional(),
  fitsMe: z.enum(['true', 'false']).optional(),
  hasSpots: z.enum(['true', 'false']).optional(),
  type: z.enum(['singles', 'doubles', 'team']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
})

/** Places taken in tournament `t` (used inside queries that alias tournaments as `t`). */
const occupied = (eb: ExpressionBuilder<Database & { t: TournamentsTable }, 't'>) =>
  eb
    .selectFrom('entries as e')
    .whereRef('e.tournament_id', '=', 't.id')
    .where('e.status', 'in', [...ENTRY_OCCUPYING])
    .select((x) => x.fn.countAll<number>().as('n'))

async function playerRatingForChecks(playerId: number) {
  const p = await db
    .selectFrom('players as p')
    .leftJoin('player_ratings as r', (j) => j.onRef('r.player_id', '=', 'p.id').on('r.kind', '=', 'singles'))
    .select(['p.id', 'p.gender', 'p.birth_year', 'p.start_level', 'r.rating'])
    .where('p.id', '=', playerId)
    .executeTakeFirstOrThrow()
  return { ...p, effectiveRating: p.rating ?? p.start_level }
}

tournamentsRouter.get(
  '/',
  handler(async (req, res) => {
    const q = parseQuery(calendarQuery, req)
    const now = new Date()
    let query = db
      .selectFrom('tournaments as t')
      .innerJoin('clubs as c', 'c.id', 't.club_id')
      .innerJoin('halls as h', 'h.id', 't.hall_id')
      .innerJoin('cities as ci', 'ci.id', 'c.city_id')
      .select([
        't.id',
        't.slug',
        't.title',
        't.type',
        't.status',
        't.starts_at',
        't.estimated_end_at',
        't.fee',
        't.max_participants',
        't.restrictions',
        't.cover_url',
        't.is_rated',
        'c.name as club',
        'c.slug as club_slug',
        'h.name as hall',
        'h.address',
        'ci.name_ru as city',
        'ci.slug as city_slug',
        (eb) => occupied(eb).as('taken'),
        (eb) =>
          eb
            .selectFrom('entries as e')
            .leftJoin('player_ratings as r', (j) => j.onRef('r.player_id', '=', 'e.player_id').on('r.kind', '=', 'singles'))
            .whereRef('e.tournament_id', '=', 't.id')
            .where('e.status', 'in', [...ENTRY_OCCUPYING])
            .select(sql<number>`round(avg(coalesce(e.rating_at_start, r.rating)))`.as('a'))
            .as('avg_rating'),
      ])
      .where('t.status', '<>', 'draft')
      .where('c.status', '=', 'active')
    if (q.when === 'upcoming') query = query.where('t.status', 'in', ['published', 'registration_closed']).where('t.starts_at', '>', new Date(now.getTime() - 3 * 3600000))
    if (q.when === 'live') query = query.where('t.status', '=', 'running')
    if (q.when === 'finished') query = query.where('t.status', 'in', ['finished', 'finished_early'])
    if (q.city) query = query.where('ci.slug', '=', q.city)
    if (q.club) query = query.where('c.slug', '=', q.club)
    if (q.type) query = query.where('t.type', '=', q.type)
    if (q.from) query = query.where('t.starts_at', '>=', new Date(q.from))
    if (q.to) query = query.where('t.starts_at', '<', new Date(q.to))
    if (q.ratingMin != null) query = query.where(sql`coalesce((t.restrictions->>'ratingMax')::int, 99999)`, '>=', q.ratingMin)
    if (q.ratingMax != null) query = query.where(sql`coalesce((t.restrictions->>'ratingMin')::int, 0)`, '<=', q.ratingMax)
    if (q.fitsMe === 'true' && req.user?.playerId) {
      const me = await playerRatingForChecks(req.user.playerId)
      query = query
        .where(sql`coalesce((t.restrictions->>'ratingMin')::int, 0)`, '<=', me.effectiveRating)
        .where(sql`coalesce((t.restrictions->>'ratingMax')::int, 99999)`, '>=', me.effectiveRating)
        .where((eb) => eb.or([eb(sql`t.restrictions->>'gender'`, 'is', null), eb(sql`t.restrictions->>'gender'`, '=', me.gender)]))
    }
    if (q.hasSpots === 'true') query = query.where((eb) => eb(occupied(eb), '<', eb.ref('t.max_participants')))
    const rows = await query.orderBy('t.starts_at', q.when === 'finished' ? 'desc' : 'asc').limit(q.limit).execute()
    res.json(
      rows.map((r) => ({
        id: r.id,
        slug: r.slug,
        title: r.title,
        type: r.type,
        status: r.status,
        startsAt: r.starts_at,
        estimatedEndAt: r.estimated_end_at,
        fee: r.fee,
        maxParticipants: r.max_participants,
        taken: Number(r.taken ?? 0),
        avgRating: r.avg_rating == null ? null : Number(r.avg_rating),
        restrictions: r.restrictions,
        coverUrl: r.cover_url,
        isRated: r.is_rated,
        club: { name: r.club, slug: r.club_slug },
        hall: { name: r.hall, address: r.address },
        city: r.city,
      })),
    )
  }),
)

const STATUS_FOR_PUBLIC: Partial<Record<EntryStatus, string>> = {
  awaiting_payment: 'awaiting_payment',
  paid: 'paid',
  checked_in: 'checked_in',
  playing: 'playing',
  completed: 'completed',
  withdrew: 'withdrew',
  waitlist: 'waitlist',
  invited: 'invited', // a place freed up: 30 minutes to confirm
}

export async function participants(tournamentId: number) {
  const rows = await db
    .selectFrom('entries as e')
    .innerJoin('players as p', 'p.id', 'e.player_id')
    .leftJoin('cities as c', 'c.id', 'p.city_id')
    .leftJoin('player_ratings as r', (j) => j.onRef('r.player_id', '=', 'p.id').on('r.kind', '=', 'singles'))
    .leftJoin('payments as pay', 'pay.id', 'e.payment_id')
    .leftJoin('teams as tm', 'tm.id', 'e.team_id')
    .select([
      'tm.name as team_name',
      'e.team_id',
      'e.roster',
      'e.id as entry_id',
      'e.status',
      'e.waitlist_position',
      'e.seed',
      'e.final_place',
      'e.final_place_to',
      'e.rating_at_start',
      'e.created_at',
      'p.id',
      'p.first_name',
      'p.last_name',
      'p.birth_year',
      'p.photo_url',
      'p.start_level',
      'c.name_ru as city',
      'r.rating',
      'pay.method as payment_method',
      'pay.status as payment_status',
    ])
    .where('e.tournament_id', '=', tournamentId)
    .where('e.status', 'in', [...ENTRY_ACTIVE])
    .execute()
  return rows
    .map((r) => {
      const rating = r.rating_at_start ?? r.rating
      return {
        entryId: r.entry_id,
        playerId: r.id,
        name: r.team_name ?? playerName(r),
        teamId: r.team_id,
        roster: r.roster,
        city: r.city,
        birthYear: r.birth_year,
        photoUrl: r.photo_url,
        rating,
        calibrating: r.rating == null,
        startLevel: r.start_level,
        status: STATUS_FOR_PUBLIC[r.status] ?? r.status,
        waitlistPosition: r.waitlist_position,
        seed: r.seed,
        place: r.final_place,
        placeTo: r.final_place_to,
        paymentMethod: r.payment_method,
        paymentStatus: r.payment_status,
        registeredAt: r.created_at,
      }
    })
    .sort((a, b) => (a.status === 'waitlist' ? 1 : 0) - (b.status === 'waitlist' ? 1 : 0) || (a.waitlistPosition ?? 0) - (b.waitlistPosition ?? 0) || (b.rating ?? b.startLevel) - (a.rating ?? a.startLevel))
}

export async function structure(t: Tournament) {
  const stages = await db.selectFrom('stages').selectAll().where('tournament_id', '=', t.id).orderBy('order_index').execute()
  if (!stages.length) return null
  const names = new Map(
    (
      await db
        .selectFrom('entries as e')
        .innerJoin('players as p', 'p.id', 'e.player_id')
        .leftJoin('teams as tm', 'tm.id', 'e.team_id')
        .select(['e.id', 'e.status', 'p.id as player_id', 'p.first_name', 'p.last_name', 'e.rating_at_start', 'e.seed', 'tm.name as team_name'])
        .where('e.tournament_id', '=', t.id)
        .execute()
    ).map((e) => [e.id, { entryId: e.id, playerId: e.player_id, name: e.team_name ?? playerName(e), rating: e.rating_at_start, seed: e.seed, withdrew: e.status === 'withdrew' }]),
  )
  const matches = await db
    .selectFrom('matches as m')
    .leftJoin('hall_tables as ht', 'ht.id', 'm.table_id')
    .selectAll('m')
    .select('ht.number as table_number')
    .where('m.tournament_id', '=', t.id)
    .orderBy('m.number')
    .execute()
  const matchView = (m: (typeof matches)[number]) => ({
    id: m.id,
    number: m.number,
    bracketNumber: m.bracket_number,
    round: m.round,
    label: m.stage_label,
    placeFrom: m.place_from,
    placeTo: m.place_to,
    status: m.status,
    resultType: m.result_type,
    home: m.home_entry_id ? names.get(m.home_entry_id) : null,
    away: m.away_entry_id ? names.get(m.away_entry_id) : null,
    homeSource: m.home_source,
    awaySource: m.away_source,
    setsHome: m.sets_home,
    setsAway: m.sets_away,
    games: m.games,
    winnerEntryId: m.winner_entry_id,
    table: m.table_number,
    calledAt: m.called_at,
    version: m.version,
  })
  const result = []
  for (const s of stages) {
    const stageMatches = matches.filter((m) => m.stage_id === s.id)
    if (s.kind === 'groups' || s.kind === 'round_robin') {
      const groups = await db.selectFrom('groups').selectAll().where('stage_id', '=', s.id).orderBy('order_index').execute()
      const members = groups.length
        ? await db.selectFrom('group_members').selectAll().where('group_id', 'in', groups.map((g) => g.id)).orderBy('seed_index').execute()
        : []
      result.push({
        key: s.stage_key,
        kind: s.kind,
        name: s.name,
        status: s.status,
        groups: groups.map((g) => {
          const standings = g.standings as StandingsResult | null
          return {
            code: g.code,
            members: members.filter((m) => m.group_id === g.id).map((m) => names.get(m.entry_id)),
            standings: standings
              ? {
                  needsDecision: standings.needsDecision,
                  missingGamePoints: standings.missingGamePoints,
                  rows: standings.rows.map((r) => ({ ...r, player: names.get(Number(r.id)), tiedWith: r.tiedWith.map((x) => names.get(Number(x))?.name) })),
                }
              : null,
            matches: stageMatches.filter((m) => m.group_id === g.id).map(matchView),
          }
        }),
      })
    } else {
      result.push({
        key: s.stage_key,
        kind: s.kind,
        name: s.name,
        status: s.status,
        size: (s.bracket as Bracket | null)?.size ?? null,
        matches: stageMatches.map(matchView),
      })
    }
  }
  return result
}

tournamentsRouter.get(
  '/:slug',
  handler(async (req, res) => {
    const slug = String(req.params.slug)
    const t = await db
      .selectFrom('tournaments')
      .selectAll()
      .where((eb) => (/^\d+$/.test(slug) ? eb('id', '=', Number(slug)) : eb('slug', '=', slug)))
      .executeTakeFirst()
    if (!t) throw notFound('tournament.not_found')
    const club = await db.selectFrom('clubs as c').innerJoin('cities as ci', 'ci.id', 'c.city_id').select(['c.id', 'c.slug', 'c.name', 'c.contact_telegram', 'c.contact_email', 'c.status', 'ci.name_ru as city']).where('c.id', '=', t.club_id).executeTakeFirstOrThrow()
    const isStaff = req.user ? Boolean(await db.selectFrom('club_members').select('user_id').where('club_id', '=', t.club_id).where('user_id', '=', req.user.id).executeTakeFirst()) : false
    if (t.status === 'draft' && !isStaff) throw notFound('tournament.not_found')
    const hall = await db.selectFrom('halls').selectAll().where('id', '=', t.hall_id).executeTakeFirstOrThrow()
    const list = await participants(t.id)
    const taken = list.filter((p) => p.status !== 'waitlist').length
    const ratings = list.filter((p) => p.status !== 'waitlist' && p.rating != null).map((p) => p.rating as number)
    const finished = t.status === 'finished' || t.status === 'finished_early'
    const deltas = finished
      ? await db.selectFrom('rating_snapshots').select(['player_id', 'delta', 'rating_after', 'calibrated']).where('tournament_id', '=', t.id).execute()
      : []
    let myEntry = null
    if (req.user?.playerId) {
      myEntry = list.find((p) => p.playerId === req.user!.playerId) ?? null
    }
    const settings = t.settings
    res.json({
      id: t.id,
      slug: t.slug,
      title: t.title,
      type: t.type,
      status: t.status,
      startsAt: t.starts_at,
      estimatedEndAt: t.estimated_end_at,
      registrationClosesAt: t.registration_closes_at,
      fee: t.fee,
      maxParticipants: t.max_participants,
      minParticipants: t.min_participants,
      restrictions: t.restrictions,
      prizes: t.prizes,
      description: t.description,
      // C-10: tournament comment and club comment are separate blocks.
      commentForPlayers: t.comment_for_players,
      staffComment: isStaff ? t.staff_comment : undefined,
      coverUrl: t.cover_url,
      isRated: t.is_rated,
      refundRules: t.refund_rules,
      settings: isStaff ? { scoreEntry: 'staff', checkinWindowMinutes: 60, ...settings } : { scoreEntry: settings.scoreEntry ?? 'staff', checkinWindowMinutes: settings.checkinWindowMinutes ?? 60, sameDayRegistration: settings.sameDayRegistration ?? false },
      cancelledReason: t.cancelled_reason,
      seriesId: t.series_id,
      tableIds: isStaff ? t.table_ids : undefined,
      isStaff,
      club: { id: club.id, slug: club.slug, name: club.name, city: club.city, contacts: { telegram: club.contact_telegram, email: club.contact_email } },
      hall: finished && t.address_snapshot
        ? { id: hall.id, ...(t.address_snapshot as object), timezone: hall.timezone, commentForPlayers: hall.comment_for_players }
        : { id: hall.id, name: hall.name, address: hall.address, location: hall.lat != null ? { lat: hall.lat, lng: hall.lng } : null, howToFind: hall.how_to_find, timezone: hall.timezone, commentForPlayers: hall.comment_for_players },
      tables: t.table_ids.length,
      format: t.format,
      estimate: estimateFormat(t.format, ['draft', 'published', 'registration_closed'].includes(t.status) ? t.max_participants : Math.max(taken, 2), { tables: Math.max(t.table_ids.length, 1), avgMatchMinutes: settings.avgMatchMinutes ?? 20 }),
      taken,
      free: Math.max(0, t.max_participants - taken),
      avgRating: ratings.length ? Math.round(ratings.reduce((a, b) => a + b, 0) / ratings.length) : null,
      participants: list.map((p) => ({ ...p, paymentMethod: isStaff ? p.paymentMethod : undefined, paymentStatus: isStaff ? p.paymentStatus : undefined, ratingChange: deltas.find((d) => d.player_id === p.playerId) ?? null })),
      myEntry,
      shareUrl: `${config.SITE_URL}/t/${t.slug}`,
      structure: await structure(t),
    })
  }),
)

// ---------------------------------------------------------------------------
// Club side: creation, publication, running

/** Team meeting scheme (D-5): a ready one or a custom list of games between line-up slots. */
export const meetingSchemeSchema = z.object({
  id: z.string().max(30),
  name: z.string().max(60),
  slots: z.number().int().min(1).max(8),
  games: z.array(z.object({ kind: z.enum(['singles', 'doubles']), home: z.array(z.number().int().min(0)).min(1).max(2), away: z.array(z.number().int().min(0)).min(1).max(2) })).min(1).max(15),
  firstTo: z.number().int().min(1).max(8),
  playAll: z.boolean(),
  tables: z.union([z.literal(1), z.literal(2)]),
})

export const createSchema = z.object({
  type: z.enum(['singles', 'doubles', 'team']).default('singles'),
  hallId: z.number().int().positive(),
  title: z.string().trim().min(3).max(150),
  startsAt: z.iso.datetime({ offset: true }),
  registrationClosesAt: z.iso.datetime({ offset: true }).optional(),
  template: z.enum(FORMAT_TEMPLATES).optional(),
  templateParams,
  format: formatSchema.optional(),
  seriesId: z.number().int().positive().nullable().optional(),
  maxParticipants: z.number().int().min(4).max(256),
  minParticipants: z.number().int().min(2).max(256).optional(),
  fee: z.number().int().min(0).optional(), // tiyn
  restrictions: z
    .object({
      ratingMin: z.number().int().nullable().optional(),
      ratingMax: z.number().int().nullable().optional(),
      gender: z.enum(['m', 'f']).nullable().optional(),
      ageMin: z.number().int().nullable().optional(),
      ageMax: z.number().int().nullable().optional(),
      ratingSumMax: z.number().int().nullable().optional(),
    })
    .default({}),
  prizes: z.string().max(2000).default(''),
  description: z.string().max(10000).default(''),
  commentForPlayers: z.string().max(5000).default(''),
  staffComment: z.string().max(5000).default(''),
  coverUrl: z.string().url().nullable().optional(),
  tableIds: z.array(z.number().int()).optional(),
  isRated: z.boolean().default(true),
  refundRules: z.array(z.object({ hoursBefore: z.number().int().min(0), percent: z.number().int().min(0).max(100) })).optional(),
  settings: z
    .object({
      scoreEntry: z.enum(['staff', 'players']).optional(),
      checkinWindowMinutes: z.number().int().min(10).max(240).optional(),
      sameDayRegistration: z.boolean().optional(),
      avgMatchMinutes: z.number().int().min(5).max(90).optional(),
      restMinutes: z.number().int().min(0).max(30).optional(),
      requireCheckin: z.boolean().optional(),
      callResponseMinutes: z.number().int().min(1).max(15).optional(),
      meeting: meetingSchemeSchema.optional(),
    })
    .default({}),
})

const DEFAULT_REFUND: RefundRule[] = [{ hoursBefore: 24, percent: 100 }]

async function uniqueSlug(trx: Trx, title: string, startsAt: Date): Promise<string> {
  const base = `${slugify(title, 50)}-${startsAt.toISOString().slice(0, 10)}`
  let slug = base
  for (let i = 2; await trx.selectFrom('tournaments').select('id').where('slug', '=', slug).executeTakeFirst(); i++) slug = `${base}-${i}`
  return slug
}

/** Creates a draft tournament; address, tables and defaults come from the club (C-3). Used by the API and the dev seed. */
export async function createTournament(trx: Trx, clubId: number, userId: number | null, input: Omit<z.infer<typeof createSchema>, 'type'> & { type?: Tournament['type'] }): Promise<Tournament> {
  const hall = await trx.selectFrom('halls').selectAll().where('id', '=', input.hallId).where('club_id', '=', clubId).executeTakeFirst()
  if (!hall) throw badRequest('tournament.hall_not_in_club')
  const club = await trx.selectFrom('clubs').select(['tournament_defaults']).where('id', '=', clubId).executeTakeFirstOrThrow()
  const defaults = club.tournament_defaults as {
    fee?: number
    refundRules?: RefundRule[]
    template?: FormatTemplateId
    maxParticipants?: number
    settings?: Record<string, unknown>
  }
  const tables = await trx.selectFrom('hall_tables').select('id').where('hall_id', '=', hall.id).where('status', '=', 'active').orderBy('number').execute()
  const tableIds = input.tableIds?.length ? input.tableIds.filter((id) => tables.some((t) => t.id === id)) : tables.map((t) => t.id)
  if (!tableIds.length) throw unprocessable('tournament.no_tables')
  const format = input.format ? (input.format as TournamentFormat) : formatTemplate(input.template ?? defaults.template ?? 'gs1', input.maxParticipants, input.templateParams as TemplateParams)
  if (input.settings.restMinutes != null) format.restMinutes = input.settings.restMinutes
  const errors = validateFormat(format)
  if (errors.length) throw unprocessable('format.invalid', errors)
  const settings = { ...(defaults.settings ?? {}), ...input.settings }
  const type = input.type ?? 'singles'
  if (type === 'team') {
    settings.meeting ??= MEETING_SCHEMES.wc
    const schemeErrors = validateScheme(settings.meeting)
    if (schemeErrors.length) throw unprocessable('meeting.invalid_scheme', schemeErrors)
  }
  const estimate = estimateFormat(format, input.maxParticipants, { tables: tableIds.length, avgMatchMinutes: (settings.avgMatchMinutes as number | undefined) ?? 20 })
  const startsAt = new Date(input.startsAt)
  return trx
    .insertInto('tournaments')
    .values({
      club_id: clubId,
      hall_id: hall.id,
      slug: await uniqueSlug(trx, input.title, startsAt),
      title: input.title,
      type,
      starts_at: startsAt,
      estimated_end_at: new Date(startsAt.getTime() + estimate.minutes * 60000),
      registration_closes_at: input.registrationClosesAt ? new Date(input.registrationClosesAt) : startsAt,
      max_participants: input.maxParticipants,
      min_participants: input.minParticipants ?? 4,
      fee: input.fee ?? defaults.fee ?? 0,
      restrictions: json(input.restrictions),
      prizes: input.prizes,
      description: input.description,
      comment_for_players: input.commentForPlayers,
      staff_comment: input.staffComment,
      cover_url: input.coverUrl ?? null,
      format: json(format),
      settings: json(settings),
      refund_rules: json(input.refundRules ?? defaults.refundRules ?? DEFAULT_REFUND),
      table_ids: tableIds,
      is_rated: input.isRated,
      series_id: input.seriesId ?? null,
      created_by: userId,
    })
    .returningAll()
    .executeTakeFirstOrThrow()
}

clubTournamentsRouter.get(
  '/',
  handler(async (req, res) => {
    const clubId = intParam(req, 'clubId')
    await requireClubRight(req, clubId, 'tournaments')
    const rows = await db
      .selectFrom('tournaments as t')
      .select(['t.id', 't.slug', 't.title', 't.status', 't.type', 't.starts_at', 't.fee', 't.max_participants', (eb) => occupied(eb).as('taken')])
      .where('t.club_id', '=', clubId)
      .orderBy('t.starts_at', 'desc')
      .execute()
    res.json(rows.map((r) => ({ ...r, taken: Number(r.taken ?? 0) })))
  }),
)

clubTournamentsRouter.post(
  '/',
  handler(async (req, res) => {
    const clubId = intParam(req, 'clubId')
    const user = await requireClubRight(req, clubId, 'tournaments')
    const body = parseBody(createSchema, req)
    const t = await db.transaction().execute(async (trx) => {
      const created = await createTournament(trx, clubId, user.id, body)
      await audit({ actorUserId: user.id, clubId, entity: 'tournament', entityId: created.id, action: 'create', after: body }, trx)
      return created
    })
    res.status(201).json({ id: t.id, slug: t.slug, status: t.status })
  }),
)

/** Publishes a draft: needs a verified club, blocks the tournament tables for booking (B-7). */
export async function publishTournament(trx: Trx, tournamentId: number, userId: number | null) {
  const t = await trx.selectFrom('tournaments').selectAll().where('id', '=', tournamentId).forUpdate().executeTakeFirstOrThrow()
  assertTransition('tournament', tournamentStatus, t.status, 'published')
  const club = await trx.selectFrom('clubs').select('status').where('id', '=', t.club_id).executeTakeFirstOrThrow()
  if (club.status !== 'active') throw forbidden('club.not_verified')
  const hall = await trx.selectFrom('halls').select(['address']).where('id', '=', t.hall_id).executeTakeFirstOrThrow()
  if (!hall.address || !t.table_ids.length) throw unprocessable('club.address_and_tables_required')
  await trx.updateTable('tournaments').set({ status: 'published', published_at: new Date() }).where('id', '=', tournamentId).execute()
  await trx
    .insertInto('table_blocks')
    .values({ hall_id: t.hall_id, table_ids: t.table_ids, starts_at: t.starts_at, ends_at: t.estimated_end_at, kind: 'tournament', tournament_id: t.id, note: t.title, created_by: userId })
    .execute()
  const conflicts = await trx
    .selectFrom('bookings')
    .select(['id', 'table_id', 'starts_at', 'ends_at', 'player_id', 'guest_name'])
    .where('table_id', 'in', t.table_ids)
    .where('status', 'in', ['held', 'confirmed'])
    .where('starts_at', '<', t.estimated_end_at)
    .where('ends_at', '>', t.starts_at)
    .execute()
  await audit({ actorUserId: userId, clubId: t.club_id, entity: 'tournament', entityId: t.id, action: 'publish', before: { status: t.status }, after: { status: 'published' } }, trx)
  bus.publish(`hall:${t.hall_id}`, 'hall.availability_changed', { hallId: t.hall_id })
  return { conflicts }
}

export async function clubOfTournament(id: number) {
  const t = await db.selectFrom('tournaments').select(['club_id', 'hall_id']).where('id', '=', id).executeTakeFirst()
  if (!t) throw notFound('tournament.not_found')
  return t
}

tournamentsRouter.post(
  '/:id/publish',
  handler(async (req, res) => {
    const id = intParam(req, 'id')
    const t = await clubOfTournament(id)
    const user = await requireClubRight(req, t.club_id, 'tournaments', { hallId: t.hall_id, tournamentId: id })
    // Conflicting bookings are returned so the organiser can move or refund them (B-7).
    res.json(await db.transaction().execute((trx) => publishTournament(trx, id, user.id)))
  }),
)

tournamentsRouter.get(
  '/:id/participants',
  handler(async (req, res) => {
    const id = intParam(req, 'id')
    const t = await clubOfTournament(id)
    await requireClubRight(req, t.club_id, 'tournaments', { tournamentId: id })
    res.json(await participants(id))
  }),
)

// ---------------------------------------------------------------------------
// Registration (R-3 … R-6, R-28)

/** Returns error codes when the player may not play this tournament. */
export async function eligibility(trx: Trx, t: Tournament, playerId: number): Promise<string[]> {
  const errors: string[] = []
  const p = await trx
    .selectFrom('players as p')
    .leftJoin('player_ratings as r', (j) => j.onRef('r.player_id', '=', 'p.id').on('r.kind', '=', 'singles'))
    .select(['p.gender', 'p.birth_year', 'p.start_level', 'r.rating'])
    .where('p.id', '=', playerId)
    .executeTakeFirstOrThrow()
  const r = t.restrictions as TournamentRestrictions
  const rating = p.rating ?? p.start_level
  const age = new Date(t.starts_at).getUTCFullYear() - p.birth_year
  if (r.ratingMin != null && rating < r.ratingMin) errors.push('entry.rating_too_low')
  if (r.ratingMax != null && rating > r.ratingMax) errors.push('entry.rating_too_high')
  if (r.gender && p.gender !== r.gender) errors.push('entry.gender')
  if (r.ageMin != null && age < r.ageMin) errors.push('entry.too_young')
  if (r.ageMax != null && age > r.ageMax) errors.push('entry.too_old')
  return errors
}

/** R-28: one tournament at a time — planned intervals of the player's tournaments must not overlap. */
async function overlapping(trx: Trx, t: Tournament, playerId: number) {
  return trx
    .selectFrom('entries as e')
    .innerJoin('tournaments as o', 'o.id', 'e.tournament_id')
    .select(['o.id', 'o.slug', 'o.title', 'o.starts_at', 'o.estimated_end_at'])
    .where('e.player_id', '=', playerId)
    .where('e.status', 'in', [...ENTRY_ACTIVE])
    .where('o.id', '<>', t.id)
    .where('o.status', 'not in', ['cancelled', 'finished', 'finished_early'])
    .where('o.starts_at', '<', t.estimated_end_at)
    .where('o.estimated_end_at', '>', t.starts_at)
    .execute()
}

export type RegisterResult = { entryId: number; status: EntryStatus; paymentMethod: 'online' | 'at_club' | null; redirectUrl: string | null }

/** Registers a player (self or by the club). Used by the API and by the dev seed. */
export async function registerPlayer(trx: Trx, tournamentId: number, playerId: number, actorUserId: number | null, options: { byClub?: boolean; sameDay?: boolean } = {}): Promise<RegisterResult> {
  const t = await trx.selectFrom('tournaments').selectAll().where('id', '=', tournamentId).forUpdate().executeTakeFirstOrThrow()
  if (t.type !== 'singles') throw badRequest('entry.team_required')
  if (t.status !== 'published' && !((options.byClub || options.sameDay) && t.status === 'registration_closed')) throw conflict('entry.registration_closed')
  if (!options.byClub && !options.sameDay && t.registration_closes_at && t.registration_closes_at < new Date()) throw conflict('entry.registration_closed')
  const errors = await eligibility(trx, t, playerId)
  if (errors.length) throw unprocessable('entry.not_eligible', errors)
  const clash = await overlapping(trx, t, playerId)
  if (clash.length) throw conflict('entry.overlapping_tournament', clash)
  const existing = await trx.selectFrom('entries').selectAll().where('tournament_id', '=', t.id).where('player_id', '=', playerId).where('status', 'in', [...ENTRY_ACTIVE]).executeTakeFirst()
  if (existing && existing.status !== 'invited') throw conflict('entry.already_registered', { status: existing.status })

  const taken = await trx.selectFrom('entries').select((eb) => eb.fn.countAll<number>().as('n')).where('tournament_id', '=', t.id).where('status', 'in', [...ENTRY_OCCUPYING]).executeTakeFirstOrThrow()
  if (!existing && Number(taken.n) >= t.max_participants) {
    // R-4: waiting list.
    const last = await trx.selectFrom('entries').select((eb) => eb.fn.max<number>('waitlist_position').as('p')).where('tournament_id', '=', t.id).executeTakeFirst()
    const entry = await trx
      .insertInto('entries')
      .values({ tournament_id: t.id, player_id: playerId, status: 'waitlist', waitlist_position: (last?.p ?? 0) + 1, registered_by: actorUserId })
      .returning(['id', 'status'])
      .executeTakeFirstOrThrow()
    return { entryId: entry.id, status: entry.status, paymentMethod: null, redirectUrl: null }
  }

  // Place is held for the payment (15 minutes online; the at-club provider confirms immediately).
  const holdUntil = new Date(Date.now() + 15 * 60000)
  let entryId: number
  if (existing) {
    assertTransition('entry', entryStatus, existing.status, 'awaiting_payment')
    await trx.updateTable('entries').set({ status: 'awaiting_payment', hold_until: holdUntil, waitlist_position: null, updated_at: new Date() }).where('id', '=', existing.id).execute()
    entryId = existing.id
  } else {
    const row = await trx
      .insertInto('entries')
      .values({ tournament_id: t.id, player_id: playerId, status: 'awaiting_payment', hold_until: holdUntil, registered_by: actorUserId })
      .returning('id')
      .executeTakeFirstOrThrow()
    entryId = row.id
  }
  let status: EntryStatus = 'awaiting_payment'
  let paymentMethod: RegisterResult['paymentMethod'] = null
  let redirectUrl: string | null = null
  if (t.fee > 0) {
    const payment = await startPayment(trx, {
      purpose: 'tournament_entry',
      amount: t.fee,
      clubId: t.club_id,
      userId: actorUserId,
      description: t.title,
      returnUrl: `${config.SITE_URL}/t/${t.slug}`,
      metadata: { tournamentId: t.id, entryId, byClub: Boolean(options.byClub) },
    })
    paymentMethod = payment.method
    redirectUrl = payment.redirectUrl
    await trx.updateTable('entries').set({ payment_id: payment.paymentId }).where('id', '=', entryId).execute()
    if (payment.confirmed) status = 'paid'
  } else status = 'paid'
  if (status === 'paid') {
    assertTransition('entry', entryStatus, 'awaiting_payment', 'paid')
    await trx.updateTable('entries').set({ status: 'paid', hold_until: null, updated_at: new Date() }).where('id', '=', entryId).execute()
  }
  await audit({ actorUserId, clubId: t.club_id, entity: 'entry', entityId: entryId, action: options.byClub ? 'register_by_club' : 'register', after: { tournamentId: t.id, playerId, status } }, trx)
  return { entryId, status, paymentMethod, redirectUrl }
}

tournamentsRouter.post(
  '/:id/entries',
  handler(async (req, res) => {
    const user = requireUser(req)
    if (!user.playerId) throw forbidden('player.profile_required')
    const id = intParam(req, 'id')
    const result = await db.transaction().execute((trx) => registerPlayer(trx, id, user.playerId!, user.id))
    void notifyRegistered(result).catch(() => {})
    bus.publish(`tournament:${id}`, 'tournament.entries_changed', { tournamentId: id })
    res.status(201).json(result)
  }),
)

/** Registration confirmation with the date and the hall address (no receipt: payment is at the club). */
async function notifyRegistered(r: RegisterResult) {
  if (r.status !== 'paid' && r.status !== 'checked_in') return
  const row = await db
    .selectFrom('entries as e')
    .innerJoin('players as p', 'p.id', 'e.player_id')
    .innerJoin('tournaments as t', 't.id', 'e.tournament_id')
    .leftJoin('halls as h', 'h.id', 't.hall_id')
    .select(['p.user_id', 't.id', 't.slug', 't.title', 't.starts_at', 'h.address'])
    .where('e.id', '=', r.entryId)
    .executeTakeFirst()
  if (row?.user_id) await notify({ userId: row.user_id, type: 'registration_confirmed', data: { tournamentId: row.id, slug: row.slug, title: row.title, startsAt: row.starts_at.toISOString(), address: row.address } })
}

/** Club adds a player manually (R-6); commission still accrues. */
tournamentsRouter.post(
  '/:id/entries/manual',
  handler(async (req, res) => {
    const id = intParam(req, 'id')
    const t = await clubOfTournament(id)
    const user = await requireClubRight(req, t.club_id, 'tournaments', { tournamentId: id })
    const { playerId, checkin } = parseBody(z.object({ playerId: z.number().int().positive(), checkin: z.boolean().default(false) }), req)
    const result = await db.transaction().execute(async (trx) => {
      const r = await registerPlayer(trx, id, playerId, user.id, { byClub: true })
      // R-26: day-of registration at the desk checks the player in at once.
      if (checkin && r.status === 'paid') {
        await trx.updateTable('entries').set({ status: 'checked_in', checked_in_at: new Date(), updated_at: new Date() }).where('id', '=', r.entryId).execute()
        r.status = 'checked_in'
      }
      return r
    })
    void notifyRegistered(result).catch(() => {})
    bus.publish(`tournament:${id}`, 'tournament.entries_changed', { tournamentId: id })
    res.status(201).json(result)
  }),
)

function refundPercent(rules: RefundRule[], startsAt: Date, now = new Date()): number {
  const hours = (startsAt.getTime() - now.getTime()) / 3600000
  const rule = [...rules].sort((a, b) => b.hoursBefore - a.hoursBefore).find((r) => hours >= r.hoursBefore)
  return rule?.percent ?? 0
}

/** Player cancels (R-5): refund by the tournament rules; the first in the waiting list is invited (R-4). */
tournamentsRouter.delete(
  '/:id/entries/me',
  handler(async (req, res) => {
    const user = requireUser(req)
    if (!user.playerId) throw forbidden('player.profile_required')
    const id = intParam(req, 'id')
    const result = await db.transaction().execute(async (trx) => {
      const t = await trx.selectFrom('tournaments').selectAll().where('id', '=', id).forUpdate().executeTakeFirstOrThrow()
      if (!['published', 'registration_closed'].includes(t.status)) throw conflict('entry.cannot_cancel_now')
      const entry = await trx.selectFrom('entries').selectAll().where('tournament_id', '=', id).where('player_id', '=', user.playerId!).where('status', 'in', [...ENTRY_ACTIVE]).executeTakeFirst()
      if (!entry) throw notFound('entry.not_found')
      assertTransition('entry', entryStatus, entry.status, 'cancelled_by_player')
      await trx.updateTable('entries').set({ status: 'cancelled_by_player', updated_at: new Date() }).where('id', '=', entry.id).execute()
      let refund = 0
      if (entry.payment_id) {
        const payment = await trx.selectFrom('payments').selectAll().where('id', '=', entry.payment_id).executeTakeFirstOrThrow()
        // Online refunds go through the provider in stage 4; an uncollected at-club payment just expires.
        if (payment.status === 'succeeded') refund = Math.round((payment.amount * refundPercent(t.refund_rules, t.starts_at)) / 100)
        if (payment.method === 'at_club' && payment.status === 'created') await trx.updateTable('payments').set({ status: 'expired', updated_at: new Date() }).where('id', '=', payment.id).execute()
      }
      if (ENTRY_OCCUPYING.includes(entry.status)) {
        const next = await trx.selectFrom('entries').select(['id', 'player_id']).where('tournament_id', '=', id).where('status', '=', 'waitlist').orderBy('waitlist_position').executeTakeFirst()
        if (next) {
          await trx.updateTable('entries').set({ status: 'invited', hold_until: new Date(Date.now() + 30 * 60000), updated_at: new Date() }).where('id', '=', next.id).execute()
          const invitedUser = await trx.selectFrom('players').select('user_id').where('id', '=', next.player_id).executeTakeFirst()
          if (invitedUser?.user_id) await notify({ userId: invitedUser.user_id, type: 'waitlist_invited', urgent: true, data: { tournamentId: id, slug: t.slug, title: t.title, minutes: 30 } })
        }
      }
      await audit({ actorUserId: user.id, clubId: t.club_id, entity: 'entry', entityId: entry.id, action: 'cancel', before: { status: entry.status }, after: { status: 'cancelled_by_player', refund } }, trx)
      return { refund }
    })
    bus.publish(`tournament:${id}`, 'tournament.entries_changed', { tournamentId: id })
    res.json(result)
  }),
)

// Running (stage 2 builds the tables screen on top of these).

tournamentsRouter.post(
  '/:id/start',
  handler(async (req, res) => {
    const id = intParam(req, 'id')
    const t = await clubOfTournament(id)
    const user = await requireClubRight(req, t.club_id, 'conduct', { tournamentId: id })
    const { order } = parseBody(z.object({ order: z.array(z.number().int()).max(256).optional() }).default({}), req)
    await db.transaction().execute(async (trx) => {
      const row = await trx.selectFrom('tournaments').select('status').where('id', '=', id).executeTakeFirstOrThrow()
      if (row.status === 'published') {
        await trx.updateTable('tournaments').set({ status: 'registration_closed' }).where('id', '=', id).execute()
      }
      await startTournament(trx, id, user.id, new Date(), { order })
    })
    bus.publish(`tournament:${id}`, 'tournament.started', { tournamentId: id })
    res.json({ ok: true })
  }),
)

tournamentsRouter.post(
  '/:id/matches/:matchId/result',
  handler(async (req, res) => {
    const id = intParam(req, 'id')
    const matchId = intParam(req, 'matchId')
    const t = await clubOfTournament(id)
    const user = await requireClubRight(req, t.club_id, 'conduct', { tournamentId: id })
    const body = parseBody(
      z.object({
        setsHome: z.number().int().min(0).max(4),
        setsAway: z.number().int().min(0).max(4),
        games: z.array(z.object({ home: z.number().int().min(0), away: z.number().int().min(0) })).default([]),
        resultType: z.enum(['normal', 'walkover', 'retired']).default('normal'),
        winner: z.enum(['home', 'away']).optional(),
        version: z.number().int().optional(),
      }),
      req,
    )
    await db.transaction().execute(async (trx) => {
      const current = await trx.selectFrom('matches').selectAll().where('id', '=', matchId).forUpdate().executeTakeFirst()
      if (!current || current.tournament_id !== id) throw badRequest('match.wrong_tournament')
      if (['finished', 'walkover', 'retired', 'annulled'].includes(current.status) || (body.version != null && body.version !== current.version))
        throw conflict('match.already_recorded', { status: current.status, setsHome: current.sets_home, setsAway: current.sets_away, games: current.games, resultType: current.result_type, version: current.version })
      await recordResult(trx, matchId, body, user.id)
    })
    bus.publish(`tournament:${id}`, 'match.updated', { tournamentId: id, matchId })
    res.json({ ok: true })
  }),
)

tournamentsRouter.post(
  '/:id/finish',
  handler(async (req, res) => {
    const id = intParam(req, 'id')
    const t = await clubOfTournament(id)
    const user = await requireClubRight(req, t.club_id, 'conduct', { tournamentId: id })
    await db.transaction().execute((trx) => finishTournament(trx, id, user.id))
    bus.publish(`tournament:${id}`, 'tournament.finished', { tournamentId: id })
    res.json({ ok: true })
  }),
)
