// Leagues (spec 4.12, L-1…L-15, R-29): league → season → divisions → tours. A tour is a normal tournament
// per division (or one common tournament); after all of them finish the tour is applied: points,
// promotion/relegation, missed-tour rules. Season round robin and «свободные даты» use fixtures that
// players schedule themselves (the table is booked through the booking service). Payments: stored only.

import {
  applyMovements,
  applyPlayoffs,
  defaultTourPoints,
  distributeByRating,
  divisionByRating,
  divisionSizes,
  groupStandings,
  mergeSmallDivisions,
  overallPlaces,
  playoffPairs,
  playoffSeeds,
  roundRobinTours,
  seasonStandings,
  tourPoints,
} from '@nomad/engine'
import type { GroupMatchResult } from '@nomad/engine'
import { applyLeagueFixtureRating } from '../rating/service.ts'
import { assertTransition, bookingStatus, entryStatus, slugify } from '@nomad/shared'
import { sql } from 'kysely'
import type { Transaction } from '../db/index.ts'
import { db, json } from '../db/index.ts'
import type { Database, LeagueFormat, SeasonPayment, SeasonRules } from '../db/types.ts'
import { audit } from '../audit.ts'
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../http/errors.ts'
import { notify } from '../notify/index.ts'
import { createBooking } from '../modules/bookings.ts'
import { createTournament, publishTournament, registerPlayer } from '../modules/tournaments.ts'
import { playerName } from '../modules/players.ts'

type Trx = Transaction<Database>

export const DEFAULT_RULES: Required<Omit<SeasonRules, 'transferWindow' | 'confirmBy' | 'bestTours'>> & Pick<SeasonRules, 'transferWindow' | 'confirmBy' | 'bestTours'> = {
  boundaries: [],
  missedRule: 'last',
  pointsTable: [],
  participationPoints: 1,
  bestTours: null,
  minDivisionSize: 4,
  playoffSize: 8,
  toursPlanned: 6,
  transferWindow: null,
  confirmBy: null,
  reminderHours: 24,
  noShowWarn: 2,
  freezeEnabled: true,
  newcomerPlacement: 'bottom',
  divisionSize: null,
  matchPoints: { win: 2, loss: 1, noShow: 0 },
  playoffMatches: false,
  capacities: [],
}

export const rulesOf = (r: SeasonRules) => ({ ...DEFAULT_RULES, ...r })

export async function seasonContext(trx: Trx, seasonId: number) {
  const season = await trx.selectFrom('league_seasons').selectAll().where('id', '=', seasonId).executeTakeFirst()
  if (!season) throw notFound('league.season_not_found')
  const league = await trx.selectFrom('leagues').selectAll().where('id', '=', season.league_id).executeTakeFirstOrThrow()
  return { season, league }
}

const divisionsOf = (trx: Trx, seasonId: number) => trx.selectFrom('league_divisions').selectAll().where('season_id', '=', seasonId).where('merged_into', 'is', null).orderBy('level').execute()

export async function createLeague(trx: Trx, clubId: number, userId: number | null, input: { name: string; description?: string; format: LeagueFormat }) {
  const base = slugify(input.name, 50)
  let slug = base
  for (let i = 2; await trx.selectFrom('leagues').select('id').where('slug', '=', slug).executeTakeFirst(); i++) slug = `${base}-${i}`
  const league = await trx.insertInto('leagues').values({ club_id: clubId, slug, name: input.name, description: input.description ?? '', format: input.format, created_by: userId }).returningAll().executeTakeFirstOrThrow()
  await audit({ actorUserId: userId, clubId, entity: 'league', entityId: league.id, action: 'create', after: input }, trx)
  return league
}

export async function createSeason(
  trx: Trx,
  leagueId: number,
  userId: number | null,
  input: { name: string; startsOn: string; endsOn: string; divisions: string[]; rules?: SeasonRules; payment?: SeasonPayment; previousSeasonId?: number | null; status?: 'draft' | 'registration' },
) {
  const league = await trx.selectFrom('leagues').selectAll().where('id', '=', leagueId).executeTakeFirstOrThrow()
  const divisions = league.format !== 'common_tour' ? input.divisions : input.divisions.slice(0, 1)
  if (!divisions.length) throw badRequest('league.divisions_required')
  const boundaries = input.rules?.boundaries ?? divisions.slice(1).map(() => ({ promote: 2, relegate: 2 }))
  const season = await trx
    .insertInto('league_seasons')
    .values({
      league_id: leagueId,
      name: input.name,
      status: input.status ?? 'draft',
      starts_on: input.startsOn,
      ends_on: input.endsOn,
      rules: json({ ...input.rules, boundaries }),
      payment: json(input.payment ?? { mode: 'season' }),
      previous_season_id: input.previousSeasonId ?? null,
    })
    .returningAll()
    .executeTakeFirstOrThrow()
  await trx.insertInto('league_divisions').values(divisions.map((name, i) => ({ season_id: season.id, name, level: i + 1 }))).execute()
  await audit({ actorUserId: userId, clubId: league.club_id, entity: 'league_season', entityId: season.id, action: 'create', after: input }, trx)
  return season
}

const FORMAT_FIELDS = ['boundaries', 'missedRule', 'pointsTable', 'participationPoints', 'bestTours', 'minDivisionSize', 'playoffSize'] as const

/** Edit season settings; format-affecting fields are locked once the first tour exists (4.12). */
export async function updateSeason(
  trx: Trx,
  seasonId: number,
  userId: number | null,
  input: { name?: string; startsOn?: string; endsOn?: string; divisions?: string[]; rules?: SeasonRules; payment?: SeasonPayment },
) {
  const { season, league } = await seasonContext(trx, seasonId)
  if (season.status === 'finished') throw conflict('league.season_finished')
  const toured = await trx.selectFrom('league_tours').select('id').where('season_id', '=', seasonId).executeTakeFirst()
  const rules: SeasonRules = { ...season.rules, ...input.rules }
  if (toured) {
    const before = rulesOf(season.rules)
    const changed = FORMAT_FIELDS.some((k) => input.rules?.[k] !== undefined && JSON.stringify(input.rules[k]) !== JSON.stringify(before[k]))
    const current = await divisionsOf(trx, seasonId)
    if (changed || (input.divisions && JSON.stringify(input.divisions) !== JSON.stringify(current.map((d) => d.name)))) throw conflict('league.format_locked')
  } else if (input.divisions) {
    const names = league.format !== 'common_tour' ? input.divisions : input.divisions.slice(0, 1)
    const current = await trx.selectFrom('league_divisions').selectAll().where('season_id', '=', seasonId).orderBy('level').execute()
    for (const [i, name] of names.entries()) {
      const d = current[i]
      if (d) await trx.updateTable('league_divisions').set({ name, merged_into: null }).where('id', '=', d.id).execute()
      else await trx.insertInto('league_divisions').values({ season_id: seasonId, name, level: i + 1 }).execute()
    }
    const removed = current.slice(names.length).map((d) => d.id)
    if (removed.length) {
      await trx.updateTable('league_participants').set({ division_id: null }).where('division_id', 'in', removed).execute()
      await trx.deleteFrom('league_divisions').where('id', 'in', removed).execute()
    }
    if (!input.rules?.boundaries) rules.boundaries = names.slice(1).map((_, i) => season.rules.boundaries?.[i] ?? { promote: 2, relegate: 2 })
  }
  const updated = await trx
    .updateTable('league_seasons')
    .set({
      name: input.name ?? season.name,
      ...(input.startsOn ? { starts_on: input.startsOn } : {}),
      ...(input.endsOn ? { ends_on: input.endsOn } : {}),
      rules: json(rules),
      payment: json({ ...season.payment, ...input.payment }),
    })
    .where('id', '=', seasonId)
    .returningAll()
    .executeTakeFirstOrThrow()
  if (updated.ends_on < updated.starts_on) throw unprocessable('league.dates_invalid')
  await audit({ actorUserId: userId, clubId: league.club_id, entity: 'league_season', entityId: seasonId, action: 'update', before: season, after: input }, trx)
  return updated
}

/** R-29: other running seasons of the player whose dates overlap — a warning, not a ban. */
export async function seasonConflicts(trx: Trx, seasonId: number, playerIds: number[]) {
  if (!playerIds.length) return []
  const { season } = await seasonContext(trx, seasonId)
  const rows = await trx
    .selectFrom('league_participants as p')
    .innerJoin('league_seasons as s', 's.id', 'p.season_id')
    .innerJoin('leagues as l', 'l.id', 's.league_id')
    .select(['p.player_id', 's.id as season_id', 's.name as season', 'l.name as league'])
    .where('p.player_id', 'in', playerIds)
    .where('p.season_id', '<>', seasonId)
    .where('p.status', 'in', ['active', 'invited', 'frozen'])
    .where('s.status', 'in', ['registration', 'active'])
    .where('s.starts_on', '<=', season.ends_on)
    .where('s.ends_on', '>=', season.starts_on)
    .execute()
  return rows.map((r) => ({ playerId: r.player_id, seasonId: r.season_id, season: r.season, league: r.league }))
}

const singlesRating = (trx: Trx, playerIds: number[]) =>
  playerIds.length
    ? trx
        .selectFrom('players as p')
        .leftJoin('player_ratings as r', (j) => j.onRef('r.player_id', '=', 'p.id').on('r.kind', '=', 'singles'))
        .select(['p.id', 'r.rating', 'p.start_level'])
        .where('p.id', 'in', playerIds)
        .execute()
        .then((rows) => new Map(rows.map((r) => [r.id, r.rating ?? r.start_level])))
    : Promise.resolve(new Map<number, number>())

/**
 * Adds players (club or self-join). Mid-season newcomers go to the bottom division or, with
 * `newcomerPlacement: 'rating'`, to the division their rating reaches. `waiting` puts self-joiners
 * of a next-season draft on the waiting list.
 */
export async function addParticipants(trx: Trx, seasonId: number, playerIds: number[], userId: number | null, options: { divisionId?: number | null; waiting?: boolean } = {}) {
  const { season, league } = await seasonContext(trx, seasonId)
  if (season.status === 'finished') throw conflict('league.season_finished')
  const divisions = await divisionsOf(trx, seasonId)
  const played = await trx.selectFrom('league_tours').select((eb) => eb.fn.max<number>('number').as('n')).where('season_id', '=', seasonId).where('status', '=', 'applied').executeTakeFirst()
  const midSeason = season.status === 'active'
  const byRating = midSeason && league.format !== 'common_tour' && rulesOf(season.rules).newcomerPlacement === 'rating' && options.divisionId == null
  const fallback = options.divisionId ?? (midSeason || league.format === 'common_tour' ? divisions.at(league.format === 'common_tour' ? 0 : -1)!.id : null)
  let ratingOf = new Map<number, number>()
  let divisionRatings: number[][] = []
  if (byRating) {
    ratingOf = await singlesRating(trx, playerIds)
    const members = await trx.selectFrom('league_participants').select(['player_id', 'division_id']).where('season_id', '=', seasonId).where('status', 'in', ['active', 'frozen']).execute()
    const ratings = await singlesRating(trx, members.map((m) => m.player_id))
    divisionRatings = divisions.map((d) => members.filter((m) => m.division_id === d.id).map((m) => ratings.get(m.player_id) ?? 0))
  }
  const warnings = await seasonConflicts(trx, seasonId, playerIds)
  const status = options.waiting ? 'waiting' : 'active'
  for (const playerId of playerIds) {
    const divisionId = byRating ? divisions[divisionByRating(divisionRatings, ratingOf.get(playerId) ?? 0)]!.id : options.waiting ? null : fallback
    await trx
      .insertInto('league_participants')
      .values({ season_id: seasonId, player_id: playerId, division_id: divisionId, status, joined_tour: (played?.n ?? 0) + 1 })
      .onConflict((oc) => oc.columns(['season_id', 'player_id']).doUpdateSet({ status }))
      .execute()
  }
  await audit({ actorUserId: userId, clubId: league.club_id, entity: 'league_season', entityId: seasonId, action: 'add_participants', after: { playerIds, divisionId: fallback, byRating, status } }, trx)
  return { added: playerIds.length, warnings }
}

/** L-3/L-15: into the draft — by rating (current singles rating, start level while calibrating) or manually. Players see it after publishDraft. */
export async function distribute(trx: Trx, seasonId: number, userId: number | null, manual?: { participantId: number; divisionId: number }[]) {
  const { league } = await seasonContext(trx, seasonId)
  const divisions = await divisionsOf(trx, seasonId)
  if (manual?.length) {
    for (const m of manual) {
      if (!divisions.some((d) => d.id === m.divisionId)) throw badRequest('league.division_not_in_season')
      await trx.updateTable('league_participants').set({ draft_division_id: m.divisionId, draft_reason: 'manual' }).where('id', '=', m.participantId).where('season_id', '=', seasonId).execute()
    }
  } else {
    const rows = await trx
      .selectFrom('league_participants as lp')
      .innerJoin('players as p', 'p.id', 'lp.player_id')
      .leftJoin('player_ratings as r', (j) => j.onRef('r.player_id', '=', 'p.id').on('r.kind', '=', 'singles'))
      .select(['lp.id', 'r.rating', 'p.start_level'])
      .where('lp.season_id', '=', seasonId)
      .where('lp.status', 'in', ['active', 'frozen'])
      .execute()
    const groups = distributeByRating(rows.map((r) => ({ id: String(r.id), rating: r.rating ?? r.start_level })), divisionSizes(rows.length, divisions.length))
    for (const [i, ids] of groups.entries()) if (ids.length) await trx.updateTable('league_participants').set({ draft_division_id: divisions[i]!.id, draft_reason: 'distribution' }).where('id', 'in', ids.map(Number)).execute()
  }
  await trx.updateTable('league_seasons').set({ draft_pending: true }).where('id', '=', seasonId).execute()
  await audit({ actorUserId: userId, clubId: league.club_id, entity: 'league_season', entityId: seasonId, action: 'distribute', after: { manual: manual ?? 'rating' } }, trx)
}

/** Organiser edits one player's division in the draft (before publication). */
export async function editDraft(trx: Trx, seasonId: number, participantId: number, divisionId: number, userId: number | null) {
  const divisions = await divisionsOf(trx, seasonId)
  if (!divisions.some((d) => d.id === divisionId)) throw badRequest('league.division_not_in_season')
  const p = await trx.selectFrom('league_participants').select(['id', 'division_id']).where('id', '=', participantId).where('season_id', '=', seasonId).executeTakeFirst()
  if (!p) throw notFound('league.participant_not_found')
  await trx.updateTable('league_participants').set({ draft_division_id: divisionId, draft_reason: 'manual' }).where('id', '=', participantId).execute()
  await trx.updateTable('league_seasons').set({ draft_pending: true }).where('id', '=', seasonId).execute()
  await audit({ actorUserId: userId, entity: 'league_participant', entityId: participantId, action: 'draft', before: { divisionId: p.division_id }, after: { divisionId } }, trx)
}

/** L-13/L-15: publishes the draft — divisions are applied, players get their division and the next tour (invitees get the confirmation request). */
export async function publishDraft(trx: Trx, seasonId: number, userId: number | null) {
  const { season, league } = await seasonContext(trx, seasonId)
  const divisions = await divisionsOf(trx, seasonId)
  const participants = await trx
    .selectFrom('league_participants as lp')
    .innerJoin('players as p', 'p.id', 'lp.player_id')
    .select(['lp.id', 'lp.status', 'lp.division_id', 'lp.draft_division_id', 'lp.draft_reason', 'p.user_id'])
    .where('lp.season_id', '=', seasonId)
    .where('lp.status', 'in', ['active', 'frozen', 'invited'])
    .execute()
  const lastTour = await trx.selectFrom('league_tours').select('id').where('season_id', '=', seasonId).where('status', '=', 'applied').orderBy('number', 'desc').executeTakeFirst()
  const next = await trx.selectFrom('league_tours').select('starts_at').where('season_id', '=', seasonId).where('status', '=', 'planned').orderBy('starts_at').executeTakeFirst()
  let moved = 0
  for (const p of participants) {
    const to = p.draft_division_id ?? p.division_id
    if (p.draft_division_id != null && p.draft_division_id !== p.division_id) {
      moved++
      await trx.updateTable('league_participants').set({ division_id: to }).where('id', '=', p.id).execute()
      if (p.division_id != null)
        await trx.insertInto('league_moves').values({ season_id: seasonId, tour_id: lastTour?.id ?? null, participant_id: p.id, from_division: p.division_id, to_division: to, reason: p.draft_reason ?? 'manual' }).execute()
    }
    if (!p.user_id) continue
    if (p.status === 'invited') await notify({ userId: p.user_id, type: 'league_confirm', data: { leagueSlug: league.slug, seasonId, title: league.name, confirmBy: rulesOf(season.rules).confirmBy } }, trx)
    else await notify({ userId: p.user_id, type: 'league_lineup', data: { leagueSlug: league.slug, title: league.name, division: divisions.find((d) => d.id === to)?.name ?? '', startsAt: next?.starts_at ?? null } }, trx)
  }
  await trx.updateTable('league_participants').set({ draft_division_id: null, draft_reason: null }).where('season_id', '=', seasonId).execute()
  await trx.updateTable('league_seasons').set({ draft_pending: false }).where('id', '=', seasonId).execute()
  await audit({ actorUserId: userId, clubId: league.club_id, entity: 'league_season', entityId: seasonId, action: 'publish_draft', after: { moved } }, trx)
  return { moved, notified: participants.filter((p) => p.user_id).length }
}

export async function setSeasonStatus(trx: Trx, seasonId: number, status: 'registration' | 'active' | 'finished', userId: number | null) {
  const { season, league } = await seasonContext(trx, seasonId)
  const order = ['draft', 'registration', 'active', 'finished']
  if (order.indexOf(status) <= order.indexOf(season.status)) throw conflict('league.bad_status', { from: season.status, to: status })
  if (status === 'active') {
    await trx.updateTable('league_participants').set({ status: 'declined' }).where('season_id', '=', seasonId).where('status', '=', 'invited').execute()
    const bottom = (await divisionsOf(trx, seasonId)).at(league.format === 'common_tour' ? 0 : -1)!
    await trx.updateTable('league_participants').set({ status: 'active', division_id: bottom.id }).where('season_id', '=', seasonId).where('status', '=', 'waiting').execute()
    const missing = await trx.selectFrom('league_participants').select('id').where('season_id', '=', seasonId).where('status', '=', 'active').where('division_id', 'is', null).where('draft_division_id', 'is', null).executeTakeFirst()
    if (missing) await distribute(trx, seasonId, userId)
    if (missing || (await seasonContext(trx, seasonId)).season.draft_pending) await publishDraft(trx, seasonId, userId)
  }
  await trx.updateTable('league_seasons').set({ status }).where('id', '=', seasonId).execute()
  await audit({ actorUserId: userId, clubId: league.club_id, entity: 'league_season', entityId: seasonId, action: 'status', before: { status: season.status }, after: { status } }, trx)
}

/** Creates the tour: one tournament per division (or one common), published, with participants registered by the club. */
export async function createTour(trx: Trx, seasonId: number, userId: number | null, input: { startsAt: string; deadlineAt?: string | null; hallId: number; playoff?: boolean }) {
  const { season, league } = await seasonContext(trx, seasonId)
  if (season.status !== 'active') throw conflict('league.season_not_active')
  if (league.format === 'season_rr' || league.format === 'free_dates') throw conflict('league.format_uses_fixtures')
  if (season.draft_pending) throw conflict('league.draft_unpublished')
  const last = await trx.selectFrom('league_tours').select((eb) => eb.fn.max<number>('number').as('n')).where('season_id', '=', seasonId).executeTakeFirst()
  const number = (last?.n ?? 0) + 1
  const tour = await trx
    .insertInto('league_tours')
    .values({ season_id: seasonId, number, kind: input.playoff ? 'playoff' : 'regular', starts_at: new Date(input.startsAt), deadline_at: input.deadlineAt ? new Date(input.deadlineAt) : null })
    .returningAll()
    .executeTakeFirstOrThrow()
  const divisions = await divisionsOf(trx, seasonId)
  const participants = await trx.selectFrom('league_participants').select(['id', 'player_id', 'division_id']).where('season_id', '=', seasonId).where('status', '=', 'active').execute()
  const groups = input.playoff
    ? [{ division: null as number | null, name: 'Плей-офф', players: await playoffPlayers(trx, seasonId) }]
    : league.format === 'common_tour'
      ? [{ division: divisions[0]!.id as number | null, name: 'Общий тур', players: participants.map((p) => p.player_id) }]
      : divisions.map((d) => ({ division: d.id as number | null, name: d.name, players: participants.filter((p) => p.division_id === d.id).map((p) => p.player_id) }))
  const warnings: { playerId: number; code: string }[] = []
  const tournaments = []
  for (const g of groups) {
    if (g.players.length < 2) continue
    const t = await createTournament(trx, league.club_id, userId, {
      type: 'singles',
      hallId: input.hallId,
      title: `${league.name}. ${season.name}. ${input.playoff ? 'Плей-офф' : `Тур ${number}`}${groups.length > 1 ? ` · ${g.name}` : ''}`,
      startsAt: new Date(input.startsAt).toISOString(),
      template: input.playoff ? 'olympic' : g.players.length > 8 ? 'gs1' : 'round_robin',
      templateParams: {},
      maxParticipants: Math.max(4, g.players.length),
      minParticipants: 2,
      fee: league.format && (season.payment as SeasonPayment).mode === 'per_tour' ? ((season.payment as SeasonPayment).tourPrice ?? 0) : 0,
      restrictions: {},
      prizes: '',
      description: league.description,
      commentForPlayers: '',
      staffComment: '',
      isRated: true,
      settings: {},
    })
    await trx.updateTable('tournaments').set({ league_tour_id: tour.id, league_division_id: g.division }).where('id', '=', t.id).execute()
    await publishTournament(trx, t.id, userId)
    for (const p of g.players) {
      try {
        await registerPlayer(trx, t.id, p, userId, { byClub: true })
      } catch (e) {
        warnings.push({ playerId: p, code: (e as { code?: string }).code ?? 'error' })
      }
    }
    tournaments.push({ id: t.id, slug: t.slug, divisionId: g.division })
  }
  await audit({ actorUserId: userId, clubId: league.club_id, entity: 'league_tour', entityId: tour.id, action: 'create', after: { number, tournaments: tournaments.map((t) => t.id) } }, trx)
  return { tour, tournaments, warnings }
}

async function playoffPlayers(trx: Trx, seasonId: number): Promise<number[]> {
  const { season } = await seasonContext(trx, seasonId)
  const table = await seasonTable(trx, seasonId)
  const ids = playoffSeeds(table.rows.map((r) => ({ id: String(r.participantId) })), rulesOf(season.rules).playoffSize)
  const rows = ids.length ? await trx.selectFrom('league_participants').select(['id', 'player_id']).where('id', 'in', ids.map(Number)).execute() : []
  return ids.map((id) => rows.find((r) => r.id === Number(id))!.player_id)
}

/** L-4: after all tour tournaments finished — points, then promotion/relegation per boundary with missed-tour and freeze rules. */
export async function applyTour(trx: Trx, tourId: number, userId: number | null) {
  const tour = await trx.selectFrom('league_tours').selectAll().where('id', '=', tourId).forUpdate().executeTakeFirst()
  if (!tour) throw notFound('league.tour_not_found')
  if (tour.status === 'applied') throw conflict('league.tour_already_applied')
  const { season, league } = await seasonContext(trx, tour.season_id)
  const rules = rulesOf(season.rules)
  const tournaments = await trx.selectFrom('tournaments').select(['id', 'status', 'league_division_id']).where('league_tour_id', '=', tourId).execute()
  if (tournaments.some((t) => !['finished', 'finished_early', 'cancelled'].includes(t.status))) throw conflict('league.tour_not_finished')
  const places = await trx
    .selectFrom('entries')
    .select(['tournament_id', 'player_id', 'final_place'])
    .where('tournament_id', 'in', tournaments.length ? tournaments.map((t) => t.id) : [0])
    .where('final_place', 'is not', null)
    .execute()
  const participants = await trx
    .selectFrom('league_participants as lp')
    .innerJoin('players as pl', 'pl.id', 'lp.player_id')
    .selectAll('lp')
    .select(['pl.user_id', 'pl.first_name', 'pl.last_name'])
    .where('lp.season_id', '=', season.id)
    .where('lp.status', 'in', ['active', 'frozen'])
    .execute()
  const divisions = await divisionsOf(trx, season.id)
  const placeOf = new Map(places.map((p) => [p.player_id, p.final_place!]))
  const skipped = new Set((await trx.selectFrom('league_tour_skips').select('participant_id').where('tour_id', '=', tourId).execute()).map((s) => s.participant_id))
  const previous = await trx
    .selectFrom('league_results as r')
    .innerJoin('league_tours as t', 't.id', 'r.tour_id')
    .select(['r.participant_id', 'r.overall_place'])
    .where('t.season_id', '=', season.id)
    .where('t.number', '=', tour.number - 1)
    .execute()
  const prevPlace = new Map(previous.map((r) => [r.participant_id, r.overall_place ?? 1e6]))
  const missed = new Set<string>()
  for (const p of participants) if (!placeOf.has(p.player_id) && p.status === 'active') missed.add(String(p.id))
  // Tour order per division: players by place, then missed ones by their place in the previous tour, frozen last.
  const rank = (p: (typeof participants)[number]) => placeOf.get(p.player_id) ?? (p.status === 'frozen' ? 2e6 : 1e6 + (prevPlace.get(p.id) ?? 1e6) / 1e7)
  const groups = league.format === 'divisions' ? divisions.map((d) => participants.filter((p) => p.division_id === d.id)) : [participants]
  const ordered = groups.map((g) => [...g].sort((a, b) => rank(a) - rank(b)).map((p) => String(p.id)))
  const overall = overallPlaces(ordered)
  const inTour = overall.size
  let noShows = 0
  for (const p of participants) {
    const played = placeOf.has(p.player_id)
    const divisionPlace = ordered.find((d) => d.includes(String(p.id)))!.indexOf(String(p.id)) + 1
    const overallPlace = overall.get(String(p.id))!
    const isMissed = missed.has(String(p.id))
    const noShow = isMissed && !skipped.has(p.id)
    const points = !played ? 0 : rules.pointsTable.length ? tourPoints(overallPlace, rules.pointsTable, rules.participationPoints) : Math.max(defaultTourPoints(overallPlace, inTour), rules.participationPoints)
    await trx
      .insertInto('league_results')
      .values({ tour_id: tourId, participant_id: p.id, division_id: p.division_id, place: played || league.format === 'divisions' ? divisionPlace : null, overall_place: played ? overallPlace : null, points, missed: isMissed, no_show: noShow })
      .execute()
    if (isMissed) await trx.updateTable('league_participants').set({ missed_tours: p.missed_tours + 1, no_shows: p.no_shows + (noShow ? 1 : 0) }).where('id', '=', p.id).execute()
    if (noShow) {
      noShows++
      if (p.no_shows + 1 === rules.noShowWarn && league.created_by)
        await notify({ userId: league.created_by, type: 'league_no_shows', data: { leagueSlug: league.slug, title: league.name, player: playerName(p), count: p.no_shows + 1 } }, trx)
    }
    if (p.user_id && tour.kind === 'regular')
      await notify({ userId: p.user_id, type: 'league_tour_results', data: { leagueSlug: league.slug, title: league.name, tour: tour.number, place: played ? overallPlace : null, points } }, trx)
  }
  const moves: { participantId: number; from: number; to: number; reason: string }[] = []
  if (league.format === 'divisions' && tour.kind === 'regular' && divisions.length > 1) {
    const frozen = new Set(participants.filter((p) => p.status === 'frozen').map((p) => String(p.id)))
    // A division over its size (newcomers placed by rating) sends one more player down per extra place.
    const boundaries = rules.boundaries.map((b, i) => ({ ...b, relegate: b.relegate + (rules.divisionSize ? Math.max(0, ordered[i]!.length - rules.divisionSize) : 0) }))
    const result = applyMovements(ordered, boundaries, { missed, missedRule: rules.missedRule, frozen })
    for (const m of result.moves) {
      const from = divisions[m.from]!.id
      const to = divisions[m.to]!.id
      await trx.updateTable('league_participants').set({ draft_division_id: to, draft_reason: m.reason }).where('id', '=', Number(m.id)).execute()
      moves.push({ participantId: Number(m.id), from, to, reason: m.reason })
    }
    await trx.updateTable('league_seasons').set({ draft_pending: true }).where('id', '=', season.id).execute()
  }
  // A freeze covers one tour.
  await trx.updateTable('league_participants').set({ status: 'active' }).where('season_id', '=', season.id).where('status', '=', 'frozen').execute()
  await trx.updateTable('league_tours').set({ status: 'applied' }).where('id', '=', tourId).execute()
  await audit({ actorUserId: userId, clubId: league.club_id, entity: 'league_tour', entityId: tourId, action: 'apply', after: { moves: moves.length, missed: missed.size, noShows } }, trx)
  return { moves, missed: missed.size, noShows, draft: moves.length > 0 }
}

/** «Заморозка»: one warned skip per season without relegation (the club can switch it off). */
export async function setFrozen(trx: Trx, participantId: number, frozen: boolean, userId: number | null) {
  const p = await trx.selectFrom('league_participants').selectAll().where('id', '=', participantId).executeTakeFirst()
  if (!p) throw notFound('league.participant_not_found')
  if (!['active', 'frozen'].includes(p.status)) throw conflict('league.participant_inactive')
  if (frozen && p.status !== 'frozen') {
    const { season } = await seasonContext(trx, p.season_id)
    const rules = rulesOf(season.rules)
    if (!rules.freezeEnabled) throw conflict('league.freeze_disabled')
    if (p.freezes_used >= 1) throw conflict('league.freeze_used')
  }
  await trx
    .updateTable('league_participants')
    .set({ status: frozen ? 'frozen' : 'active', freezes_used: frozen && p.status !== 'frozen' ? p.freezes_used + 1 : p.freezes_used })
    .where('id', '=', participantId)
    .execute()
  await audit({ actorUserId: userId, entity: 'league_participant', entityId: participantId, action: frozen ? 'freeze' : 'unfreeze' }, trx)
}

/** «Пропущу тур»: a warned skip before the tour deadline (no «неявка» mark); optionally uses the season freeze. */
export async function skipTour(trx: Trx, tourId: number, playerId: number, input: { skip: boolean; freeze?: boolean }) {
  const tour = await trx.selectFrom('league_tours').selectAll().where('id', '=', tourId).executeTakeFirst()
  if (!tour) throw notFound('league.tour_not_found')
  if (tour.status !== 'planned' || new Date() >= (tour.deadline_at ?? tour.starts_at)) throw conflict('league.skip_deadline_passed')
  const p = await trx.selectFrom('league_participants').selectAll().where('season_id', '=', tour.season_id).where('player_id', '=', playerId).executeTakeFirst()
  if (!p || !['active', 'frozen'].includes(p.status)) throw forbidden('league.not_participant')
  if (!input.skip) {
    await trx.deleteFrom('league_tour_skips').where('tour_id', '=', tourId).where('participant_id', '=', p.id).execute()
    if (p.status === 'frozen') await trx.updateTable('league_participants').set({ status: 'active', freezes_used: Math.max(0, p.freezes_used - 1) }).where('id', '=', p.id).execute()
    return { skipped: false, frozen: false }
  }
  await trx.insertInto('league_tour_skips').values({ tour_id: tourId, participant_id: p.id }).onConflict((oc) => oc.doNothing()).execute()
  if (input.freeze) await setFrozen(trx, p.id, true, null)
  const entries = await trx
    .selectFrom('entries as e')
    .innerJoin('tournaments as t', 't.id', 'e.tournament_id')
    .select(['e.id', 'e.status'])
    .where('t.league_tour_id', '=', tourId)
    .where('t.status', 'in', ['published', 'registration_closed'])
    .where('e.player_id', '=', playerId)
    .execute()
  for (const e of entries) {
    try {
      assertTransition('entry', entryStatus, e.status, 'cancelled_by_player')
      await trx.updateTable('entries').set({ status: 'cancelled_by_player', updated_at: new Date() }).where('id', '=', e.id).execute()
    } catch {
      // Already out of the tournament.
    }
  }
  await audit({ actorUserId: null, entity: 'league_participant', entityId: p.id, action: 'skip_tour', after: { tourId, freeze: Boolean(input.freeze) } }, trx)
  return { skipped: true, frozen: Boolean(input.freeze) }
}

/** L-8: moving a player between divisions only inside the transfer window (the organiser can override with force). */
export async function transfer(trx: Trx, participantId: number, divisionId: number, userId: number | null, force = false) {
  const p = await trx.selectFrom('league_participants').selectAll().where('id', '=', participantId).executeTakeFirst()
  if (!p) throw notFound('league.participant_not_found')
  const { season } = await seasonContext(trx, p.season_id)
  const window = rulesOf(season.rules).transferWindow
  const now = new Date()
  if (!force && (!window || now < new Date(window.from) || now > new Date(window.to))) throw conflict('league.transfer_window_closed', window)
  const division = await trx.selectFrom('league_divisions').select('id').where('id', '=', divisionId).where('season_id', '=', p.season_id).executeTakeFirst()
  if (!division) throw badRequest('league.division_not_in_season')
  await trx.updateTable('league_participants').set({ division_id: divisionId }).where('id', '=', participantId).execute()
  await trx.insertInto('league_moves').values({ season_id: p.season_id, participant_id: participantId, from_division: p.division_id, to_division: divisionId, reason: 'transfer' }).execute()
  await audit({ actorUserId: userId, entity: 'league_participant', entityId: participantId, action: 'transfer', before: { divisionId: p.division_id }, after: { divisionId } }, trx)
}

/** L-9: divisions below the minimum size are merged into a neighbour. */
export async function mergeDivisions(trx: Trx, seasonId: number, userId: number | null) {
  const { season, league } = await seasonContext(trx, seasonId)
  const divisions = await divisionsOf(trx, seasonId)
  const counts = await Promise.all(
    divisions.map(async (d) => Number((await trx.selectFrom('league_participants').select((eb) => eb.fn.countAll<number>().as('n')).where('division_id', '=', d.id).where('status', 'in', ['active', 'frozen']).executeTakeFirstOrThrow()).n)),
  )
  const plan = mergeSmallDivisions(counts, rulesOf(season.rules).minDivisionSize)
  for (const m of plan) {
    const from = divisions[m.from]!
    const to = divisions[m.to]!
    const moved = await trx.updateTable('league_participants').set({ division_id: to.id }).where('division_id', '=', from.id).returning('id').execute()
    for (const r of moved) await trx.insertInto('league_moves').values({ season_id: seasonId, participant_id: r.id, from_division: from.id, to_division: to.id, reason: 'merge' }).execute()
    await trx.updateTable('league_divisions').set({ merged_into: to.id }).where('id', '=', from.id).execute()
  }
  await audit({ actorUserId: userId, clubId: league.club_id, entity: 'league_season', entityId: seasonId, action: 'merge_divisions', after: plan }, trx)
  return plan
}

/**
 * L-5: next season draft — divisions copied, participants (in the order of the final table) go into the
 * division the season-end movements gave them. The organiser edits the draft; publishing sends the
 * «confirm participation» invitations with the deadline.
 */
export async function nextSeason(trx: Trx, seasonId: number, userId: number | null, input: { name: string; startsOn: string; endsOn: string; confirmBy?: string | null }) {
  const { season, league } = await seasonContext(trx, seasonId)
  const divisions = await divisionsOf(trx, seasonId)
  const confirmBy = input.confirmBy ?? new Date(Date.now() + 7 * 86400000).toISOString()
  const table = await seasonTable(trx, seasonId)
  const participants = table.rows.filter((r) => r.status === 'active' || r.status === 'frozen')
  const levelOf = (r: (typeof participants)[number]) => divisions.find((d) => d.id === (r.draftDivisionId ?? r.divisionId))?.level ?? divisions.length
  const capacities = divisions.map((d) => participants.filter((r) => levelOf(r) === d.level).length)
  const next = await createSeason(trx, league.id, userId, {
    ...input,
    divisions: divisions.map((d) => d.name),
    rules: { ...season.rules, confirmBy, capacities },
    payment: season.payment,
    previousSeasonId: seasonId,
    status: 'registration',
  })
  const nextDivisions = await divisionsOf(trx, next.id)
  for (const r of participants)
    await trx.insertInto('league_participants').values({ season_id: next.id, player_id: r.playerId, division_id: null, draft_division_id: nextDivisions.find((d) => d.level === levelOf(r))?.id ?? null, draft_reason: 'season', status: 'invited' }).execute()
  await trx.updateTable('league_seasons').set({ draft_pending: true }).where('id', '=', next.id).execute()
  return next
}

/**
 * L-5: invitations not confirmed by the deadline expire; freed places are taken by the best of the
 * division below (by the previous season table) and, at the bottom, from the waiting list.
 */
export async function expireInvitations(trx: Trx, seasonId: number, now = new Date()) {
  const { season, league } = await seasonContext(trx, seasonId)
  const rules = rulesOf(season.rules)
  if (season.status !== 'registration' || season.draft_pending || !rules.confirmBy || new Date(rules.confirmBy) > now) return { expired: 0, filled: 0 }
  const expired = await trx.updateTable('league_participants').set({ status: 'declined' }).where('season_id', '=', seasonId).where('status', '=', 'invited').returning('id').execute()
  const divisions = await divisionsOf(trx, seasonId)
  const prevOrder = season.previous_season_id ? (await seasonTable(trx, season.previous_season_id)).rows.map((r) => r.playerId) : []
  const rankOf = (playerId: number) => (prevOrder.includes(playerId) ? prevOrder.indexOf(playerId) : 1e6)
  let filled = 0
  for (const [i, d] of divisions.entries()) {
    const capacity = rules.capacities[i] ?? rules.divisionSize ?? 0
    const members = await trx.selectFrom('league_participants').select('id').where('division_id', '=', d.id).where('status', 'in', ['active', 'invited']).execute()
    let deficit = capacity - members.length
    while (deficit > 0) {
      const below = divisions[i + 1]
      let pick: { id: number; player_id: number } | undefined
      if (below) {
        const candidates = await trx.selectFrom('league_participants').select(['id', 'player_id']).where('division_id', '=', below.id).where('status', '=', 'active').execute()
        pick = candidates.sort((a, b) => rankOf(a.player_id) - rankOf(b.player_id))[0]
      } else pick = await trx.selectFrom('league_participants').select(['id', 'player_id']).where('season_id', '=', seasonId).where('status', '=', 'waiting').orderBy('created_at').orderBy('id').executeTakeFirst()
      if (!pick) break
      await trx.updateTable('league_participants').set({ division_id: d.id, status: 'active' }).where('id', '=', pick.id).execute()
      await trx.insertInto('league_moves').values({ season_id: seasonId, participant_id: pick.id, from_division: below?.id ?? null, to_division: d.id, reason: below ? 'fill' : 'waitlist' }).execute()
      const u = await trx.selectFrom('players').select('user_id').where('id', '=', pick.player_id).executeTakeFirst()
      if (u?.user_id) await notify({ userId: u.user_id, type: 'league_lineup', data: { leagueSlug: league.slug, title: league.name, division: d.name } }, trx)
      filled++
      deficit--
    }
  }
  if (expired.length || filled) await audit({ actorUserId: null, clubId: league.club_id, entity: 'league_season', entityId: seasonId, action: 'expire_invitations', after: { expired: expired.length, filled } }, trx)
  return { expired: expired.length, filled }
}

export async function confirmParticipation(trx: Trx, seasonId: number, playerId: number, accept: boolean) {
  const p = await trx.selectFrom('league_participants').selectAll().where('season_id', '=', seasonId).where('player_id', '=', playerId).executeTakeFirst()
  if (!p) throw notFound('league.participant_not_found')
  if (p.status !== 'invited') throw conflict('league.not_invited')
  const { season } = await seasonContext(trx, seasonId)
  const by = rulesOf(season.rules).confirmBy
  if (by && new Date(by) < new Date()) throw conflict('league.confirm_deadline_passed')
  await trx.updateTable('league_participants').set({ status: accept ? 'active' : 'declined' }).where('id', '=', p.id).execute()
  await audit({ actorUserId: null, entity: 'league_participant', entityId: p.id, action: accept ? 'confirm' : 'decline' }, trx)
  return { status: accept ? 'active' : 'declined', warnings: accept ? await seasonConflicts(trx, seasonId, [playerId]) : [] }
}

// ---------------------------------------------------------------------------
// Fixtures: season round robin and «свободные даты» (L-6, L-7)

export async function generateFixtures(trx: Trx, seasonId: number, userId: number | null, deadlineDays = 14) {
  const { season, league } = await seasonContext(trx, seasonId)
  if (!['season_rr', 'free_dates'].includes(league.format)) throw conflict('league.format_uses_tours')
  await trx.deleteFrom('league_fixtures').where('season_id', '=', seasonId).where('kind', '=', 'regular').where('status', '=', 'pending').execute()
  let count = 0
  for (const d of await divisionsOf(trx, seasonId)) {
    const ps = await trx.selectFrom('league_participants').select('id').where('division_id', '=', d.id).where('status', '=', 'active').orderBy('id').execute()
    for (const [round, pairs] of roundRobinTours(ps.length).entries())
      for (const [a, b] of pairs) {
        await trx
          .insertInto('league_fixtures')
          .values({ season_id: seasonId, division_id: d.id, home_participant: ps[a]!.id, away_participant: ps[b]!.id, round: round + 1, deadline_at: new Date(new Date(season.starts_on).getTime() + (round + 1) * deadlineDays * 86400000) })
          .execute()
        count++
      }
  }
  await audit({ actorUserId: userId, clubId: league.club_id, entity: 'league_season', entityId: seasonId, action: 'fixtures', after: { count } }, trx)
  return { count }
}

async function fixtureForPlayer(trx: Trx, fixtureId: number, playerId: number) {
  const f = await trx.selectFrom('league_fixtures').selectAll().where('id', '=', fixtureId).forUpdate().executeTakeFirst()
  if (!f) throw notFound('league.fixture_not_found')
  const ps = await trx.selectFrom('league_participants').select(['id', 'player_id']).where('id', 'in', [f.home_participant, f.away_participant]).execute()
  const mine = ps.find((p) => p.player_id === playerId)
  if (!mine) throw forbidden('league.not_your_fixture')
  const other = ps.find((p) => p !== mine)!
  return { f, mine: mine.id, other }
}

async function tell(trx: Trx, playerId: number, data: Record<string, unknown>) {
  const u = await trx.selectFrom('players').select('user_id').where('id', '=', playerId).executeTakeFirst()
  if (u?.user_id) await notify({ userId: u.user_id, type: 'league_fixture', data }, trx)
}

/** Propose (or reschedule) a date and table; the opponent confirms. */
export async function proposeFixture(trx: Trx, fixtureId: number, playerId: number, input: { startsAt: string; tableId: number }) {
  const { f, mine, other } = await fixtureForPlayer(trx, fixtureId, playerId)
  if (['reported', 'confirmed'].includes(f.status)) throw conflict('league.fixture_played')
  if (f.booking_id) {
    const b = await trx.selectFrom('bookings').select(['id', 'status']).where('id', '=', f.booking_id).executeTakeFirst()
    if (b && b.status === 'confirmed') {
      assertTransition('booking', bookingStatus, b.status, 'cancelled_by_player')
      await trx.updateTable('bookings').set({ status: 'cancelled_by_player', updated_at: new Date() }).where('id', '=', b.id).execute()
    }
  }
  await trx.updateTable('league_fixtures').set({ status: 'proposed', proposed_by: mine, starts_at: new Date(input.startsAt), table_id: input.tableId, booking_id: null }).where('id', '=', f.id).execute()
  await tell(trx, other.player_id, { fixtureId: f.id, event: 'proposed', startsAt: input.startsAt })
  return { status: 'proposed' }
}

/** The opponent confirms: the table is booked through the booking service (pay at the club). */
export async function confirmFixture(trx: Trx, fixtureId: number, playerId: number, userId: number) {
  const { f, mine, other } = await fixtureForPlayer(trx, fixtureId, playerId)
  if (f.status !== 'proposed' || !f.starts_at || !f.table_id) throw conflict('league.fixture_not_proposed')
  if (f.proposed_by === mine) throw conflict('league.confirm_by_opponent')
  const table = await trx.selectFrom('hall_tables').select(['hall_id']).where('id', '=', f.table_id).executeTakeFirstOrThrow()
  const booking = await createBooking(trx, { hallId: table.hall_id, tableId: f.table_id, start: f.starts_at, minutes: 60, playerId, note: `Лига: матч #${f.id}`, source: 'online', actorUserId: userId })
  await trx.updateTable('league_fixtures').set({ status: 'scheduled', booking_id: booking.id }).where('id', '=', f.id).execute()
  await tell(trx, other.player_id, { fixtureId: f.id, event: 'confirmed', table: booking.tableNumber })
  return { status: 'scheduled', bookingId: booking.id }
}

/** L-7: one player reports the score, the other confirms it. */
export async function reportFixture(trx: Trx, fixtureId: number, playerId: number, score: { setsMine: number; setsOpponent: number }) {
  const { f, mine, other } = await fixtureForPlayer(trx, fixtureId, playerId)
  if (f.status === 'confirmed') throw conflict('league.fixture_played')
  if (score.setsMine === score.setsOpponent) throw unprocessable('match.invalid_score')
  const home = f.home_participant === mine
  await trx
    .updateTable('league_fixtures')
    .set({ status: 'reported', reported_by: mine, sets_home: home ? score.setsMine : score.setsOpponent, sets_away: home ? score.setsOpponent : score.setsMine })
    .where('id', '=', f.id)
    .execute()
  await tell(trx, other.player_id, { fixtureId: f.id, event: 'score' })
  return { status: 'reported' }
}

export async function confirmFixtureResult(trx: Trx, fixtureId: number, playerId: number, accept: boolean) {
  const { f, mine } = await fixtureForPlayer(trx, fixtureId, playerId)
  if (f.status !== 'reported') throw conflict('league.fixture_not_reported')
  if (f.reported_by === mine) throw conflict('league.confirm_by_opponent')
  if (!accept) {
    await trx.updateTable('league_fixtures').set({ status: f.booking_id ? 'scheduled' : 'pending', sets_home: null, sets_away: null, reported_by: null }).where('id', '=', f.id).execute()
    return { status: 'disputed' }
  }
  await trx.updateTable('league_fixtures').set({ status: 'confirmed' }).where('id', '=', f.id).execute()
  await rateFixture(trx, f.id)
  return { status: 'confirmed' }
}

/** Played league fixtures change Elo like tournament matches (verified club only); technical results never do. */
async function rateFixture(trx: Trx, fixtureId: number) {
  const f = await trx.selectFrom('league_fixtures').selectAll().where('id', '=', fixtureId).executeTakeFirstOrThrow()
  if (f.technical || f.rating_home != null || f.sets_home == null || f.sets_away == null) return
  const club = await trx
    .selectFrom('league_seasons as s')
    .innerJoin('leagues as l', 'l.id', 's.league_id')
    .innerJoin('clubs as c', 'c.id', 'l.club_id')
    .select('c.status')
    .where('s.id', '=', f.season_id)
    .executeTakeFirstOrThrow()
  if (club.status !== 'active') return
  const ps = await trx.selectFrom('league_participants').select(['id', 'player_id']).where('id', 'in', [f.home_participant, f.away_participant]).execute()
  const home = ps.find((p) => p.id === f.home_participant)!.player_id
  const away = ps.find((p) => p.id === f.away_participant)!.player_id
  const delta = await applyLeagueFixtureRating(trx, home, away, f.sets_home > f.sets_away)
  await trx.updateTable('league_fixtures').set({ rating_home: delta.home, rating_away: delta.away }).where('id', '=', f.id).execute()
}

/** L-7: a fixture not played by the end of its window — the organiser gives a technical defeat to one side or both. */
export async function technicalResult(trx: Trx, fixtureId: number, loser: 'home' | 'away' | 'both', userId: number | null) {
  const f = await trx.selectFrom('league_fixtures').selectAll().where('id', '=', fixtureId).forUpdate().executeTakeFirst()
  if (!f) throw notFound('league.fixture_not_found')
  if (f.status === 'confirmed') throw conflict('league.fixture_played')
  if (f.deadline_at && f.deadline_at > new Date()) throw conflict('league.fixture_window_open')
  await trx
    .updateTable('league_fixtures')
    .set({ status: 'confirmed', technical: loser, sets_home: loser === 'home' || loser === 'both' ? 0 : 3, sets_away: loser === 'away' || loser === 'both' ? 0 : 3 })
    .where('id', '=', f.id)
    .execute()
  await audit({ actorUserId: userId, entity: 'league_fixture', entityId: f.id, action: 'technical', after: { loser } }, trx)
  return { status: 'confirmed', technical: loser }
}

/**
 * Season end for round robin / free dates (L-4): movements by the final division tables, with optional
 * play-off fixtures between neighbouring divisions first. The result is the draft for the next season.
 */
export async function finishSeason(trx: Trx, seasonId: number, userId: number | null) {
  const { season, league } = await seasonContext(trx, seasonId)
  if (season.status !== 'active') throw conflict('league.season_not_active')
  const rules = rulesOf(season.rules)
  const divisions = await divisionsOf(trx, seasonId)
  const moves: { participantId: number; from: number; to: number; reason: string }[] = []
  if ((league.format === 'season_rr' || league.format === 'free_dates') && divisions.length > 1) {
    const table = await seasonTable(trx, seasonId)
    const orders = divisions.map((d) => table.rows.filter((r) => r.divisionId === d.id && r.status !== 'invited').map((r) => String(r.participantId)))
    const pairs = rules.playoffMatches ? playoffPairs(orders, rules.boundaries) : []
    const fixtures = await trx.selectFrom('league_fixtures').selectAll().where('season_id', '=', seasonId).where('kind', '=', 'playoff').execute()
    if (pairs.length && !fixtures.length) {
      for (const p of pairs)
        await trx
          .insertInto('league_fixtures')
          .values({ season_id: seasonId, division_id: null, kind: 'playoff', round: 0, home_participant: Number(p.upper), away_participant: Number(p.lower), deadline_at: new Date(Date.now() + 14 * 86400000) })
          .execute()
      await audit({ actorUserId: userId, clubId: league.club_id, entity: 'league_season', entityId: seasonId, action: 'playoff_fixtures', after: pairs }, trx)
      return { finished: false, playoffs: pairs.length, moves }
    }
    if (fixtures.some((f) => f.status !== 'confirmed')) throw conflict('league.playoffs_pending')
    const base = applyMovements(orders, rules.boundaries)
    const played = fixtures.map((f) => ({
      boundary: orders.findIndex((ids) => ids.includes(String(f.home_participant))),
      upper: String(f.home_participant),
      lower: String(f.away_participant),
      lowerWon: (f.sets_away ?? 0) > (f.sets_home ?? 0),
    }))
    const after = applyPlayoffs(base.divisions, played)
    const target = new Map<string, number>()
    after.divisions.forEach((ids, i) => ids.forEach((id) => target.set(id, i)))
    orders.forEach((ids, from) =>
      ids.forEach((id) => {
        const to = target.get(id)!
        if (to !== from) moves.push({ participantId: Number(id), from: divisions[from]!.id, to: divisions[to]!.id, reason: to < from ? 'promotion' : 'relegation' })
      }),
    )
    for (const m of moves) {
      await trx.updateTable('league_participants').set({ draft_division_id: m.to, draft_reason: m.reason }).where('id', '=', m.participantId).execute()
      await trx.insertInto('league_moves').values({ season_id: seasonId, participant_id: m.participantId, from_division: m.from, to_division: m.to, reason: m.reason }).execute()
    }
  }
  await trx.updateTable('league_seasons').set({ status: 'finished' }).where('id', '=', seasonId).execute()
  await audit({ actorUserId: userId, clubId: league.club_id, entity: 'league_season', entityId: seasonId, action: 'finish', after: { moves: moves.length } }, trx)
  return { finished: true, playoffs: 0, moves }
}

// ---------------------------------------------------------------------------
// Tables and the public page

type Zone = 'up' | 'down' | null

/**
 * Season table. Round robin / free dates: per division, match points (configurable win / loss / no-show)
 * and the 4.6 tie-breaks. Tour formats: points for overall places, N best tours, ties by best place,
 * first places, last tour. Each row carries its division place and promotion/relegation zone.
 */
export async function seasonTable(trx: Trx, seasonId: number) {
  const { season, league } = await seasonContext(trx, seasonId)
  const rules = rulesOf(season.rules)
  const divisions = await divisionsOf(trx, seasonId)
  const participants = await trx
    .selectFrom('league_participants as lp')
    .innerJoin('players as p', 'p.id', 'lp.player_id')
    .leftJoin('player_ratings as r', (j) => j.onRef('r.player_id', '=', 'p.id').on('r.kind', '=', 'singles'))
    .select(['lp.id', 'lp.player_id', 'lp.division_id', 'lp.draft_division_id', 'lp.draft_reason', 'lp.status', 'lp.missed_tours', 'lp.no_shows', 'lp.freezes_used', 'p.first_name', 'p.last_name', 'r.rating'])
    .where('lp.season_id', '=', seasonId)
    .where('lp.status', 'in', ['active', 'frozen', 'invited', 'waiting'])
    .execute()
  const stats = new Map<number, { total: number; tours: number; dropped: number[]; firsts: number; bestPlace: number | null; played: number; wins: number }>()
  let order: number[]
  if (league.format === 'season_rr' || league.format === 'free_dates') {
    const fixtures = await trx.selectFrom('league_fixtures').selectAll().where('season_id', '=', seasonId).where('kind', '=', 'regular').where('status', '=', 'confirmed').execute()
    const ratings = Object.fromEntries(participants.map((p) => [String(p.id), p.rating ?? 0]))
    order = []
    const groups = [...divisions.map((d) => d.id as number | null), null]
    for (const divisionId of groups) {
      const ids = participants.filter((p) => p.division_id === divisionId && p.status !== 'waiting').map((p) => String(p.id))
      if (!ids.length) continue
      const matches: GroupMatchResult[] = fixtures
        .filter((f) => f.division_id === divisionId && f.technical !== 'both')
        .map((f) => {
          const homeWon = f.technical ? f.technical === 'away' : (f.sets_home ?? 0) > (f.sets_away ?? 0)
          return { home: String(f.home_participant), away: String(f.away_participant), winner: homeWon ? 'home' : 'away', setsHome: f.sets_home ?? 0, setsAway: f.sets_away ?? 0, games: [], type: f.technical ? 'walkover' : 'normal' }
        })
      const standing = groupStandings(ids, matches, { points: { win: rules.matchPoints.win, loss: rules.matchPoints.loss, walkover: rules.matchPoints.noShow }, ratings, lotsSeed: seasonId })
      for (const r of standing.rows) {
        const both = fixtures.filter((f) => f.technical === 'both' && (f.home_participant === Number(r.id) || f.away_participant === Number(r.id))).length
        stats.set(Number(r.id), { total: r.points + both * rules.matchPoints.noShow, tours: r.played, dropped: [], firsts: 0, bestPlace: null, played: r.played, wins: r.wins })
        order.push(Number(r.id))
      }
    }
  } else {
    const results = await trx
      .selectFrom('league_results as r')
      .innerJoin('league_tours as t', 't.id', 'r.tour_id')
      .select(['r.participant_id', 'r.points', 'r.overall_place', 't.number'])
      .where('t.season_id', '=', seasonId)
      .where('t.kind', '=', 'regular')
      .execute()
    const scored = seasonStandings(
      results.map((r) => ({ id: String(r.participant_id), points: r.points, place: r.overall_place, tour: r.number })),
      rules.bestTours ?? null,
    )
    for (const s of scored) stats.set(Number(s.id), { total: s.total, tours: s.tours, dropped: s.dropped, firsts: s.firsts, bestPlace: s.bestPlace, played: s.tours, wins: 0 })
    order = scored.map((s) => Number(s.id))
  }
  const pos = (id: number) => (order.includes(id) ? order.indexOf(id) : 1e6)
  const rows = participants
    .map((p) => {
      const s = stats.get(p.id)
      return {
        participantId: p.id,
        playerId: p.player_id,
        name: playerName(p),
        rating: p.rating,
        divisionId: p.division_id,
        draftDivisionId: p.draft_division_id,
        draftReason: p.draft_reason,
        status: p.status,
        missedTours: p.missed_tours,
        noShows: p.no_shows,
        freezesUsed: p.freezes_used,
        total: s?.total ?? 0,
        tours: s?.tours ?? 0,
        dropped: s?.dropped ?? [],
        firsts: s?.firsts ?? 0,
        bestPlace: s?.bestPlace ?? null,
        wins: s?.wins ?? 0,
        divisionPlace: 0,
        zone: null as Zone,
      }
    })
    .sort((a, b) => pos(a.participantId) - pos(b.participantId) || (b.rating ?? 0) - (a.rating ?? 0))
  if (league.format !== 'common_tour')
    divisions.forEach((d, i) => {
      const list = rows.filter((r) => r.divisionId === d.id && r.status !== 'invited' && r.status !== 'waiting')
      const b = rules.boundaries[i]
      const above = rules.boundaries[i - 1]
      list.forEach((r, j) => {
        r.divisionPlace = j + 1
        if (above && j < above.promote) r.zone = 'up'
        else if (b && j >= list.length - b.relegate) r.zone = 'down'
      })
    })
  return { rows }
}

export async function seasonView(seasonId: number, options: { staff?: boolean } = {}) {
  return db.transaction().execute(async (trx) => {
    const { season, league } = await seasonContext(trx, seasonId)
    const divisions = await divisionsOf(trx, seasonId)
    const table = await seasonTable(trx, seasonId)
    const tours = await trx.selectFrom('league_tours').selectAll().where('season_id', '=', seasonId).orderBy('number').execute()
    const tourIds = tours.length ? tours.map((t) => t.id) : [0]
    const tournaments = tours.length
      ? await trx.selectFrom('tournaments').select(['id', 'slug', 'title', 'status', 'league_tour_id', 'league_division_id', 'starts_at']).where('league_tour_id', 'in', tourIds).execute()
      : []
    const results = await trx.selectFrom('league_results').selectAll().where('tour_id', 'in', tourIds).execute()
    const skips = await trx.selectFrom('league_tour_skips').select(['tour_id', 'participant_id']).where('tour_id', 'in', tourIds).execute()
    const moves = await trx.selectFrom('league_moves').selectAll().where('season_id', '=', seasonId).orderBy('id', 'desc').limit(200).execute()
    const fixtures = await trx.selectFrom('league_fixtures').selectAll().where('season_id', '=', seasonId).orderBy('round').orderBy('id').execute()
    const name = new Map(table.rows.map((r) => [r.participantId, r.name]))
    const rows = options.staff ? table.rows : table.rows.filter((r) => r.status !== 'waiting').map((r) => ({ ...r, draftDivisionId: null, draftReason: null }))
    const tourFormat = league.format === 'divisions' || league.format === 'common_tour'
    const best = [...table.rows]
      .filter((r) => r.tours > 0)
      .sort((a, b) => (tourFormat ? b.total - a.total || (a.bestPlace ?? 1e6) - (b.bestPlace ?? 1e6) : b.wins - a.wins || b.total - a.total))
      .slice(0, 3)
      .map((r) => ({ participantId: r.participantId, playerId: r.playerId, name: r.name, total: r.total, firsts: r.firsts, wins: r.wins }))
    return {
      id: season.id,
      name: season.name,
      status: season.status,
      startsOn: season.starts_on,
      endsOn: season.ends_on,
      rules: rulesOf(season.rules),
      payment: season.payment,
      format: league.format,
      draftPending: season.draft_pending,
      divisions: divisions.map((d) => ({ id: d.id, name: d.name, level: d.level, rows: rows.filter((r) => r.divisionId === d.id) })),
      table: rows,
      best,
      tours: tours.map((t) => ({
        id: t.id,
        number: t.number,
        kind: t.kind,
        startsAt: t.starts_at,
        deadlineAt: t.deadline_at,
        status: t.status,
        tournaments: tournaments.filter((x) => x.league_tour_id === t.id),
        skips: skips.filter((s) => s.tour_id === t.id).map((s) => s.participant_id),
        results: results
          .filter((r) => r.tour_id === t.id)
          .sort((a, b) => (a.overall_place ?? 1e6) - (b.overall_place ?? 1e6))
          .map((r) => ({ participantId: r.participant_id, name: name.get(r.participant_id), divisionId: r.division_id, place: r.place, overallPlace: r.overall_place, points: r.points, missed: r.missed, noShow: r.no_show })),
      })),
      moves: moves.map((m) => ({ participantId: m.participant_id, name: name.get(m.participant_id), from: m.from_division, to: m.to_division, reason: m.reason, tourId: m.tour_id })),
      fixtures: fixtures.map((f) => ({
        id: f.id,
        kind: f.kind,
        divisionId: f.division_id,
        round: f.round,
        status: f.status,
        home: { id: f.home_participant, name: name.get(f.home_participant) },
        away: { id: f.away_participant, name: name.get(f.away_participant) },
        startsAt: f.starts_at,
        tableId: f.table_id,
        setsHome: f.sets_home,
        setsAway: f.sets_away,
        deadlineAt: f.deadline_at,
        proposedBy: f.proposed_by,
        reportedBy: f.reported_by,
        technical: f.technical,
        ratingHome: f.rating_home,
        ratingAway: f.rating_away,
      })),
    }
  })
}

/** League results in the player profile: final division place and table total per season. */
export async function playerLeagueResults(playerId: number) {
  const seasons = await db
    .selectFrom('league_participants as lp')
    .innerJoin('league_seasons as s', 's.id', 'lp.season_id')
    .innerJoin('leagues as l', 'l.id', 's.league_id')
    .select(['lp.season_id', 's.name as season', 's.status', 'l.name as league', 'l.slug'])
    .where('lp.player_id', '=', playerId)
    .where('lp.status', 'in', ['active', 'frozen'])
    .orderBy('s.starts_on', 'desc')
    .limit(20)
    .execute()
  return db.transaction().execute(async (trx) => {
    const out = []
    for (const s of seasons) {
      const { rows } = await seasonTable(trx, s.season_id)
      const row = rows.find((r) => r.playerId === playerId)
      if (!row) continue
      const division = row.divisionId ? await trx.selectFrom('league_divisions').select('name').where('id', '=', row.divisionId).executeTakeFirst() : undefined
      const move = await trx.selectFrom('league_moves').select('reason').where('season_id', '=', s.season_id).where('participant_id', '=', row.participantId).where('tour_id', 'is', null).where('reason', 'in', ['promotion', 'relegation']).executeTakeFirst()
      out.push({ seasonId: s.season_id, season: s.season, status: s.status, league: s.league, slug: s.slug, division: division?.name ?? null, place: row.divisionPlace || rows.indexOf(row) + 1, total: row.total, tours: row.tours, move: move?.reason ?? null })
    }
    return out
  })
}

/** Worker: tour reminders before the start and fixture deadline reminders (one per fixture per day). */
export async function leagueReminders(now = new Date()): Promise<number> {
  let sent = 0
  const tours = await db
    .selectFrom('league_tours as t')
    .innerJoin('league_seasons as s', 's.id', 't.season_id')
    .innerJoin('leagues as l', 'l.id', 's.league_id')
    .select(['t.id', 't.number', 't.starts_at', 't.season_id', 's.rules', 'l.name', 'l.slug'])
    .where('t.status', '=', 'planned')
    .where('t.reminded_at', 'is', null)
    .where('t.starts_at', '>', now)
    .execute()
  for (const t of tours) {
    if (t.starts_at.getTime() - now.getTime() > rulesOf(t.rules).reminderHours * 3600000) continue
    await db.transaction().execute(async (trx) => {
      const users = await trx
        .selectFrom('league_participants as lp')
        .innerJoin('players as p', 'p.id', 'lp.player_id')
        .select('p.user_id')
        .where('lp.season_id', '=', t.season_id)
        .where('lp.status', '=', 'active')
        .where('p.user_id', 'is not', null)
        .execute()
      for (const u of users) await notify({ userId: u.user_id!, type: 'league_reminder', data: { leagueSlug: t.slug, title: t.name, text: `${t.name}: тур ${t.number} скоро` } }, trx)
      await trx.updateTable('league_tours').set({ reminded_at: now }).where('id', '=', t.id).execute()
      sent += users.length
    })
  }
  const fixtures = await db
    .selectFrom('league_fixtures')
    .select(['id', 'home_participant', 'away_participant', 'deadline_at'])
    .where('status', 'in', ['pending', 'proposed'])
    .where('deadline_at', '<', new Date(now.getTime() + 24 * 3600000))
    .where('deadline_at', '>', now)
    .execute()
  for (const f of fixtures) {
    const key = `league_fixture_deadline:${f.id}:${now.toISOString().slice(0, 10)}`
    const fresh = await db.insertInto('notification_dedupe').values({ key }).onConflict((oc) => oc.column('key').doNothing()).returning('key').executeTakeFirst()
    if (!fresh) continue
    const ps = await db.selectFrom('league_participants as lp').innerJoin('players as p', 'p.id', 'lp.player_id').select('p.user_id').where('lp.id', 'in', [f.home_participant, f.away_participant]).execute()
    for (const p of ps) if (p.user_id) await notify({ userId: p.user_id, type: 'league_reminder', data: { fixtureId: f.id, text: 'Завтра дедлайн матча лиги — договоритесь о времени' } })
    sent += ps.length
  }
  const drafts = await db.selectFrom('league_seasons').select('id').where('status', '=', 'registration').where('previous_season_id', 'is not', null).execute()
  for (const s of drafts) await db.transaction().execute((trx) => expireInvitations(trx, s.id, now))
  // Tours that started become running.
  await db.updateTable('league_tours').set({ status: 'running' }).where('status', '=', 'planned').where('starts_at', '<=', now).execute()
  return sent
}

export const leagueListQuery = () =>
  db
    .selectFrom('leagues as l')
    .innerJoin('clubs as c', 'c.id', 'l.club_id')
    .select(['l.id', 'l.slug', 'l.name', 'l.format', 'l.description', 'c.name as club', 'c.slug as club_slug', sql<number | null>`(select s.id from league_seasons s where s.league_id = l.id order by s.starts_on desc limit 1)`.as('season_id')])
