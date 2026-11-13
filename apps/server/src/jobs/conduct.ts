// Worker tick for running tournaments: repeat unanswered calls after 3 minutes (spec 3.3),
// warn about and auto-cancel tournaments under the minimum (spec 4.4).

import { sql } from 'kysely'
import type { Expression, SqlBool } from 'kysely'
import { ENTRY_OCCUPYING } from '@nomad/shared'
import { db, json } from '../db/index.ts'
import type { CallResponses } from '../db/types.ts'
import { audit } from '../audit.ts'
import { cancelTournament } from '../modules/tournament-admin.ts'
import { notify } from '../notify/index.ts'
import { sendCall } from '../notify/match.ts'
import { bus } from '../realtime/bus.ts'
import { organiserUserIds } from '../tournaments/busy.ts'

const MAX_CALLS = 3

export async function recallUnanswered(now = new Date()): Promise<number> {
  const rows = await db
    .selectFrom('matches as m')
    .innerJoin('tournaments as t', 't.id', 'm.tournament_id')
    .leftJoin('hall_tables as ht', 'ht.id', 'm.table_id')
    .select(['m.id', 'm.number', 'm.stage_id', 'm.group_id', 'm.round', 'm.tour', 'm.stage_label', 'm.tournament_id', 'm.call_count', 'm.called_at', 'm.call_responses', 'm.home_entry_id', 'm.away_entry_id', 't.slug', 't.title', 't.settings', 'ht.number as table'])
    .where('m.status', '=', 'called')
    .where('m.call_count', '<', MAX_CALLS)
    .execute()
  let sent = 0
  for (const m of rows) {
    const minutes = m.settings.callResponseMinutes ?? 3
    if (!m.called_at || now.getTime() - m.called_at.getTime() < minutes * 60000) continue
    const responses = m.call_responses as CallResponses
    const updated = await db
      .updateTable('matches')
      .set({ call_count: m.call_count + 1, called_at: now, call_responses: json(responses) })
      .where('id', '=', m.id)
      .where('call_count', '=', m.call_count)
      .executeTakeFirst()
    if (!updated.numUpdatedRows) continue
    const pending = (side: 'home' | 'away') => !['going', 'cannot'].includes(responses[side]?.answer ?? '')
    await sendCall({ id: m.tournament_id, slug: m.slug, title: m.title, settings: m.settings }, m, m.table!, true, pending)
    sent += (['home', 'away'] as const).filter(pending).length
    bus.publish(`tournament:${m.tournament_id}`, 'match.updated', { tournamentId: m.tournament_id, matchId: m.id })
  }
  return sent
}

const HOUR = 3600000

/** Not started tournaments under the minimum, selected by `where` (spec 4.4 «Мало участников»). */
async function underfilled(where: (now: Date) => Expression<SqlBool>, now: Date) {
  const rows = await db
    .selectFrom('tournaments as t')
    .select(['t.id', 't.club_id', 't.created_by', 't.slug', 't.title', 't.min_participants', 't.underfill_warned_at', 't.underfill_ack_at', (eb) => eb.selectFrom('entries as e').whereRef('e.tournament_id', '=', 't.id').where('e.status', 'in', [...ENTRY_OCCUPYING]).select((x) => x.fn.countAll<number>().as('n')).as('taken')])
    .where('t.status', 'in', ['published', 'registration_closed'])
    .where(where(now))
    .execute()
  return rows.filter((t) => Number(t.taken ?? 0) < t.min_participants)
}

/** The organiser is warned at registration close (3 hours before the start at the latest). */
export async function warnUnderfilled(now = new Date()): Promise<number> {
  const due = await underfilled((n) => sql<SqlBool>`t.underfill_warned_at IS NULL AND t.underfill_ack_at IS NULL AND (t.registration_closes_at <= ${n} OR t.starts_at <= ${new Date(n.getTime() + 3 * HOUR)})`, now)
  for (const t of due) {
    await db.updateTable('tournaments').set({ underfill_warned_at: now }).where('id', '=', t.id).execute()
    for (const userId of await organiserUserIds(t)) {
      await notify({ userId, type: 'tournament_underfilled', urgent: true, data: { tournamentId: t.id, slug: t.slug, title: t.title, taken: Number(t.taken ?? 0), min: t.min_participants } })
    }
  }
  return due.length
}

/** Cancelled 2 hours before the start if still under the minimum and the organiser did not confirm; players are notified. */
export async function autoCancelUnderfilled(now = new Date()): Promise<number> {
  const due = await underfilled((n) => sql<SqlBool>`t.underfill_ack_at IS NULL AND t.starts_at <= ${new Date(n.getTime() + 2 * HOUR)}`, now)
  for (const t of due) {
    await cancelTournament(t.id, null, 'too_few_participants')
    await audit({ actorUserId: null, entity: 'tournament', entityId: t.id, action: 'auto_cancel', after: { taken: Number(t.taken ?? 0), min: t.min_participants } })
  }
  return due.length
}
