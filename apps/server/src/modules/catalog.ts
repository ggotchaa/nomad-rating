// Cities and the home page (spec 4.10 «Главная»).

import { Router } from 'express'
import { z } from 'zod'
import { DEFAULT_ELO } from '@nomad/engine'
import { ENTRY_OCCUPYING } from '@nomad/shared'
import { db } from '../db/index.ts'
import { handler } from '../http/errors.ts'
import { parseQuery } from '../http/validate.ts'
import { playerName } from './players.ts'

export const catalogRouter = Router()

catalogRouter.get(
  '/cities',
  handler(async (_req, res) => {
    const rows = await db.selectFrom('cities').selectAll().orderBy('sort_order').orderBy('name_ru').execute()
    res.json(rows.map((c) => ({ id: c.id, slug: c.slug, name: { ru: c.name_ru, kk: c.name_kk, en: c.name_en }, region: c.region_ru, timezone: c.timezone })))
  }),
)

catalogRouter.get(
  '/home',
  handler(async (req, res) => {
    const { city } = parseQuery(z.object({ city: z.string().optional() }), req)
    const now = new Date()
    const tournaments = (statuses: ('published' | 'registration_closed' | 'running')[], limit: number) => {
      let q = db
        .selectFrom('tournaments as t')
        .innerJoin('clubs as c', 'c.id', 't.club_id')
        .innerJoin('cities as ci', 'ci.id', 'c.city_id')
        .select([
          't.id',
          't.slug',
          't.title',
          't.starts_at',
          't.fee',
          't.max_participants',
          't.restrictions',
          't.status',
          'c.name as club',
          'ci.name_ru as city',
          (eb) => eb.selectFrom('entries as e').whereRef('e.tournament_id', '=', 't.id').where('e.status', 'in', [...ENTRY_OCCUPYING]).select((x) => x.fn.countAll<number>().as('n')).as('taken'),
        ])
        .where('t.status', 'in', statuses)
        .where('c.status', '=', 'active')
      if (city) q = q.where('ci.slug', '=', city)
      return q.orderBy('t.starts_at').limit(limit).execute()
    }
    let top = db
      .selectFrom('player_ratings as r')
      .innerJoin('players as p', 'p.id', 'r.player_id')
      .leftJoin('cities as ci', 'ci.id', 'p.city_id')
      .select(['p.id', 'p.first_name', 'p.last_name', 'p.photo_url', 'ci.name_ru as city', 'r.rating'])
      .where('r.kind', '=', 'singles')
      .where('r.rating', 'is not', null)
      // Provisional ratings (< 15 matches) do not appear in the home top list.
      .where('r.rated_matches', '>=', DEFAULT_ELO.provisionalMatches)
    if (city) top = top.where('ci.slug', '=', city)
    let clubs = db
      .selectFrom('clubs as c')
      .innerJoin('cities as ci', 'ci.id', 'c.city_id')
      .select(['c.id', 'c.slug', 'c.name', 'c.logo_url', 'ci.name_ru as city'])
      .where('c.status', '=', 'active')
      .where((eb) => eb.exists(eb.selectFrom('halls as h').innerJoin('hall_tables as t', 't.hall_id', 'h.id').whereRef('h.club_id', '=', 'c.id').where('t.bookable', '=', true).select('t.id')))
    if (city) clubs = clubs.where('ci.slug', '=', city)
    const [upcoming, live, topRows, clubRows] = await Promise.all([
      tournaments(['published', 'registration_closed'], 6),
      tournaments(['running'], 6),
      top.orderBy('r.rating', 'desc').limit(10).execute(),
      clubs.orderBy('c.name').limit(12).execute(),
    ])
    const card = (t: (typeof upcoming)[number]) => ({ ...t, startsAt: t.starts_at, taken: Number(t.taken ?? 0) })
    res.json({
      upcoming: upcoming.filter((t) => t.starts_at > new Date(now.getTime() - 3 * 3600000)).map(card),
      live: live.map(card),
      topPlayers: topRows.map((p, i) => ({ rank: i + 1, id: p.id, name: playerName(p), photoUrl: p.photo_url, city: p.city, rating: p.rating })),
      clubsWithBooking: clubRows,
    })
  }),
)
