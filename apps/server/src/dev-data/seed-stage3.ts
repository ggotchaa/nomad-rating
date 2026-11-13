// Stage 3 dev data: chronological rating replay, inbox notifications, subscriptions and an open dispute.

import { sql } from 'kysely'
import { db, json } from '../db/index.ts'
import { recalculateFrom } from '../rating/service.ts'

export async function seedStage3(log: (s: string) => void): Promise<void> {
  // The seed closes tournaments in creation order, not by finish time; replay puts history in canonical order.
  const first = await db.selectFrom('tournaments').select('id').where('status', 'in', ['finished', 'finished_early']).orderBy(sql`coalesce(finished_at, starts_at)`).orderBy('id').executeTakeFirst()
  if (first) await db.transaction().execute((trx) => recalculateFrom(trx, first.id))

  const player = await db
    .selectFrom('users as u')
    .innerJoin('players as p', 'p.user_id', 'u.id')
    .select(['u.id as user_id', 'p.id as player_id', 'p.city_id'])
    .where('u.email', '=', 'player@dev.nomad.test')
    .executeTakeFirst()
  if (!player) return
  const last = await db
    .selectFrom('rating_snapshots as s')
    .innerJoin('tournaments as t', 't.id', 's.tournament_id')
    .select(['t.id', 't.slug', 't.title', 't.club_id', 's.place', 's.delta', 's.rating_after', 's.at'])
    .where('s.player_id', '=', player.player_id)
    .orderBy('s.at', 'desc')
    .executeTakeFirst()
  const upcoming = await db.selectFrom('tournaments').select(['id', 'slug', 'title']).where('status', '=', 'published').orderBy('starts_at').executeTakeFirst()
  const hour = 3600_000
  const rows = [
    last && { type: 'tournament_results', data: { tournamentId: last.id, slug: last.slug, title: last.title, place: last.place, delta: last.delta, rating: last.rating_after }, at: new Date(Date.now() - 20 * hour), read: true },
    upcoming && { type: 'new_tournament', data: { tournamentId: upcoming.id, slug: upcoming.slug, title: upcoming.title, club: 'Smash Arena', startsAtText: 'в эти выходные' }, at: new Date(Date.now() - 3 * hour), read: false },
    upcoming && { type: 'tournament_reminder', data: { tournamentId: upcoming.id, slug: upcoming.slug, title: upcoming.title, hours: 24, startsAtText: 'завтра' }, at: new Date(Date.now() - hour), read: false },
  ].filter((r): r is NonNullable<typeof r> => Boolean(r))
  if (rows.length)
    await db
      .insertInto('notifications')
      .values(rows.map((r) => ({ user_id: player.user_id, type: r.type, data: json(r.data), created_at: r.at, read_at: r.read ? r.at : null })))
      .execute()

  if (last) {
    await db.insertInto('subscriptions').values([{ user_id: player.user_id, kind: 'club', club_id: last.club_id }, { user_id: player.user_id, kind: 'rating', club_id: null }]).execute()
    const match = await db
      .selectFrom('matches as m')
      .innerJoin('entries as e', 'e.id', 'm.home_entry_id')
      .select('m.id')
      .where('m.tournament_id', '=', last.id)
      .where('e.player_id', '=', player.player_id)
      .where('m.status', '=', 'finished')
      .executeTakeFirst()
    if (match)
      await db
        .insertInto('disputes')
        .values({ entity: 'match', entity_id: String(match.id), tournament_id: last.id, club_id: last.club_id, user_id: player.user_id, reason: 'Во второй партии было 11:9 в мою пользу, а записано 9:11.' })
        .execute()
  }
  log(`stage 3: ratings replayed chronologically, ${rows.length} notifications, 1 dispute`)
}
