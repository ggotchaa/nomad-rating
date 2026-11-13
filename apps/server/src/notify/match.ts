// Match-call notifications: call data (stage, opponent rating, response time), «you're next»,
// table changes, cancelled calls and Telegram call-message refresh after an answer on the site.

import { sql } from 'kysely'
import { db } from '../db/index.ts'
import type { CallResponses, Match, Tournament } from '../db/types.ts'
import { logger } from '../logger.ts'
import { playerName } from '../modules/players.ts'
import { conductState } from '../tournaments/queue.ts'
import { editTelegram, telegramEnabled } from '../telegram/send.ts'
import { notify } from './index.ts'
import { render, toLang } from './text.ts'

type T = Pick<Tournament, 'id' | 'slug' | 'title' | 'settings'>
type M = Pick<Match, 'id' | 'number' | 'stage_id' | 'group_id' | 'round' | 'tour' | 'stage_label' | 'home_entry_id' | 'away_entry_id'>
type Side = 'home' | 'away'

/** Per-side notification data of a call; `userId` null when the player has no account. */
export async function callData(t: T, m: M, table: number | null) {
  const stage = await db.selectFrom('stages').select(['name', 'kind']).where('id', '=', m.stage_id).executeTakeFirst()
  const group = m.group_id ? await db.selectFrom('groups').select('code').where('id', '=', m.group_id).executeTakeFirst() : undefined
  const players = await db
    .selectFrom('entries as e')
    .innerJoin('players as p', 'p.id', 'e.player_id')
    .leftJoin('player_ratings as r', (j) => j.onRef('r.player_id', '=', 'p.id').on('r.kind', '=', 'singles'))
    .select(['e.id', 'p.id as player_id', 'p.user_id', 'p.first_name', 'p.last_name', 'r.rating'])
    .where('e.id', 'in', [m.home_entry_id ?? 0, m.away_entry_id ?? 0])
    .execute()
  const of = (side: Side) => players.find((p) => p.id === (side === 'home' ? m.home_entry_id : m.away_entry_id))
  return (['home', 'away'] as const).map((side) => {
    const me = of(side)
    const opp = of(side === 'home' ? 'away' : 'home')
    return {
      side,
      userId: me?.user_id ?? null,
      data: {
        tournamentId: t.id,
        slug: t.slug,
        title: t.title,
        matchId: m.id,
        matchNumber: m.number,
        table,
        side,
        opponent: opp ? playerName(opp) : null,
        opponentId: opp?.player_id ?? null,
        opponentRating: opp?.rating ?? null,
        stage: stage?.name ?? null,
        group: group?.code ?? null,
        tour: m.tour ?? (group ? m.round : null),
        round: m.stage_label?.startsWith('group:') ? null : m.stage_label,
        minutes: t.settings.callResponseMinutes ?? 5,
      } as Record<string, unknown>,
    }
  })
}

export async function sendCall(t: T, m: M, table: number, repeat = false, only?: (side: Side) => boolean) {
  for (const c of await callData(t, m, table)) {
    if (!c.userId || (only && !only(c.side))) continue
    await notify({ userId: c.userId, type: 'match_call', urgent: true, data: { ...c.data, repeat } })
  }
}

/** Table moved: the call message is edited in place and a short new message says where to go. */
export async function sendTableChanged(t: T, m: M, table: number) {
  for (const c of await callData(t, m, table)) {
    if (!c.userId) continue
    await notify({ userId: c.userId, type: 'match_table_changed', urgent: true, data: c.data })
    void refreshTelegram(c.userId, c.data)
  }
}

export async function sendCallCancelled(t: T, m: M) {
  for (const c of await callData(t, m, null)) {
    if (c.userId) await notify({ userId: c.userId, type: 'match_call_cancelled', data: c.data })
  }
}

/** The player answered on the site: their Telegram call message shows the same status. */
export async function refreshCallAnswer(t: T, m: M, table: number | null, side: Side, responses: CallResponses) {
  const c = (await callData(t, m, table)).find((x) => x.side === side)
  if (c?.userId) await refreshTelegram(c.userId, { ...c.data, answer: responses[side]?.answer ?? null })
}

async function refreshTelegram(userId: number, data: Record<string, unknown>) {
  if (!telegramEnabled) return
  try {
    const user = await db.selectFrom('users').select('locale').where('id', '=', userId).executeTakeFirst()
    const lang = toLang(user?.locale)
    await editTelegram(userId, (chatLang) => render('match_call', data, toLang(chatLang, lang)), `match:${String(data.matchId)}`)
  } catch (err) {
    logger.warn({ err }, 'telegram call refresh failed')
  }
}

/** «You're next»: players of the first match in the queue, once per match. */
export async function notifyNext(t: Tournament) {
  const { queue } = await conductState(t)
  const next = queue[0]
  if (!next) return
  const fresh = await db.insertInto('notification_dedupe').values({ key: `match_next:${next.id}` }).onConflict((oc) => oc.doNothing()).returning('key').executeTakeFirst()
  if (!fresh) return
  for (const [me, opp] of [[next.home, next.away], [next.away, next.home]] as const) {
    if (me?.userId) await notify({ userId: me.userId, type: 'match_next', data: { tournamentId: t.id, slug: t.slug, title: t.title, matchId: next.id, matchNumber: next.number, opponent: opp?.name ?? null } })
  }
}

/** Organiser view: last Telegram delivery of a call per player — 'none' when no bot is linked. */
export async function telegramDelivery(tournamentId: number): Promise<Record<number, 'sent' | 'failed' | 'none'>> {
  const rows = await db
    .selectFrom('entries as e')
    .innerJoin('players as p', 'p.id', 'e.player_id')
    .select([
      'p.id',
      (eb) => eb.selectFrom('telegram_accounts as a').whereRef('a.player_id', '=', 'p.id').where('a.stopped', '=', false).where('a.blocked_at', 'is', null).select((x) => x.fn.countAll<number>().as('n')).as('chats'),
      sql<string | null>`(select l.status from notification_log l join notifications n on n.id = l.notification_id
        where l.user_id = p.user_id and l.channel = 'telegram' and n.type = 'match_call' and n.data->>'tournamentId' = ${String(tournamentId)}
        order by l.id desc limit 1)`.as('last'),
    ])
    .where('e.tournament_id', '=', tournamentId)
    .execute()
  const out: Record<number, 'sent' | 'failed' | 'none'> = {}
  for (const r of rows) out[r.id] = !Number(r.chats) ? 'none' : r.last === 'failed' ? 'failed' : 'sent'
  return out
}
