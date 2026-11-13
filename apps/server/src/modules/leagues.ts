// Leagues API (4.12): public list and page, club management of seasons/divisions/tours, player actions
// (join, confirm participation, fixtures: propose → confirm → booking, report → confirm).

import { Router } from 'express'
import type { Request } from 'express'
import { z } from 'zod'
import { db } from '../db/index.ts'
import type { Transaction } from '../db/index.ts'
import type { Database } from '../db/types.ts'
import { requireClubRight, requireUser } from '../auth/access.ts'
import { forbidden, handler, notFound } from '../http/errors.ts'
import { intParam, isoDate, parseBody } from '../http/validate.ts'
import {
  addParticipants,
  applyTour,
  confirmFixture,
  confirmFixtureResult,
  confirmParticipation,
  createLeague,
  createSeason,
  updateSeason,
  createTour,
  distribute,
  generateFixtures,
  leagueListQuery,
  mergeDivisions,
  nextSeason,
  proposeFixture,
  reportFixture,
  seasonContext,
  seasonView,
  setFrozen,
  setSeasonStatus,
  transfer,
} from '../leagues/service.ts'

export const leaguesRouter = Router()
export const clubLeaguesRouter = Router({ mergeParams: true })

const rulesSchema = z
  .object({
    boundaries: z.array(z.object({ promote: z.number().int().min(0).max(10), relegate: z.number().int().min(0).max(10) })).optional(),
    missedRule: z.enum(['relegate', 'last', 'stay']).optional(),
    pointsTable: z.array(z.number().int().min(0)).max(64).optional(),
    participationPoints: z.number().int().min(0).optional(),
    bestTours: z.number().int().min(1).nullable().optional(),
    minDivisionSize: z.number().int().min(2).optional(),
    playoffSize: z.number().int().min(2).max(64).optional(),
    toursPlanned: z.number().int().min(1).max(52).optional(),
    transferWindow: z.object({ from: z.string(), to: z.string() }).nullable().optional(),
    confirmBy: z.string().nullable().optional(),
    reminderHours: z.number().int().min(1).max(168).optional(),
  })
  .default({})

const paymentSchema = z
  .object({ mode: z.enum(['season', 'per_tour', 'combined']), seasonPrice: z.number().int().min(0).optional(), tourPrice: z.number().int().min(0).optional(), topUp: z.number().int().min(0).optional() })
  .default({ mode: 'season' })

const seasonBase = z.object({
  name: z.string().trim().min(2).max(100),
  startsOn: isoDate,
  endsOn: isoDate,
  divisions: z.array(z.string().trim().min(1).max(60)).min(1).max(12),
  rules: rulesSchema,
  payment: paymentSchema,
})

type SeasonBody = { startsOn?: string; endsOn?: string; divisions?: string[]; rules?: { boundaries?: unknown[]; transferWindow?: { from: string; to: string } | null } }
const seasonChecks = (s: SeasonBody, ctx: z.RefinementCtx) => {
  if (s.startsOn && s.endsOn && s.endsOn < s.startsOn) ctx.addIssue({ code: 'custom', path: ['endsOn'], message: 'league.dates_invalid' })
  if (s.divisions && s.rules?.boundaries && s.rules.boundaries.length !== s.divisions.length - 1) ctx.addIssue({ code: 'custom', path: ['rules', 'boundaries'], message: 'league.boundaries_mismatch' })
  const w = s.rules?.transferWindow
  if (w && w.to < w.from) ctx.addIssue({ code: 'custom', path: ['rules', 'transferWindow'], message: 'league.window_invalid' })
}
const seasonSchema = seasonBase.superRefine(seasonChecks)
const seasonEditSchema = seasonBase
  .extend({ rules: rulesSchema.unwrap().optional(), payment: paymentSchema.unwrap().partial().optional() })
  .partial()
  .superRefine(seasonChecks)

const tx = <T>(fn: (trx: Transaction<Database>) => Promise<T>) => db.transaction().execute(fn)

async function staffOfSeason(req: Request, seasonId: number) {
  const { league } = await tx((trx) => seasonContext(trx, seasonId))
  return requireClubRight(req, league.club_id, 'tournaments')
}

async function staffOfLeague(req: Request, leagueId: number) {
  const league = await db.selectFrom('leagues').select(['club_id']).where('id', '=', leagueId).executeTakeFirst()
  if (!league) throw notFound('league.not_found')
  return requireClubRight(req, league.club_id, 'tournaments')
}

const playerOf = (req: Request) => {
  const user = requireUser(req)
  if (!user.playerId) throw forbidden('player.profile_required')
  return { user, playerId: user.playerId }
}

// --- club

clubLeaguesRouter.get(
  '/',
  handler(async (req, res) => {
    const clubId = intParam(req, 'clubId')
    await requireClubRight(req, clubId, 'tournaments')
    res.json(await leagueListQuery().where('l.club_id', '=', clubId).orderBy('l.id', 'desc').execute())
  }),
)

clubLeaguesRouter.post(
  '/',
  handler(async (req, res) => {
    const clubId = intParam(req, 'clubId')
    const user = await requireClubRight(req, clubId, 'tournaments')
    const body = parseBody(z.object({ name: z.string().trim().min(3).max(100), description: z.string().max(5000).optional(), format: z.enum(['divisions', 'common_tour', 'season_rr', 'free_dates']) }), req)
    const league = await tx((trx) => createLeague(trx, clubId, user.id, body))
    res.status(201).json(league)
  }),
)

// --- public

leaguesRouter.get(
  '/',
  handler(async (_req, res) => {
    res.json(await leagueListQuery().orderBy('l.id', 'desc').limit(100).execute())
  }),
)

leaguesRouter.get(
  '/seasons/:seasonId',
  handler(async (req, res) => {
    res.json(await seasonView(intParam(req, 'seasonId')))
  }),
)

leaguesRouter.get(
  '/:slug',
  handler(async (req, res) => {
    const slug = String(req.params.slug)
    const league = await leagueListQuery()
      .where((eb) => (/^\d+$/.test(slug) ? eb('l.id', '=', Number(slug)) : eb('l.slug', '=', slug)))
      .executeTakeFirst()
    if (!league) throw notFound('league.not_found')
    const seasons = await db.selectFrom('league_seasons').select(['id', 'name', 'status', 'starts_on', 'ends_on']).where('league_id', '=', league.id).orderBy('starts_on', 'desc').execute()
    const club = await db.selectFrom('leagues').select('club_id').where('id', '=', league.id).executeTakeFirstOrThrow()
    const isStaff = req.user ? Boolean(await db.selectFrom('club_members').select('user_id').where('club_id', '=', club.club_id).where('user_id', '=', req.user.id).executeTakeFirst()) : false
    res.json({ ...league, clubId: club.club_id, isStaff, seasons, current: league.season_id ? await seasonView(league.season_id) : null })
  }),
)

// --- seasons (club)

leaguesRouter.post(
  '/:id/seasons',
  handler(async (req, res) => {
    const id = intParam(req, 'id')
    const user = await staffOfLeague(req, id)
    const body = parseBody(seasonSchema, req)
    const season = await tx((trx) => createSeason(trx, id, user.id, body))
    res.status(201).json(season)
  }),
)

leaguesRouter.patch(
  '/seasons/:seasonId',
  handler(async (req, res) => {
    const seasonId = intParam(req, 'seasonId')
    const user = await staffOfSeason(req, seasonId)
    const body = parseBody(seasonEditSchema, req)
    res.json(await tx((trx) => updateSeason(trx, seasonId, user.id, body)))
  }),
)

const seasonAction = (path: string, fn: (req: Request, seasonId: number, userId: number) => Promise<unknown>) =>
  leaguesRouter.post(
    `/seasons/:seasonId/${path}`,
    handler(async (req, res) => {
      const seasonId = intParam(req, 'seasonId')
      const user = await staffOfSeason(req, seasonId)
      res.json(await fn(req, seasonId, user.id))
    }),
  )

seasonAction('participants', (req, seasonId, userId) => {
  const body = parseBody(z.object({ playerIds: z.array(z.number().int().positive()).min(1).max(500), divisionId: z.number().int().positive().nullable().optional() }), req)
  return tx((trx) => addParticipants(trx, seasonId, body.playerIds, userId, { divisionId: body.divisionId }))
})
seasonAction('distribute', (req, seasonId, userId) => {
  const body = parseBody(z.object({ manual: z.array(z.object({ participantId: z.number().int(), divisionId: z.number().int() })).optional() }), req)
  return tx((trx) => distribute(trx, seasonId, userId, body.manual))
})
seasonAction('status', (req, seasonId, userId) => {
  const { status } = parseBody(z.object({ status: z.enum(['registration', 'active', 'finished']) }), req)
  return tx((trx) => setSeasonStatus(trx, seasonId, status, userId))
})
seasonAction('tours', (req, seasonId, userId) => {
  const body = parseBody(z.object({ startsAt: z.iso.datetime({ offset: true }), deadlineAt: z.iso.datetime({ offset: true }).nullable().optional(), hallId: z.number().int().positive(), playoff: z.boolean().optional() }), req)
  return tx((trx) => createTour(trx, seasonId, userId, body))
})
seasonAction('merge', (_req, seasonId, userId) => tx((trx) => mergeDivisions(trx, seasonId, userId)))
seasonAction('fixtures', (_req, seasonId, userId) => tx((trx) => generateFixtures(trx, seasonId, userId)))
seasonAction('next', (req, seasonId, userId) => {
  const body = parseBody(z.object({ name: z.string().trim().min(2).max(100), startsOn: isoDate, endsOn: isoDate }), req)
  return tx((trx) => nextSeason(trx, seasonId, userId, body))
})

leaguesRouter.post(
  '/tours/:tourId/apply',
  handler(async (req, res) => {
    const tour = await db.selectFrom('league_tours').select('season_id').where('id', '=', intParam(req, 'tourId')).executeTakeFirst()
    if (!tour) throw notFound('league.tour_not_found')
    const user = await staffOfSeason(req, tour.season_id)
    res.json(await tx((trx) => applyTour(trx, intParam(req, 'tourId'), user.id)))
  }),
)

const participantSeason = async (req: Request) => {
  const p = await db.selectFrom('league_participants').select('season_id').where('id', '=', intParam(req, 'participantId')).executeTakeFirst()
  if (!p) throw notFound('league.participant_not_found')
  return staffOfSeason(req, p.season_id)
}

leaguesRouter.post(
  '/participants/:participantId/freeze',
  handler(async (req, res) => {
    const user = await participantSeason(req)
    const { frozen } = parseBody(z.object({ frozen: z.boolean() }), req)
    await tx((trx) => setFrozen(trx, intParam(req, 'participantId'), frozen, user.id))
    res.json({ ok: true })
  }),
)

leaguesRouter.post(
  '/participants/:participantId/transfer',
  handler(async (req, res) => {
    const user = await participantSeason(req)
    const { divisionId, force } = parseBody(z.object({ divisionId: z.number().int().positive(), force: z.boolean().default(false) }), req)
    await tx((trx) => transfer(trx, intParam(req, 'participantId'), divisionId, user.id, force))
    res.json({ ok: true })
  }),
)

// --- players

leaguesRouter.post(
  '/seasons/:seasonId/join',
  handler(async (req, res) => {
    const { user, playerId } = playerOf(req)
    const seasonId = intParam(req, 'seasonId')
    const { season } = await tx((trx) => seasonContext(trx, seasonId))
    if (!['registration', 'active'].includes(season.status)) throw forbidden('league.registration_closed')
    res.json(await tx((trx) => addParticipants(trx, seasonId, [playerId], user.id)))
  }),
)

leaguesRouter.post(
  '/seasons/:seasonId/confirm',
  handler(async (req, res) => {
    const { playerId } = playerOf(req)
    const { accept } = parseBody(z.object({ accept: z.boolean() }), req)
    res.json(await tx((trx) => confirmParticipation(trx, intParam(req, 'seasonId'), playerId, accept)))
  }),
)

leaguesRouter.post(
  '/fixtures/:fixtureId/:action',
  handler(async (req, res) => {
    const { user, playerId } = playerOf(req)
    const id = intParam(req, 'fixtureId')
    const action = z.enum(['propose', 'confirm', 'report', 'confirm-result']).parse(req.params.action)
    if (action === 'propose') {
      const body = parseBody(z.object({ startsAt: z.iso.datetime({ offset: true }), tableId: z.number().int().positive() }), req)
      return void res.json(await tx((trx) => proposeFixture(trx, id, playerId, body)))
    }
    if (action === 'confirm') return void res.json(await tx((trx) => confirmFixture(trx, id, playerId, user.id)))
    if (action === 'report') {
      const body = parseBody(z.object({ setsMine: z.number().int().min(0).max(4), setsOpponent: z.number().int().min(0).max(4) }), req)
      return void res.json(await tx((trx) => reportFixture(trx, id, playerId, body)))
    }
    const { accept } = parseBody(z.object({ accept: z.boolean() }), req)
    res.json(await tx((trx) => confirmFixtureResult(trx, id, playerId, accept)))
  }),
)
