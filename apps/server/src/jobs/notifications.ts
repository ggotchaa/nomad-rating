// Scheduled notifications (worker, every few minutes): reminders 24 h / 2 h, results after finish,
// new tournaments for club subscribers (C-9) and for «tournaments for my rating» subscribers.

import { db } from '../db/index.ts'
import { notify } from '../notify/index.ts'

const HOUR = 3600_000
const WINDOW = 15 * 60_000

async function once(key: string): Promise<boolean> {
  const row = await db.insertInto('notification_dedupe').values({ key }).onConflict((oc) => oc.column('key').doNothing()).returning('key').executeTakeFirst()
  return Boolean(row)
}

const when = (d: Date) => d.toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Almaty' })

export async function runScheduledNotifications(now = new Date()): Promise<{ sent: number }> {
  let sent = 0

  for (const hours of [24, 2]) {
    const rows = await db
      .selectFrom('tournaments as t')
      .innerJoin('entries as e', 'e.tournament_id', 't.id')
      .innerJoin('players as p', 'p.id', 'e.player_id')
      .select(['t.id', 't.slug', 't.title', 't.starts_at', 'p.user_id'])
      .where('t.status', 'in', ['published', 'registration_closed'])
      .where('t.starts_at', '>', new Date(now.getTime() + hours * HOUR - WINDOW))
      .where('t.starts_at', '<=', new Date(now.getTime() + hours * HOUR))
      .where('e.status', 'in', ['paid', 'checked_in', 'awaiting_payment'])
      .where('p.user_id', 'is not', null)
      .execute()
    for (const r of rows) {
      if (!(await once(`reminder:${r.id}:${hours}:${r.user_id}`))) continue
      await notify({ userId: r.user_id!, type: 'tournament_reminder', data: { tournamentId: r.id, slug: r.slug, title: r.title, hours, startsAtText: when(r.starts_at) } })
      sent++
    }
  }

  const finished = await db
    .selectFrom('tournaments as t')
    .innerJoin('entries as e', 'e.tournament_id', 't.id')
    .innerJoin('players as p', 'p.id', 'e.player_id')
    .leftJoin('rating_snapshots as s', (j) => j.onRef('s.tournament_id', '=', 't.id').onRef('s.player_id', '=', 'p.id').on('s.kind', '=', 'singles'))
    .select(['t.id', 't.slug', 't.title', 'e.final_place', 'p.user_id', 's.delta', 's.rating_after'])
    .where('t.status', 'in', ['finished', 'finished_early'])
    .where('t.finished_at', '>', new Date(now.getTime() - 48 * HOUR))
    .where('p.user_id', 'is not', null)
    .execute()
  for (const r of finished) {
    if (!(await once(`results:${r.id}:${r.user_id}`))) continue
    await notify({ userId: r.user_id!, type: 'tournament_results', data: { tournamentId: r.id, slug: r.slug, title: r.title, place: r.final_place, delta: r.delta, rating: r.rating_after } })
    sent++
  }

  const fresh = await db
    .selectFrom('tournaments as t')
    .innerJoin('clubs as c', 'c.id', 't.club_id')
    .select(['t.id', 't.slug', 't.title', 't.club_id', 't.starts_at', 't.restrictions', 'c.name as club', 'c.city_id'])
    .where('t.status', '=', 'published')
    .where('t.published_at', '>', new Date(now.getTime() - 24 * HOUR))
    .execute()
  for (const t of fresh) {
    const subscribers = await db
      .selectFrom('subscriptions as s')
      .leftJoin('players as p', 'p.user_id', 's.user_id')
      .leftJoin('player_ratings as r', (j) => j.onRef('r.player_id', '=', 'p.id').on('r.kind', '=', 'singles'))
      .select(['s.user_id', 's.kind', 's.club_id', 'p.gender', 'p.city_id', 'r.rating'])
      .where((eb) => eb.or([eb.and([eb('s.kind', '=', 'club'), eb('s.club_id', '=', t.club_id)]), eb('s.kind', '=', 'rating')]))
      .execute()
    const rs = t.restrictions
    for (const s of subscribers) {
      if (s.kind === 'rating') {
        if (s.city_id !== t.city_id || s.rating == null) continue
        if ((rs.ratingMin != null && s.rating < rs.ratingMin) || (rs.ratingMax != null && s.rating > rs.ratingMax)) continue
        if (rs.gender && s.gender !== rs.gender) continue
      }
      if (!(await once(`new:${t.id}:${s.user_id}`))) continue
      await notify({ userId: s.user_id, type: 'new_tournament', data: { tournamentId: t.id, slug: t.slug, title: t.title, club: t.club, startsAtText: when(t.starts_at) } })
      sent++
    }
  }
  return { sent }
}
