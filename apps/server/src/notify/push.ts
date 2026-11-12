import * as webpush from 'web-push'
import { config } from '../config.ts'
import { db } from '../db/index.ts'
import type { Rendered } from './text.ts'

export const pushEnabled = Boolean(config.VAPID_PUBLIC_KEY && config.VAPID_PRIVATE_KEY)
if (pushEnabled) webpush.setVapidDetails(config.VAPID_SUBJECT, config.VAPID_PUBLIC_KEY, config.VAPID_PRIVATE_KEY)

/** Sends to every subscription of the user; returns how many succeeded. Gone subscriptions are removed. */
export async function sendPush(userId: number, message: Rendered & { tag?: string; urgent?: boolean }): Promise<number> {
  const subs = await db.selectFrom('push_subscriptions').selectAll().where('user_id', '=', userId).execute()
  let sent = 0
  let lastError: unknown = null
  for (const s of subs) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, JSON.stringify(message), { TTL: message.urgent ? 300 : 86400, urgency: message.urgent ? 'high' : 'normal' })
      sent++
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode
      if (status === 404 || status === 410) await db.deleteFrom('push_subscriptions').where('id', '=', s.id).execute()
      else lastError = err
    }
  }
  if (!sent && lastError) throw lastError
  return sent
}
