// Notifications: inbox row + realtime event, then delivery per channel (push, Telegram, e-mail).
// With Redis every channel is a BullMQ job (3 attempts, logged per attempt); without Redis delivery runs inline.

import type { Db, Transaction } from '../db/index.ts'
import { db as defaultDb, json } from '../db/index.ts'
import type { Database, NotifyChannel } from '../db/types.ts'
import { QUEUES, queue } from '../jobs/queues.ts'
import { logger } from '../logger.ts'
import { bus } from '../realtime/bus.ts'
import { sendTelegram, telegramEnabled } from '../telegram/send.ts'
import { sendEmail } from './email.ts'
import { resolveChannels } from './prefs.ts'
import { pushEnabled, sendPush } from './push.ts'
import { render, toLang } from './text.ts'

export type NotifyInput = { userId: number; type: string; data: Record<string, unknown>; urgent?: boolean }
export type DeliveryJob = { notificationId: number; userId: number; type: string; data: Record<string, unknown>; urgent: boolean; createdAt: number; channel: NotifyChannel }

export const ATTEMPTS = 3

export async function notify(input: NotifyInput, executor: Db | Transaction<Database> = defaultDb): Promise<void> {
  const urgent = input.urgent ?? input.type === 'match_call'
  const row = await executor
    .insertInto('notifications')
    .values({ user_id: input.userId, type: input.type, data: json(input.data), urgent })
    .returning(['id', 'created_at'])
    .executeTakeFirstOrThrow()
  bus.publish(`user:${input.userId}`, 'notification', { id: row.id, type: input.type, urgent, ...input.data })
  const base = { notificationId: row.id, userId: input.userId, type: input.type, data: input.data, urgent, createdAt: Date.now() }
  // Delivery reads prefs outside the caller's transaction; the job carries everything it needs.
  setImmediate(() => void dispatch(base).catch((err) => logger.error({ err }, 'notify dispatch failed')))
}

async function dispatch(base: Omit<DeliveryJob, 'channel'>): Promise<void> {
  const prefs = await defaultDb.selectFrom('notification_prefs').select(['type', 'channel', 'enabled']).where('user_id', '=', base.userId).execute()
  const active = base.type === 'match_call' ? await inActiveTournament(base.userId) : false
  const channels = resolveChannels(base.type, prefs, { urgent: base.urgent, inActiveTournament: active })
  const q = queue(QUEUES.notify)
  for (const channel of channels) {
    const job: DeliveryJob = { ...base, channel }
    if (q) {
      await q.add(`${base.type}:${channel}`, job, {
        attempts: ATTEMPTS,
        backoff: { type: 'exponential', delay: base.urgent ? 500 : 5000 },
        priority: base.urgent ? 1 : 10,
        removeOnComplete: 1000,
        removeOnFail: 5000,
      })
    } else {
      void deliverInline(job)
    }
  }
}

async function deliverInline(job: DeliveryJob): Promise<void> {
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      await deliver(job, attempt)
      return
    } catch {
      await new Promise((r) => setTimeout(r, attempt * (job.urgent ? 500 : 2000)))
    }
  }
}

async function inActiveTournament(userId: number): Promise<boolean> {
  const row = await defaultDb
    .selectFrom('entries as e')
    .innerJoin('players as p', 'p.id', 'e.player_id')
    .innerJoin('tournaments as t', 't.id', 'e.tournament_id')
    .select('e.id')
    .where('p.user_id', '=', userId)
    .where('t.status', '=', 'running')
    .where('e.status', 'in', ['checked_in', 'playing'])
    .executeTakeFirst()
  return Boolean(row)
}

/** One attempt on one channel; throws to let the queue retry. Every attempt is logged. */
export async function deliver(job: DeliveryJob, attempt: number): Promise<void> {
  const log = (status: 'sent' | 'failed' | 'skipped', error: string | null = null) =>
    defaultDb
      .insertInto('notification_log')
      .values({ notification_id: job.notificationId, user_id: job.userId, type: job.type, channel: job.channel, attempt, status, error, latency_ms: Date.now() - job.createdAt })
      .execute()
  try {
    const user = await defaultDb.selectFrom('users').select(['email', 'locale']).where('id', '=', job.userId).executeTakeFirst()
    const lang = toLang(user?.locale)
    const message = render(job.type, job.data, lang)
    let sent = 0
    if (job.channel === 'push') {
      if (!pushEnabled) return void (await log('skipped', 'push.disabled'))
      sent = await sendPush(job.userId, { ...message, urgent: job.urgent, tag: job.data.matchId ? `match:${String(job.data.matchId)}` : undefined })
    } else if (job.channel === 'telegram') {
      if (!telegramEnabled) return void (await log('skipped', 'telegram.disabled'))
      sent = await sendTelegram(job.userId, (chatLang) => render(job.type, job.data, toLang(chatLang, lang)), job.data.matchId ? `match:${String(job.data.matchId)}` : undefined)
    } else {
      if (user) sent = (await sendEmail({ to: user.email, subject: message.title, text: `${message.body}\n\n${message.url}` }), 1)
    }
    await log(sent ? 'sent' : 'skipped', sent ? null : 'no_recipient')
  } catch (err) {
    await log('failed', err instanceof Error ? err.message.slice(0, 500) : String(err))
    throw err
  }
}
