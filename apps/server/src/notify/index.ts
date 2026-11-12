// Single entry point for user notifications. Every feature calls `notify`; the delivery
// (in-site inbox, Web Push, Telegram, e-mail, retries, preferences) lives behind it.

import type { Db, Transaction } from '../db/index.ts'
import type { Database } from '../db/types.ts'
import { bus } from '../realtime/bus.ts'

export type NotificationInput = {
  userId: number
  /** Stable event type, e.g. `match_call`, `waitlist_invited`, `tournament_reminder`. */
  type: string
  data: Record<string, unknown>
  /** Calls to a table: delivered immediately on every channel, cannot be disabled during a tournament. */
  urgent?: boolean
}

export async function notify(input: NotificationInput, _executor?: Db | Transaction<Database>): Promise<void> {
  bus.publish(`user:${input.userId}`, 'notification', { type: input.type, ...input.data })
}
