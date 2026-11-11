// Players: rating list (S-6), public profile (S-1), rating graph (S-2), history (S-3),
// best matches (S-4), head-to-head (S-5), search for clubs and invitations.

import { Router } from 'express'
import { sql } from 'kysely'
import { z } from 'zod'
import { DEFAULT_ELO, isProvisional } from '@nomad/engine'
import { searchWords } from '@nomad/shared'
import { db } from '../db/index.ts'
import { handler, notFound } from '../http/errors.ts'
import { intParam, pageQuery, parseQuery } from '../http/validate.ts'

export const playersRouter = Router()

const INACTIVE_MONTHS = 12

const listQuery = z.object({
  kind: z.enum(['singles', 'doubles']).default('singles'),
  city: z.string().optional(),
  gender: z.enum(['m', 'f']).optional(),
  ageMin: z.coerce.number().int().optional(),
  ageMax: z.coerce.number().int().optional(),
  q: z.string().trim().max(100).optional(),
  inactive: z.enum(['true', 'false']).default('false'),
  ...pageQuery,
})

export const playerName = (p: { first_name: string; last_name: string }) => `${p.last_name} ${p.first_name}`

/** Rating list: everyone with a rating; filters by city, gender, age and name; rank inside the filter. */
playersRouter.get(
  '/',
  handler(async (req, res) => {
    const q = parseQuery(listQuery, req)
    const year = new Date().getFullYear()
    const monthAgo = new Date(Date.now() - 30 * 86400000)
    let base = db
      .selectFrom('player_ratings as r')
      .innerJoin('players as p', 'p.id', 'r.player_id')
      .leftJoin('cities as c', 'c.id', 'p.city_id')
      .where('r.kind', '=', q.kind)
      .where('r.rating', 'is not', null)
    if (q.city) base = base.where('c.slug', '=', q.city)
    if (q.gender) base = base.where('p.gender', '=', q.gender)
    if (q.ageMin != null) base = base.where('p.birth_year', '<=', year - q.ageMin)
    if (q.ageMax != null) base = base.where('p.birth_year', '>=', year - q.ageMax)
    if (q.inactive !== 'true') base = base.where('r.last_rated_at', '>', new Date(Date.now() - INACTIVE_MONTHS * 30 * 86400000))
    const ranked = base.select([
      'p.id',
      'p.first_name',
      'p.last_name',
      'p.gender',
      'p.birth_year',
      'p.photo_url',
      'c.name_ru as city',
      'c.slug as city_slug',
      'r.rating',
      'r.rated_matches',
      'r.matches',
      'r.wins',
      'p.search_name',
      sql<number>`rank() over (order by r.rating desc)`.as('rank'),
      sql<number | null>`(select s.rating_after from rating_snapshots s where s.player_id = p.id and s.kind = r.kind and s.at <= ${monthAgo} order by s.at desc limit 1)`.as(
        'rating_30d_ago',
      ),
    ])
    let outer = db.selectFrom(ranked.as('x')).selectAll()
    for (const word of searchWords(q.q ?? '')) outer = outer.where('x.search_name', 'like', `%${word}%`)
    const [rows, total] = await Promise.all([
      outer.orderBy('x.rank').orderBy('x.last_name').limit(q.limit).offset(q.offset).execute(),
      outer.clearSelect().select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirstOrThrow(),
    ])
    res.json({
      total: Number(total.n),
      items: rows.map((r) => ({
        rank: Number(r.rank),
        id: r.id,
        name: playerName(r),
        gender: r.gender,
        birthYear: r.birth_year,
        photoUrl: r.photo_url,
        city: r.city,
        rating: r.rating,
        provisional: isProvisional({ ratedMatches: r.rated_matches }),
        change30d: r.rating_30d_ago == null ? null : (r.rating ?? 0) - r.rating_30d_ago,
        matches: r.matches,
        winRate: r.matches ? Math.round((r.wins / r.matches) * 100) : null,
      })),
    })
  }),
)

/** Name search for clubs (phone bookings, adding players) and captains: region and birth year shown (D-5). */
playersRouter.get(
  '/search',
  handler(async (req, res) => {
    const { q } = parseQuery(z.object({ q: z.string().trim().min(2).max(100) }), req)
    let query = db
      .selectFrom('players as p')
      .leftJoin('cities as c', 'c.id', 'p.city_id')
      .leftJoin('player_ratings as r', (j) => j.onRef('r.player_id', '=', 'p.id').on('r.kind', '=', 'singles'))
      .select(['p.id', 'p.first_name', 'p.last_name', 'p.birth_year', 'p.photo_url', 'c.name_ru as city', 'r.rating', 'p.start_level'])
    for (const word of searchWords(q)) query = query.where('p.search_name', 'like', `%${word}%`)
    const rows = await query.orderBy('p.last_name').limit(20).execute()
    res.json(rows.map((r) => ({ id: r.id, name: playerName(r), birthYear: r.birth_year, city: r.city, rating: r.rating, startLevel: r.start_level, photoUrl: r.photo_url })))
  }),
)

playersRouter.get(
  '/:id',
  handler(async (req, res) => {
    const id = intParam(req, 'id')
    const p = await db
      .selectFrom('players as p')
      .leftJoin('cities as c', 'c.id', 'p.city_id')
      .select(['p.id', 'p.first_name', 'p.last_name', 'p.gender', 'p.birth_year', 'p.hand', 'p.photo_url', 'p.start_level', 'p.added_by_club_id', 'p.user_id', 'c.name_ru as city', 'c.slug as city_slug', 'p.city_id'])
      .where('p.id', '=', id)
      .executeTakeFirst()
    if (!p) throw notFound('player.not_found')
    const ratings = await db.selectFrom('player_ratings').selectAll().where('player_id', '=', id).execute()
    const ratingView = await Promise.all(
      ratings.map(async (r) => {
        let placeOverall: number | null = null
        let placeCity: number | null = null
        if (r.rating != null) {
          const better = await db
            .selectFrom('player_ratings as x')
            .innerJoin('players as y', 'y.id', 'x.player_id')
            .select([
              sql<number>`count(*)`.as('overall'),
              sql<number>`count(*) filter (where y.city_id = ${p.city_id})`.as('city'),
            ])
            .where('x.kind', '=', r.kind)
            .where('x.rating', '>', r.rating)
            .executeTakeFirstOrThrow()
          placeOverall = Number(better.overall) + 1
          placeCity = Number(better.city) + 1
        }
        return {
          kind: r.kind,
          rating: r.rating,
          source: r.source,
          provisional: isProvisional({ ratedMatches: r.rated_matches }),
          maxRating: r.max_rating,
          tournaments: r.tournaments,
          matches: r.matches,
          wins: r.wins,
          winRate: r.matches ? Math.round((r.wins / r.matches) * 100) : null,
          placeOverall,
          placeCity,
          calibration:
            r.rating == null
              ? { played: r.calibration.tournaments ?? 0, of: DEFAULT_ELO.calibrationTournaments, startLevel: p.start_level }
              : null,
        }
      }),
    )
    res.json({
      id: p.id,
      name: playerName(p),
      firstName: p.first_name,
      lastName: p.last_name,
      gender: p.gender,
      birthYear: p.birth_year,
      hand: p.hand,
      photoUrl: p.photo_url,
      city: p.city,
      citySlug: p.city_slug,
      addedByClub: p.added_by_club_id != null && p.user_id == null,
      ratings: ratingView,
    })
  }),
)

playersRouter.get(
  '/:id/rating-history',
  handler(async (req, res) => {
    const id = intParam(req, 'id')
    const { kind, period } = parseQuery(
      z.object({ kind: z.enum(['singles', 'doubles']).default('singles'), period: z.enum(['3m', '1y', 'all']).default('1y') }),
      req,
    )
    const since = period === 'all' ? new Date(0) : new Date(Date.now() - (period === '3m' ? 92 : 366) * 86400000)
    const rows = await db
      .selectFrom('rating_snapshots as s')
      .innerJoin('tournaments as t', 't.id', 's.tournament_id')
      .select(['s.tournament_id', 't.title', 't.slug', 's.at', 's.rating_before', 's.rating_after', 's.delta', 's.place', 's.calibrated'])
      .where('s.player_id', '=', id)
      .where('s.kind', '=', kind)
      .where('s.at', '>=', since)
      .where('s.rating_after', 'is not', null)
      .orderBy('s.at')
      .execute()
    res.json(rows.map((r) => ({ tournamentId: r.tournament_id, title: r.title, slug: r.slug, date: r.at, rating: r.rating_after, delta: r.delta, place: r.place, calibrated: r.calibrated })))
  }),
)

playersRouter.get(
  '/:id/tournaments',
  handler(async (req, res) => {
    const id = intParam(req, 'id')
    const rows = await db
      .selectFrom('entries as e')
      .innerJoin('tournaments as t', 't.id', 'e.tournament_id')
      .innerJoin('clubs as c', 'c.id', 't.club_id')
      .leftJoin('rating_snapshots as s', (j) => j.onRef('s.tournament_id', '=', 't.id').onRef('s.player_id', '=', 'e.player_id').on('s.kind', '=', 'singles'))
      .select(['t.id', 't.slug', 't.title', 't.starts_at', 'c.name as club', 'e.final_place', 'e.final_place_to', 's.matches', 's.wins', 's.delta', 's.rating_after', 'e.id as entry_id'])
      .where('e.player_id', '=', id)
      .where('t.status', 'in', ['finished', 'finished_early'])
      .orderBy('t.starts_at', 'desc')
      .execute()
    res.json(
      rows.map((r) => ({
        tournamentId: r.id,
        slug: r.slug,
        title: r.title,
        date: r.starts_at,
        club: r.club,
        place: r.final_place,
        placeTo: r.final_place_to,
        wins: r.wins ?? 0,
        losses: (r.matches ?? 0) - (r.wins ?? 0),
        delta: r.delta ?? 0,
        ratingAfter: r.rating_after,
      })),
    )
  }),
)

/** Matches of a player, optionally in one tournament or against one opponent. */
async function playerMatches(playerId: number, filter: { tournamentId?: number; opponentId?: number }) {
  let q = db
    .selectFrom('matches as m')
    .innerJoin('entries as he', 'he.id', 'm.home_entry_id')
    .innerJoin('entries as ae', 'ae.id', 'm.away_entry_id')
    .innerJoin('players as hp', 'hp.id', 'he.player_id')
    .innerJoin('players as ap', 'ap.id', 'ae.player_id')
    .innerJoin('tournaments as t', 't.id', 'm.tournament_id')
    .innerJoin('stages as st', 'st.id', 'm.stage_id')
    .leftJoin('rating_events as re', (j) => j.onRef('re.match_id', '=', 'm.id').on('re.player_id', '=', playerId))
    .select([
      'm.id',
      'm.number',
      'm.stage_label',
      'st.name as stage_name',
      'm.sets_home',
      'm.sets_away',
      'm.games',
      'm.result_type',
      'm.finished_at',
      'm.winner_entry_id',
      'he.id as home_entry',
      'hp.id as home_id',
      'hp.first_name as home_first',
      'hp.last_name as home_last',
      'ap.id as away_id',
      'ap.first_name as away_first',
      'ap.last_name as away_last',
      'he.rating_at_start as home_rating',
      'ae.rating_at_start as away_rating',
      't.id as tournament_id',
      't.title',
      't.slug',
      't.starts_at',
      're.delta',
    ])
    .where('m.status', 'in', ['finished', 'retired', 'walkover'])
    .where('m.result_type', '<>', 'bye')
    .where((eb) => eb.or([eb('hp.id', '=', playerId), eb('ap.id', '=', playerId)]))
  if (filter.tournamentId) q = q.where('m.tournament_id', '=', filter.tournamentId)
  if (filter.opponentId) q = q.where((eb) => eb.or([eb('hp.id', '=', filter.opponentId!), eb('ap.id', '=', filter.opponentId!)]))
  const rows = await q.orderBy('t.starts_at', 'desc').orderBy('m.number').execute()
  return rows.map((r) => {
    const isHome = r.home_id === playerId
    const won = (r.winner_entry_id === r.home_entry) === isHome
    const games = r.games.map((g) => (isHome ? g : { home: g.away, away: g.home }))
    return {
      matchId: r.id,
      number: r.number,
      tournament: { id: r.tournament_id, title: r.title, slug: r.slug, date: r.starts_at },
      stage: r.stage_name,
      round: r.stage_label,
      opponent: isHome
        ? { id: r.away_id, name: `${r.away_last} ${r.away_first}`, rating: r.away_rating }
        : { id: r.home_id, name: `${r.home_last} ${r.home_first}`, rating: r.home_rating },
      won,
      score: isHome ? `${r.sets_home}:${r.sets_away}` : `${r.sets_away}:${r.sets_home}`,
      games,
      resultType: r.result_type,
      ratingDelta: r.delta == null ? null : Math.round(r.delta * 10) / 10,
    }
  })
}

playersRouter.get(
  '/:id/tournaments/:tournamentId/matches',
  handler(async (req, res) => {
    res.json(await playerMatches(intParam(req, 'id'), { tournamentId: intParam(req, 'tournamentId') }))
  }),
)

/** Top-5 wins by rating gain: wins over the strongest opponents relative to the player (S-4). */
playersRouter.get(
  '/:id/best-matches',
  handler(async (req, res) => {
    const id = intParam(req, 'id')
    const best = await db
      .selectFrom('rating_events')
      .select('match_id')
      .where('player_id', '=', id)
      .where('score', '=', 1)
      .orderBy('delta', 'desc')
      .limit(5)
      .execute()
    const all = await playerMatches(id, {})
    const order = best.map((b) => b.match_id)
    res.json(order.map((mid) => all.find((m) => m.matchId === mid)).filter(Boolean))
  }),
)

playersRouter.get(
  '/:id/h2h/:otherId',
  handler(async (req, res) => {
    const id = intParam(req, 'id')
    const other = intParam(req, 'otherId')
    const matches = await playerMatches(id, { opponentId: other })
    res.json({ wins: matches.filter((m) => m.won).length, losses: matches.filter((m) => !m.won).length, matches })
  }),
)
