// Telegram bot (grammY, long polling in the worker): binding by deep link or by name search,
// /me /next /stop /lang. Bound chats receive notifications through telegram/send.ts.

import { Bot, InlineKeyboard } from 'grammy'
import { searchWords } from '@nomad/shared'
import { config } from '../config.ts'
import { db } from '../db/index.ts'
import { logger } from '../logger.ts'
import { MAX_ACCOUNTS, escape } from './send.ts'

const name = (p: { first_name: string; last_name: string }) => `${p.last_name} ${p.first_name}`

export async function bindChat(chatId: number, playerId: number, username: string | null): Promise<string> {
  const player = await db.selectFrom('players').select(['id', 'first_name', 'last_name']).where('id', '=', playerId).executeTakeFirst()
  if (!player) return 'Профиль не найден.'
  const current = await db
    .selectFrom('telegram_accounts as a')
    .innerJoin('players as p', 'p.id', 'a.player_id')
    .select(['a.player_id', 'p.first_name', 'p.last_name'])
    .where('a.chat_id', '=', chatId)
    .executeTakeFirst()
  if (current?.player_id === playerId) return `Уже привязано к профилю ${name(player)}.`
  const count = await db.selectFrom('telegram_accounts').select((eb) => eb.fn.countAll<number>().as('n')).where('player_id', '=', playerId).executeTakeFirstOrThrow()
  if (Number(count.n) >= MAX_ACCOUNTS) return `К профилю уже привязано ${MAX_ACCOUNTS} аккаунтов Telegram — это максимум.`
  await db
    .insertInto('telegram_accounts')
    .values({ chat_id: chatId, player_id: playerId, username })
    .onConflict((oc) => oc.column('chat_id').doUpdateSet({ player_id: playerId, username, stopped: false, blocked_at: null }))
    .execute()
  return current
    ? `Аккаунт перенесён с профиля ${name(current)} на профиль ${name(player)}. Уведомления прежнего профиля сюда больше не приходят.`
    : `Готово: уведомления профиля ${name(player)} будут приходить сюда.`
}

async function playerOfChat(chatId: number) {
  return db
    .selectFrom('telegram_accounts as a')
    .innerJoin('players as p', 'p.id', 'a.player_id')
    .leftJoin('player_ratings as r', (j) => j.onRef('r.player_id', '=', 'p.id').on('r.kind', '=', 'singles'))
    .select(['p.id', 'p.first_name', 'p.last_name', 'r.rating', 'r.calibration'])
    .where('a.chat_id', '=', chatId)
    .executeTakeFirst()
}

export function createBot(): Bot | null {
  if (!config.TELEGRAM_BOT_TOKEN) return null
  const bot = new Bot(config.TELEGRAM_BOT_TOKEN)
  const site = config.SITE_URL.replace(/\/$/, '')

  bot.command('start', async (ctx) => {
    const token = ctx.match?.trim()
    if (token) {
      const row = await db.selectFrom('telegram_bind_tokens').selectAll().where('token', '=', token).where('expires_at', '>', new Date()).executeTakeFirst()
      if (!row) return void (await ctx.reply('Ссылка устарела. Откройте профиль на сайте и нажмите «Подключить Telegram» ещё раз.'))
      await db.deleteFrom('telegram_bind_tokens').where('token', '=', token).execute()
      return void (await ctx.reply(await bindChat(ctx.chat.id, row.player_id, ctx.from?.username ?? null)))
    }
    await ctx.reply('Здравствуйте! Напишите фамилию и имя, как в рейтинге Nomad, — найду ваш профиль.')
  })

  bot.command('me', async (ctx) => {
    const p = await playerOfChat(ctx.chat.id)
    if (!p) return void (await ctx.reply('Чат не привязан к профилю. Напишите фамилию и имя.'))
    await ctx.reply(`${name(p)}\nРейтинг: ${p.rating ?? `калибровка (${p.calibration?.tournaments ?? 0}/3)`}\n${site}/players/${p.id}`)
  })

  bot.command('next', async (ctx) => {
    const p = await playerOfChat(ctx.chat.id)
    if (!p) return void (await ctx.reply('Чат не привязан к профилю.'))
    const m = await db
      .selectFrom('matches as m')
      .innerJoin('entries as e', (j) => j.on((eb) => eb.or([eb('e.id', '=', eb.ref('m.home_entry_id')), eb('e.id', '=', eb.ref('m.away_entry_id'))])))
      .innerJoin('tournaments as t', 't.id', 'm.tournament_id')
      .leftJoin('hall_tables as ht', 'ht.id', 'm.table_id')
      .select(['m.number', 'm.status', 't.title', 't.slug', 'ht.number as table'])
      .where('e.player_id', '=', p.id)
      .where('t.status', '=', 'running')
      .where('m.status', 'in', ['scheduled', 'called', 'playing'])
      .orderBy('m.round')
      .orderBy('m.number')
      .executeTakeFirst()
    if (!m) return void (await ctx.reply('Ближайших матчей нет.'))
    await ctx.reply(`${m.title}\nМатч №${m.number}${m.table ? ` · стол ${m.table}` : ''}${m.status === 'called' ? ' · ВАС ВЫЗЫВАЮТ' : ''}\n${site}/me/t/${m.slug}`)
  })

  bot.command('stop', async (ctx) => {
    await db.updateTable('telegram_accounts').set({ stopped: true }).where('chat_id', '=', ctx.chat.id).execute()
    await ctx.reply('Уведомления в этот чат отключены. Чтобы включить снова — /start.')
  })

  bot.command('lang', async (ctx) => {
    await ctx.reply('Тіл / Язык / Language', { reply_markup: new InlineKeyboard().text('Русский', 'lang:ru').text('Қазақша', 'lang:kk').text('English', 'lang:en') })
  })

  bot.callbackQuery(/^lang:(ru|kk|en)$/, async (ctx) => {
    await db.updateTable('telegram_accounts').set({ lang: ctx.match[1]! }).where('chat_id', '=', ctx.chat!.id).execute()
    await ctx.answerCallbackQuery('OK')
  })

  bot.callbackQuery(/^bind:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery()
    await ctx.reply(await bindChat(ctx.chat!.id, Number(ctx.match[1]), ctx.from.username ?? null))
  })

  bot.on('message:text', async (ctx) => {
    const words = searchWords(ctx.message.text)
    if (!words.length) return
    await db.updateTable('telegram_accounts').set({ stopped: false }).where('chat_id', '=', ctx.chat.id).execute()
    let q = db.selectFrom('players as p').leftJoin('cities as c', 'c.id', 'p.city_id').select(['p.id', 'p.first_name', 'p.last_name', 'p.birth_year', 'c.name_ru as city'])
    for (const w of words) q = q.where('p.search_name', 'like', `%${w}%`)
    const rows = await q.orderBy('p.last_name').limit(6).execute()
    if (!rows.length) return void (await ctx.reply('Не нашёл такого игрока. Проверьте написание или привяжите Telegram из профиля на сайте.'))
    const kb = new InlineKeyboard()
    for (const r of rows) kb.text(`${name(r)}, ${r.birth_year}${r.city ? `, ${r.city}` : ''}`, `bind:${r.id}`).row()
    await ctx.reply(`Выберите себя:`, { reply_markup: kb, parse_mode: 'HTML' })
  })

  bot.catch((err) => logger.warn({ err: escape(String(err.error)) }, 'telegram bot error'))
  return bot
}
