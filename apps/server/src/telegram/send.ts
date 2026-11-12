// Telegram delivery: one message per bound chat; a call message is edited in place when the call changes.

import { Api, GrammyError, InlineKeyboard } from 'grammy'
import { config } from '../config.ts'
import { db } from '../db/index.ts'
import type { Rendered } from '../notify/text.ts'

export const telegramEnabled = Boolean(config.TELEGRAM_BOT_TOKEN)
let api: Api | null = null
export const telegramApi = (): Api => (api ??= new Api(config.TELEGRAM_BOT_TOKEN))

export const MAX_ACCOUNTS = 5

export async function chatsOfUser(userId: number) {
  return db
    .selectFrom('telegram_accounts as a')
    .innerJoin('players as p', 'p.id', 'a.player_id')
    .select(['a.chat_id', 'a.lang'])
    .where('p.user_id', '=', userId)
    .where('a.stopped', '=', false)
    .where('a.blocked_at', 'is', null)
    .execute()
}

const isBlocked = (err: unknown) => err instanceof GrammyError && (err.error_code === 403 || /chat not found/i.test(err.description))

/** `ref` groups messages that are edited instead of re-sent (e.g. `match:42`). Returns how many chats got it. */
export async function sendTelegram(userId: number, message: Rendered, ref?: string): Promise<number> {
  const chats = await chatsOfUser(userId)
  const keyboard = new InlineKeyboard().url('Открыть на сайте', message.url)
  const text = `<b>${escape(message.title)}</b>\n${escape(message.body)}`
  let sent = 0
  let lastError: unknown = null
  for (const c of chats) {
    try {
      const previous = ref
        ? await db.selectFrom('telegram_messages').select('message_id').where('ref', '=', ref).where('chat_id', '=', c.chat_id).executeTakeFirst()
        : undefined
      if (previous) {
        await telegramApi()
          .editMessageText(c.chat_id, previous.message_id, text, { parse_mode: 'HTML', reply_markup: keyboard })
          .catch((err: unknown) => {
            if (!(err instanceof GrammyError && /not modified/i.test(err.description))) throw err
          })
      } else {
        const m = await telegramApi().sendMessage(c.chat_id, text, { parse_mode: 'HTML', reply_markup: keyboard })
        if (ref) await db.insertInto('telegram_messages').values({ ref, chat_id: c.chat_id, message_id: m.message_id }).onConflict((oc) => oc.columns(['ref', 'chat_id']).doUpdateSet({ message_id: m.message_id })).execute()
      }
      sent++
    } catch (err) {
      if (isBlocked(err)) await db.updateTable('telegram_accounts').set({ blocked_at: new Date() }).where('chat_id', '=', c.chat_id).execute()
      else lastError = err
    }
  }
  if (!sent && lastError) throw lastError
  return sent
}

export const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
