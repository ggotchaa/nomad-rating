// Telegram bot (grammY, long polling in the worker): binding by deep link or by name search,
// /me /next /stop /lang. Bound chats receive notifications through telegram/send.ts.

import { Bot, InlineKeyboard } from 'grammy'
import type { Context } from 'grammy'
import { searchWords } from '@nomad/shared'
import { config } from '../config.ts'
import { db } from '../db/index.ts'
import { logger } from '../logger.ts'
import { notify } from '../notify/index.ts'
import { type Lang, toLang } from '../notify/text.ts'
import { conductState } from '../tournaments/queue.ts'
import { MAX_ACCOUNTS, escape } from './send.ts'

const name = (p: { first_name: string; last_name: string }) => `${p.last_name} ${p.first_name}`

export const BOT_TEXT = {
  ru: {
    notFound: 'Профиль не найден.',
    already: (n: string) => `Уже привязано к профилю ${n}.`,
    max: (m: number) => `К профилю уже привязано ${m} аккаунтов Telegram — это максимум.`,
    moved: (from: string, to: string) => `Аккаунт перенесён с профиля ${from} на профиль ${to}. Уведомления прежнего профиля сюда больше не приходят.`,
    bound: (n: string) => `Готово: уведомления профиля ${n} будут приходить сюда.`,
    expired: 'Ссылка устарела. Откройте профиль на сайте и нажмите «Подключить Telegram» ещё раз.',
    hello: 'Здравствуйте! Напишите фамилию и имя, как в рейтинге Nomad, — найду ваш профиль.',
    unboundMe: 'Чат не привязан к профилю. Напишите фамилию и имя.',
    unbound: 'Чат не привязан к профилю.',
    rating: 'Рейтинг',
    calibration: (n: number) => `калибровка (${n}/3)`,
    noMatches: 'Ближайших матчей нет.',
    match: (n: number) => `Матч №${n}`,
    table: (n: number) => `стол ${n}`,
    called: 'ВАС ВЫЗЫВАЮТ',
    stopped: 'Уведомления в этот чат отключены. Чтобы включить снова — /start.',
    langSet: 'Язык сообщений: русский.',
    noPlayer: 'Не нашёл такого игрока. Проверьте написание или привяжите Telegram из профиля на сайте.',
    pick: 'Выберите себя:',
    nearest: (title: string, when: string) => `Ближайший турнир: ${title}, ${when}`,
    noTournament: 'Ближайших турниров нет.',
    queue: (n: number) => (n === 0 ? 'ваш матч следующий' : `через ${n} матч.`),
  },
  kk: {
    notFound: 'Профиль табылмады.',
    already: (n: string) => `${n} профиліне әлдеқашан байланған.`,
    max: (m: number) => `Профильге ${m} Telegram аккаунты байланған — бұл ең көбі.`,
    moved: (from: string, to: string) => `Аккаунт ${from} профилінен ${to} профиліне ауыстырылды. Бұрынғы профильдің хабарламалары енді мұнда келмейді.`,
    bound: (n: string) => `Дайын: ${n} профилінің хабарламалары осында келеді.`,
    expired: 'Сілтеменің мерзімі өтті. Сайттағы профильді ашып, «Telegram қосу» батырмасын қайта басыңыз.',
    hello: 'Сәлеметсіз бе! Тегіңіз бен атыңызды Nomad рейтингіндегідей жазыңыз — профиліңізді табамын.',
    unboundMe: 'Чат профильге байланбаған. Тегіңіз бен атыңызды жазыңыз.',
    unbound: 'Чат профильге байланбаған.',
    rating: 'Рейтинг',
    calibration: (n: number) => `калибрлеу (${n}/3)`,
    noMatches: 'Жақын арада матч жоқ.',
    match: (n: number) => `№${n} матч`,
    table: (n: number) => `${n}-үстел`,
    called: 'СІЗДІ ШАҚЫРЫП ЖАТЫР',
    stopped: 'Бұл чатқа хабарламалар өшірілді. Қайта қосу үшін — /start.',
    langSet: 'Хабарлама тілі: қазақша.',
    noPlayer: 'Мұндай ойыншы табылмады. Жазылуын тексеріңіз немесе Telegram-ды сайттағы профильден байлаңыз.',
    pick: 'Өзіңізді таңдаңыз:',
    nearest: (title: string, when: string) => `Жақын турнир: ${title}, ${when}`,
    noTournament: 'Жақын арада турнир жоқ.',
    queue: (n: number) => (n === 0 ? 'сіздің матчыңыз келесі' : `${n} матчтан кейін`),
  },
  en: {
    notFound: 'Profile not found.',
    already: (n: string) => `Already linked to the profile ${n}.`,
    max: (m: number) => `${m} Telegram accounts are already linked to this profile — that is the maximum.`,
    moved: (from: string, to: string) => `The account moved from the profile ${from} to the profile ${to}. Notifications of the previous profile no longer come here.`,
    bound: (n: string) => `Done: notifications of the profile ${n} will come here.`,
    expired: 'The link has expired. Open your profile on the site and press “Connect Telegram” again.',
    hello: 'Hello! Type your last and first name as in the Nomad rating — I will find your profile.',
    unboundMe: 'This chat is not linked to a profile. Type your last and first name.',
    unbound: 'This chat is not linked to a profile.',
    rating: 'Rating',
    calibration: (n: number) => `calibration (${n}/3)`,
    noMatches: 'No upcoming matches.',
    match: (n: number) => `Match #${n}`,
    table: (n: number) => `table ${n}`,
    called: 'YOU ARE CALLED',
    stopped: 'Notifications to this chat are off. To turn them back on — /start.',
    langSet: 'Message language: English.',
    noPlayer: 'No such player found. Check the spelling or link Telegram from your profile on the site.',
    pick: 'Choose yourself:',
    nearest: (title: string, when: string) => `Next tournament: ${title}, ${when}`,
    noTournament: 'No upcoming tournaments.',
    queue: (n: number) => (n === 0 ? 'your match is next' : `in ${n} ${n === 1 ? 'match' : 'matches'}`),
  },
} satisfies Record<Lang, unknown>

/** Chat language: /lang choice, else the bound user's locale, else the Telegram client language. */
async function chatLang(chatId: number, clientLang?: string): Promise<Lang> {
  const row = await db
    .selectFrom('telegram_accounts as a')
    .innerJoin('players as p', 'p.id', 'a.player_id')
    .leftJoin('users as u', 'u.id', 'p.user_id')
    .select(['a.lang', 'u.locale'])
    .where('a.chat_id', '=', chatId)
    .executeTakeFirst()
  return toLang(row?.lang ?? row?.locale, toLang(clientLang?.slice(0, 2)))
}
const textOf = async (ctx: Context) => BOT_TEXT[await chatLang(ctx.chat!.id, ctx.from?.language_code)]

export async function bindChat(chatId: number, playerId: number, username: string | null, clientLang?: string): Promise<string> {
  const player = await db.selectFrom('players').select(['id', 'first_name', 'last_name', 'user_id']).where('id', '=', playerId).executeTakeFirst()
  if (!player) return BOT_TEXT[await chatLang(chatId, clientLang)].notFound
  const current = await db
    .selectFrom('telegram_accounts as a')
    .innerJoin('players as p', 'p.id', 'a.player_id')
    .select(['a.player_id', 'p.first_name', 'p.last_name', 'p.user_id'])
    .where('a.chat_id', '=', chatId)
    .executeTakeFirst()
  if (current?.player_id === playerId) return BOT_TEXT[await chatLang(chatId, clientLang)].already(name(player))
  const count = await db.selectFrom('telegram_accounts').select((eb) => eb.fn.countAll<number>().as('n')).where('player_id', '=', playerId).executeTakeFirstOrThrow()
  if (Number(count.n) >= MAX_ACCOUNTS) return BOT_TEXT[await chatLang(chatId, clientLang)].max(MAX_ACCOUNTS)
  await db
    .insertInto('telegram_accounts')
    .values({ chat_id: chatId, player_id: playerId, username })
    .onConflict((oc) => oc.column('chat_id').doUpdateSet({ player_id: playerId, username, stopped: false, blocked_at: null }))
    .execute()
  if (player.user_id) await notify({ userId: player.user_id, type: 'telegram_linked', data: { playerId, username } })
  if (current?.user_id) await notify({ userId: current.user_id, type: 'telegram_moved', data: { playerId: current.player_id, username, to: name(player) } })
  const t = BOT_TEXT[await chatLang(chatId, clientLang)]
  return current ? t.moved(name(current), name(player)) : t.bound(name(player))
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

export const searchLabel = (r: { first_name: string; last_name: string; birth_year: number | null; city: string | null; rating: number | null }) =>
  [name(r), r.rating != null ? String(r.rating) : null, r.birth_year, r.city].filter(Boolean).join(', ')

/** Nearest tournament the player is entered in (running or upcoming). */
export async function nearestTournament(playerId: number) {
  return db
    .selectFrom('entries as e')
    .innerJoin('tournaments as t', 't.id', 'e.tournament_id')
    .select(['t.title', 't.slug', 't.starts_at'])
    .where('e.player_id', '=', playerId)
    .where('e.status', 'in', ['paid', 'checked_in', 'playing', 'awaiting_payment'])
    .where('t.status', 'in', ['published', 'registration_closed', 'running'])
    .orderBy('t.starts_at')
    .executeTakeFirst()
}

/** How many matches are ahead of this one in the tournament queue; null when it is not queued yet. */
export async function queuePosition(tournamentId: number, matchId: number): Promise<number | null> {
  const t = await db.selectFrom('tournaments').selectAll().where('id', '=', tournamentId).executeTakeFirstOrThrow()
  const i = (await conductState(t)).queue.findIndex((q) => q.id === matchId)
  return i < 0 ? null : i
}

export function createBot(): Bot | null {
  if (!config.TELEGRAM_BOT_TOKEN) return null
  const bot = new Bot(config.TELEGRAM_BOT_TOKEN)
  const site = config.SITE_URL.replace(/\/$/, '')

  bot.command('start', async (ctx) => {
    const token = ctx.match?.trim()
    if (token) {
      const row = await db.selectFrom('telegram_bind_tokens').selectAll().where('token', '=', token).where('expires_at', '>', new Date()).executeTakeFirst()
      if (!row) return void (await ctx.reply((await textOf(ctx)).expired))
      await db.deleteFrom('telegram_bind_tokens').where('token', '=', token).execute()
      return void (await ctx.reply(await bindChat(ctx.chat.id, row.player_id, ctx.from?.username ?? null, ctx.from?.language_code)))
    }
    await ctx.reply((await textOf(ctx)).hello)
  })

  bot.command('me', async (ctx) => {
    const t = await textOf(ctx)
    const p = await playerOfChat(ctx.chat.id)
    if (!p) return void (await ctx.reply(t.unboundMe))
    const next = await nearestTournament(p.id)
    const when = next?.starts_at.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Almaty' })
    await ctx.reply(`${name(p)}\n${t.rating}: ${p.rating ?? t.calibration(p.calibration?.tournaments ?? 0)}\n${site}/players/${p.id}\n\n${next ? `${t.nearest(next.title, when!)}\n${site}/t/${next.slug}` : t.noTournament}`)
  })

  bot.command('next', async (ctx) => {
    const t = await textOf(ctx)
    const p = await playerOfChat(ctx.chat.id)
    if (!p) return void (await ctx.reply(t.unbound))
    const m = await db
      .selectFrom('matches as m')
      .innerJoin('entries as e', (j) => j.on((eb) => eb.or([eb('e.id', '=', eb.ref('m.home_entry_id')), eb('e.id', '=', eb.ref('m.away_entry_id'))])))
      .innerJoin('tournaments as t', 't.id', 'm.tournament_id')
      .leftJoin('hall_tables as ht', 'ht.id', 'm.table_id')
      .select(['m.id', 'm.number', 'm.status', 'm.tournament_id', 't.title', 't.slug', 'ht.number as table'])
      .where('e.player_id', '=', p.id)
      .where('t.status', '=', 'running')
      .where('m.status', 'in', ['scheduled', 'called', 'playing'])
      .orderBy('m.round')
      .orderBy('m.number')
      .executeTakeFirst()
    if (!m) return void (await ctx.reply(t.noMatches))
    const ahead = m.status === 'scheduled' ? await queuePosition(m.tournament_id, m.id) : null
    await ctx.reply(`${m.title}\n${t.match(m.number)}${m.table ? ` · ${t.table(m.table)}` : ''}${m.status === 'called' ? ` · ${t.called}` : ''}${ahead != null ? ` · ${t.queue(ahead)}` : ''}\n${site}/me/t/${m.slug}`)
  })

  bot.command('stop', async (ctx) => {
    await db.updateTable('telegram_accounts').set({ stopped: true }).where('chat_id', '=', ctx.chat.id).execute()
    await ctx.reply((await textOf(ctx)).stopped)
  })

  bot.command('lang', async (ctx) => {
    await ctx.reply('Тіл / Язык / Language', { reply_markup: new InlineKeyboard().text('Қазақша', 'lang:kk').text('Русский', 'lang:ru').text('English', 'lang:en') })
  })

  bot.callbackQuery(/^lang:(ru|kk|en)$/, async (ctx) => {
    const lang = ctx.match[1] as Lang
    await db.updateTable('telegram_accounts').set({ lang }).where('chat_id', '=', ctx.chat!.id).execute()
    await ctx.answerCallbackQuery('OK')
    await ctx.reply(BOT_TEXT[lang].langSet)
  })

  bot.callbackQuery(/^bind:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery()
    await ctx.reply(await bindChat(ctx.chat!.id, Number(ctx.match[1]), ctx.from.username ?? null, ctx.from.language_code))
  })

  bot.on('message:text', async (ctx) => {
    const words = searchWords(ctx.message.text)
    if (!words.length) return
    await db.updateTable('telegram_accounts').set({ stopped: false }).where('chat_id', '=', ctx.chat.id).execute()
    const lang = await chatLang(ctx.chat.id, ctx.from.language_code)
    const cityCol = lang === 'kk' ? 'c.name_kk' : lang === 'en' ? 'c.name_en' : 'c.name_ru'
    let q = db
      .selectFrom('players as p')
      .leftJoin('cities as c', 'c.id', 'p.city_id')
      .leftJoin('player_ratings as r', (j) => j.onRef('r.player_id', '=', 'p.id').on('r.kind', '=', 'singles'))
      .select(['p.id', 'p.first_name', 'p.last_name', 'p.birth_year', `${cityCol} as city`, 'r.rating'])
    for (const w of words) q = q.where('p.search_name', 'like', `%${w}%`)
    const rows = await q.orderBy('p.last_name').limit(5).execute()
    if (!rows.length) return void (await ctx.reply(BOT_TEXT[lang].noPlayer))
    const kb = new InlineKeyboard()
    for (const r of rows) kb.text(searchLabel(r), `bind:${r.id}`).row()
    await ctx.reply(BOT_TEXT[lang].pick, { reply_markup: kb, parse_mode: 'HTML' })
  })

  bot.catch((err) => logger.warn({ err: escape(String(err.error)) }, 'telegram bot error'))
  return bot
}
