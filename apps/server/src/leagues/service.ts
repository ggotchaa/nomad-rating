// Leagues (spec 4.12, L-1…L-15, R-29): league → season → divisions → tours. A tour is a normal tournament
// per division (or one common tournament); after all of them finish the tour is applied: points,
// promotion/relegation, missed-tour rules. Season round robin and «свободные даты» use fixtures that
// players schedule themselves (the table is booked through the booking service). Payments: stored only.

import { applyMovements, distributeByRating, divisionSizes, mergeSmallDivisions, playoffSeeds, roundRobinTours, seasonStandings, tourPoints } from '@nomad/engine'
import { assertTransition, bookingStatus, slugify } from '@nomad/shared'
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
  pointsTable: [25, 20, 16, 13, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1],
  participationPoints: 1,
  bestTours: null,
  minDivisionSize: 4,
  playoffSize: 8,
  toursPlanned: 6,
  transferWindow: null,
  confirmBy: null,
  reminderHours: 24,
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
  const divisions = league.format === 'divisions' ? input.divisions : input.divisions.slice(0, 1)
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

/** Adds players (club or self-join). Mid-season newcomers go to the bottom division unless one is given. */
export async function addParticipants(trx: Trx, seasonId: number, playerIds: number[], userId: number | null, options: { divisionId?: number | null } = {}) {
  const { season, league } = await seasonContext(trx, seasonId)
  if (season.status === 'finished') throw conflict('league.season_finished')
  const divisions = await divisionsOf(trx, seasonId)
  const played = await trx.selectFrom('league_tours').select((eb) => eb.fn.max<number>('number').as('n')).where('season_id', '=', seasonId).where('status', '=', 'applied').executeTakeFirst()
  const midSeason = season.status === 'active'
  const divisionId = options.divisionId ?? (midSeason || league.format !== 'divisions' ? divisions.at(league.format === 'divisions' ? -1 : 0)!.id : null)
  const warnings = await seasonConflicts(trx, seasonId, playerIds)
  for (const playerId of playerIds) {
    await trx
      .insertInto('league_participants')
      .values({ season_id: seasonId, player_id: playerId, division_id: divisionId, status: 'active', joined_tour: (played?.n ?? 0) + 1 })
      .onConflict((oc) => oc.columns(['season_id', 'player_id']).doUpdateSet({ status: 'active' }))
      .execute()
  }
  await audit({ actorUserId: userId, clubId: league.club_id, entity: 'league_season', entityId: seasonId, action: 'add_participants', after: { playerIds, divisionId } }, trx)
  return { added: playerIds.length, warnings }
}

/** L-3: by rating (current singles rating, start level while calibrating) or a manual draft. */
export async function distribute(trx: Trx, seasonId: number, userId: number | null, manual?: { participantId: number; divisionId: number }[]) {
  const { league } = await seasonContext(trx, seasonId)
  const divisions = await divisionsOf(trx, seasonId)
  if (manual?.length) {
    for (const m of manual) {
      if (!divisions.some((d) => d.id === m.divisionId)) throw badRequest('league.division_not_in_season')
      await trx.updateTable('league_participants').set({ division_id: m.divisionId }).where('id', '=', m.participantId).where('season_id', '=', seasonId).execute()
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
    for (const [i, ids] of groups.entries()) if (ids.length) await trx.updateTable('league_participants').set({ division_id: divisions[i]!.id }).where('id', 'in', ids.map(Number)).execute()
  }
  await audit({ actorUserId: userId, clubId: league.club_id, entity: 'league_season', entityId: seasonId, action: 'distribute', after: { manual: manual ?? 'rating' } }, trx)
}

export async function setSeasonStatus(trx: Trx, seasonId: number, status: 'registration' | 'active' | 'finished', userId: number | null) {
  const { season, league } = await seasonContext(trx, seasonId)
  const order = ['draft', 'registration', 'active', 'finished']
  if (order.indexOf(status) <= order.indexOf(season.status)) throw conflict('league.bad_status', { from: season.status, to: status })
  if (status === 'active') {
    const missing = await trx.selectFrom('league_participants').select('id').where('season_id', '=', seasonId).where('status', '=', 'active').where('division_id', 'is', null).executeTakeFirst()
    if (missing) await distribute(trx, seasonId, userId)
    await trx.updateTable('league_participants').set({ status: 'declined' }).where('season_id', '=', seasonId).where('status', '=', 'invited').execute()
  }
  await trx.updateTable('league_seasons').set({ status }).where('id', '=', seasonId).execute()
  await audit({ actorUserId: userId, clubId: league.club_id, entity: 'league_season', entityId: seasonId, action: 'status', before: { status: season.status }, after: { status } }, trx)
}

/** Creates the tour: one tournament per division (or one common), published, with participants registered by the club. */
export async function createTour(trx: Trx, seasonId: number, userId: number | null, input: { startsAt: string; deadlineAt?: string | null; hallId: number; playoff?: boolean }) {
  const { season, league } = await seasonContext(trx, seasonId)
  if (season.status !== 'active') throw conflict('league.season_not_active')
  if (league.format === 'season_rr' || league.format === 'free_dates') throw conflict('league.format_uses_fixtures')
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
  const ids = playoffSeeds(table.rows.map((r) => ({ id: String(r.participantId), total: r.total, tours: r.tours, counted: [], dropped: [] })), rulesOf(season.rules).playoffSize)
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
  const participants = await trx.selectFrom('league_participants').selectAll().where('season_id', '=', season.id).where('status', 'in', ['active', 'frozen']).execute()
  const divisions = await divisionsOf(trx, season.id)
  const placeOf = new Map(places.map((p) => [p.player_id, p.final_place!]))
  const missed = new Set<string>()
  for (const p of participants) {
    const place = placeOf.get(p.player_id) ?? null
    const isMissed = place == null && p.status === 'active'
    if (isMissed) missed.add(String(p.id))
    await trx
      .insertInto('league_results')
      .values({ tour_id: tourId, participant_id: p.id, division_id: p.division_id, place, points: place == null ? 0 : tourPoints(place, rules.pointsTable, rules.participationPoints), missed: isMissed })
      .execute()
    if (isMissed) await trx.updateTable('league_participants').set({ missed_tours: p.missed_tours + 1 }).where('id', '=', p.id).execute()
  }
  const moves: { participantId: number; from: number; to: number; reason: string }[] = []
  if (league.format === 'divisions' && tour.kind === 'regular' && divisions.length > 1) {
    const ordered = divisions.map((d) =>
      participants
        .filter((p) => p.division_id === d.id)
        .sort((a, b) => (placeOf.get(a.player_id) ?? 1e6) - (placeOf.get(b.player_id) ?? 1e6))
        .map((p) => String(p.id)),
    )
    const frozen = new Set(participants.filter((p) => p.status === 'frozen').map((p) => String(p.id)))
    const result = applyMovements(ordered, rules.boundaries, { missed, missedRule: rules.missedRule, frozen })
    for (const m of result.moves) {
      const from = divisions[m.from]!.id
      const to = divisions[m.to]!.id
      await trx.updateTable('league_participants').set({ division_id: to }).where('id', '=', Number(m.id)).execute()
      await trx.insertInto('league_moves').values({ season_id: season.id, tour_id: tourId, participant_id: Number(m.id), from_division: from, to_division: to, reason: m.reason }).execute()
      moves.push({ participantId: Number(m.id), from, to, reason: m.reason })
      const p = participants.find((x) => x.id === Number(m.id))!
      const user = await trx.selectFrom('players').select('user_id').where('id', '=', p.player_id).executeTakeFirst()
      if (user?.user_id)
        await notify({ userId: user.user_id, type: 'league_move', data: { leagueSlug: league.slug, title: league.name, text: `${league.name}: ${m.reason === 'promotion' ? 'повышение' : 'понижение'} — ${divisions[m.to]!.name}` } }, trx)
    }
  }
  await trx.updateTable('league_tours').set({ status: 'applied' }).where('id', '=', tourId).execute()
  await audit({ actorUserId: userId, clubId: league.club_id, entity: 'league_tour', entityId: tourId, action: 'apply', after: { moves: moves.length, missed: missed.size } }, trx)
  return { moves, missed: missed.size }
}

export async function setFrozen(trx: Trx, participantId: number, frozen: boolean, userId: number | null) {
  const p = await trx.selectFrom('league_participants').selectAll().where('id', '=', participantId).executeTakeFirst()
  if (!p) throw notFound('league.participant_not_found')
  if (!['active', 'frozen'].includes(p.status)) throw conflict('league.participant_inactive')
  await trx.updateTable('league_participants').set({ status: frozen ? 'frozen' : 'active' }).where('id', '=', participantId).execute()
  await audit({ actorUserId: userId, entity: 'league_participant', entityId: participantId, action: frozen ? 'freeze' : 'unfreeze' }, trx)
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

/** L-5: next season draft — divisions copied, participants invited into their final division; they confirm. */
export async function nextSeason(trx: Trx, seasonId: number, userId: number | null, input: { name: string; startsOn: string; endsOn: string }) {
  const { season, league } = await seasonContext(trx, seasonId)
  const divisions = await divisionsOf(trx, seasonId)
  const next = await createSeason(trx, league.id, userId, { ...input, divisions: divisions.map((d) => d.name), rules: season.rules, payment: season.payment, previousSeasonId: seasonId, status: 'registration' })
  const nextDivisions = await divisionsOf(trx, next.id)
  const participants = await trx.selectFrom('league_participants').selectAll().where('season_id', '=', seasonId).where('status', 'in', ['active', 'frozen']).execute()
  for (const p of participants) {
    const level = divisions.find((d) => d.id === p.division_id)?.level ?? divisions.length
    await trx.insertInto('league_participants').values({ season_id: next.id, player_id: p.player_id, division_id: nextDivisions.find((d) => d.level === level)?.id ?? null, status: 'invited' }).execute()
    const user = await trx.selectFrom('players').select('user_id').where('id', '=', p.player_id).executeTakeFirst()
    if (user?.user_id) await notify({ userId: user.user_id, type: 'league_confirm', data: { leagueSlug: league.slug, seasonId: next.id, title: league.name, text: `${league.name}: подтвердите участие в сезоне «${input.name}»` } }, trx)
  }
  return next
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
  await trx.deleteFrom('league_fixtures').where('season_id', '=', seasonId).where('status', '=', 'pending').execute()
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
  await tell(trx, other.player_id, { fixtureId: f.id, text: `Соперник предлагает время матча: ${new Date(input.startsAt).toISOString().slice(0, 16).replace('T', ' ')} UTC` })
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
  await tell(trx, other.player_id, { fixtureId: f.id, text: `Матч подтверждён, стол ${booking.tableNumber} забронирован` })
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
  await tell(trx, other.player_id, { fixtureId: f.id, text: 'Соперник внёс счёт матча — подтвердите' })
  return { status: 'reported' }
}

export async function confirmFixtureResult(trx: Trx, fixtureId: number, playerId: number, accept: boolean) {
  const { f, mine } = await fixtureForPlayer(trx, fixtureId, playerId)
  if (f.status !== 'reported') throw conflict('league.fixture_not_reported')
  if (f.reported_by === mine) throw conflict('league.confirm_by_opponent')
  await trx
    .updateTable('league_fixtures')
    .set(accept ? { status: 'confirmed' } : { status: f.booking_id ? 'scheduled' : 'pending', sets_home: null, sets_away: null, reported_by: null })
    .where('id', '=', f.id)
    .execute()
  return { status: accept ? 'confirmed' : 'disputed' }
}

// ---------------------------------------------------------------------------
// Tables and the public page

/** Season table: tour points with N best tours, or fixture points (win 2 / loss 1) for round robin formats. */
export async function seasonTable(trx: Trx, seasonId: number) {
  const { season, league } = await seasonContext(trx, seasonId)
  const participants = await trx
    .selectFrom('league_participants as lp')
    .innerJoin('players as p', 'p.id', 'lp.player_id')
    .leftJoin('player_ratings as r', (j) => j.onRef('r.player_id', '=', 'p.id').on('r.kind', '=', 'singles'))
    .select(['lp.id', 'lp.player_id', 'lp.division_id', 'lp.status', 'lp.missed_tours', 'p.first_name', 'p.last_name', 'r.rating'])
    .where('lp.season_id', '=', seasonId)
    .where('lp.status', 'in', ['active', 'frozen', 'invited'])
    .execute()
  let scored: { id: string; total: number; tours: number; counted: number[]; dropped: number[] }[]
  if (league.format === 'season_rr' || league.format === 'free_dates') {
    const fixtures = await trx.selectFrom('league_fixtures').selectAll().where('season_id', '=', seasonId).where('status', '=', 'confirmed').execute()
    const results = fixtures.flatMap((f) => {
      const homeWon = (f.sets_home ?? 0) > (f.sets_away ?? 0)
      return [
        { id: String(f.home_participant), points: homeWon ? 2 : 1 },
        { id: String(f.away_participant), points: homeWon ? 1 : 2 },
      ]
    })
    scored = seasonStandings(results)
  } else {
    const results = await trx
      .selectFrom('league_results as r')
      .innerJoin('league_tours as t', 't.id', 'r.tour_id')
      .select(['r.participant_id', 'r.points'])
      .where('t.season_id', '=', seasonId)
      .where('t.kind', '=', 'regular')
      .execute()
    scored = seasonStandings(results.map((r) => ({ id: String(r.participant_id), points: r.points })), rulesOf(season.rules).bestTours ?? null)
  }
  const byId = new Map(scored.map((s) => [Number(s.id), s]))
  const rows = participants
    .map((p) => {
      const s = byId.get(p.id)
      return { participantId: p.id, playerId: p.player_id, name: playerName(p), rating: p.rating, divisionId: p.division_id, status: p.status, missedTours: p.missed_tours, total: s?.total ?? 0, tours: s?.tours ?? 0, dropped: s?.dropped ?? [] }
    })
    .sort((a, b) => b.total - a.total || b.tours - a.tours || (b.rating ?? 0) - (a.rating ?? 0))
  return { rows }
}

export async function seasonView(seasonId: number) {
  return db.transaction().execute(async (trx) => {
    const { season, league } = await seasonContext(trx, seasonId)
    const divisions = await divisionsOf(trx, seasonId)
    const table = await seasonTable(trx, seasonId)
    const tours = await trx.selectFrom('league_tours').selectAll().where('season_id', '=', seasonId).orderBy('number').execute()
    const tournaments = tours.length
      ? await trx.selectFrom('tournaments').select(['id', 'slug', 'title', 'status', 'league_tour_id', 'league_division_id', 'starts_at']).where('league_tour_id', 'in', tours.map((t) => t.id)).execute()
      : []
    const moves = await trx.selectFrom('league_moves').selectAll().where('season_id', '=', seasonId).orderBy('id', 'desc').limit(200).execute()
    const fixtures = await trx.selectFrom('league_fixtures').selectAll().where('season_id', '=', seasonId).orderBy('round').orderBy('id').execute()
    const name = new Map(table.rows.map((r) => [r.participantId, r.name]))
    return {
      id: season.id,
      name: season.name,
      status: season.status,
      startsOn: season.starts_on,
      endsOn: season.ends_on,
      rules: rulesOf(season.rules),
      payment: season.payment,
      format: league.format,
      divisions: divisions.map((d) => ({ id: d.id, name: d.name, level: d.level, rows: table.rows.filter((r) => r.divisionId === d.id) })),
      table: table.rows,
      tours: tours.map((t) => ({ id: t.id, number: t.number, kind: t.kind, startsAt: t.starts_at, deadlineAt: t.deadline_at, status: t.status, tournaments: tournaments.filter((x) => x.league_tour_id === t.id) })),
      moves: moves.map((m) => ({ participantId: m.participant_id, name: name.get(m.participant_id), from: m.from_division, to: m.to_division, reason: m.reason, tourId: m.tour_id })),
      fixtures: fixtures.map((f) => ({ id: f.id, divisionId: f.division_id, round: f.round, status: f.status, home: { id: f.home_participant, name: name.get(f.home_participant) }, away: { id: f.away_participant, name: name.get(f.away_participant) }, startsAt: f.starts_at, tableId: f.table_id, setsHome: f.sets_home, setsAway: f.sets_away, deadlineAt: f.deadline_at, proposedBy: f.proposed_by, reportedBy: f.reported_by })),
    }
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
  // Tours that started become running.
  await db.updateTable('league_tours').set({ status: 'running' }).where('status', '=', 'planned').where('starts_at', '<=', now).execute()
  return sent
}

export const leagueListQuery = () =>
  db
    .selectFrom('leagues as l')
    .innerJoin('clubs as c', 'c.id', 'l.club_id')
    .select(['l.id', 'l.slug', 'l.name', 'l.format', 'l.description', 'c.name as club', 'c.slug as club_slug', sql<number | null>`(select s.id from league_seasons s where s.league_id = l.id order by s.starts_on desc limit 1)`.as('season_id')])
