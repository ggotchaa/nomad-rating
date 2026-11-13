// Notification inbox, per-type/channel preferences, Web Push subscriptions, Telegram binding,
// club / rating subscriptions, delivery stats.

import { randomBytes } from 'node:crypto'
import { Router } from 'express'
import { sql } from 'kysely'
import { z } from 'zod'
import { requireClubRight, requirePlatformAdmin, requireUser } from '../auth/access.ts'
import { config } from '../config.ts'
import { db, json } from '../db/index.ts'
import { conflict, forbidden, handler, notFound } from '../http/errors.ts'
import { intParam, parseBody, parseQuery } from '../http/validate.ts'
import { CHANNELS, NOTIFY_TYPES } from '../notify/prefs.ts'
import { pushEnabled } from '../notify/push.ts'
import { MAX_ACCOUNTS, telegramEnabled } from '../telegram/send.ts'

export const notificationsRouter = Router()

notificationsRouter.get(
  '/',
  handler(async (req, res) => {
    const user = requireUser(req)
    const { limit, before } = parseQuery(z.object({ limit: z.coerce.number().int().min(1).max(100).default(30), before: z.coerce.number().int().optional() }), req)
    let q = db.selectFrom('notifications').select(['id', 'type', 'data', 'urgent', 'read_at', 'created_at']).where('user_id', '=', user.id)
    if (before) q = q.where('id', '<', before)
    const [items, unread] = await Promise.all([
      q.orderBy('id', 'desc').limit(limit).execute(),
      db.selectFrom('notifications').select((eb) => eb.fn.countAll<number>().as('n')).where('user_id', '=', user.id).where('read_at', 'is', null).executeTakeFirstOrThrow(),
    ])
    res.json({ unread: Number(unread.n), items: items.map((n) => ({ id: n.id, type: n.type, data: n.data, urgent: n.urgent, read: n.read_at != null, createdAt: n.created_at })) })
  }),
)

notificationsRouter.get(
  '/unread',
  handler(async (req, res) => {
    const user = requireUser(req)
    const row = await db.selectFrom('notifications').select((eb) => eb.fn.countAll<number>().as('n')).where('user_id', '=', user.id).where('read_at', 'is', null).executeTakeFirstOrThrow()
    res.json({ count: Number(row.n) })
  }),
)

notificationsRouter.post(
  '/read',
  handler(async (req, res) => {
    const user = requireUser(req)
    const { ids } = parseBody(z.object({ ids: z.array(z.number().int()).max(500).optional() }), req)
    let q = db.updateTable('notifications').set({ read_at: new Date() }).where('user_id', '=', user.id).where('read_at', 'is', null)
    if (ids) q = q.where('id', 'in', ids.length ? ids : [0])
    await q.execute()
    res.json({ ok: true })
  }),
)

notificationsRouter.get(
  '/settings',
  handler(async (req, res) => {
    const user = requireUser(req)
    const [prefs, accounts, subs, pushCount] = await Promise.all([
      db.selectFrom('notification_prefs').select(['type', 'channel', 'enabled']).where('user_id', '=', user.id).execute(),
      user.playerId
        ? db.selectFrom('telegram_accounts').select(['chat_id', 'username', 'stopped', 'blocked_at', 'created_at']).where('player_id', '=', user.playerId).orderBy('created_at').execute()
        : [],
      db
        .selectFrom('subscriptions as s')
        .leftJoin('clubs as c', 'c.id', 's.club_id')
        .select(['s.id', 's.kind', 's.club_id', 'c.name as club'])
        .where('s.user_id', '=', user.id)
        .execute(),
      db.selectFrom('push_subscriptions').select((eb) => eb.fn.countAll<number>().as('n')).where('user_id', '=', user.id).executeTakeFirstOrThrow(),
    ])
    res.json({
      types: Object.entries(NOTIFY_TYPES).map(([type, d]) => ({ type, defaults: d.channels, mandatoryInTournament: Boolean(d.mandatoryInTournament) })),
      channels: CHANNELS,
      prefs,
      push: { enabled: pushEnabled, publicKey: pushEnabled ? config.VAPID_PUBLIC_KEY : null, devices: Number(pushCount.n) },
      telegram: {
        enabled: telegramEnabled,
        bot: config.TELEGRAM_BOT_USERNAME || null,
        max: MAX_ACCOUNTS,
        accounts: accounts.map((a) => ({ chatId: String(a.chat_id), username: a.username, stopped: a.stopped, blocked: a.blocked_at != null, since: a.created_at })),
      },
      subscriptions: subs.map((s) => ({ id: s.id, kind: s.kind, clubId: s.club_id, club: s.club })),
    })
  }),
)

notificationsRouter.put(
  '/prefs',
  handler(async (req, res) => {
    const user = requireUser(req)
    const body = parseBody(z.object({ type: z.enum(Object.keys(NOTIFY_TYPES) as [string, ...string[]]), channel: z.enum(['push', 'telegram', 'email']), enabled: z.boolean() }), req)
    await db
      .insertInto('notification_prefs')
      .values({ user_id: user.id, ...body })
      .onConflict((oc) => oc.columns(['user_id', 'type', 'channel']).doUpdateSet({ enabled: body.enabled }))
      .execute()
    res.json({ ok: true })
  }),
)

const pushBody = z.object({ endpoint: z.url().max(2000), keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }) })

notificationsRouter.post(
  '/push',
  handler(async (req, res) => {
    const user = requireUser(req)
    const body = parseBody(pushBody, req)
    await db
      .insertInto('push_subscriptions')
      .values({ user_id: user.id, endpoint: body.endpoint, keys: json(body.keys) })
      .onConflict((oc) => oc.column('endpoint').doUpdateSet({ user_id: user.id, keys: json(body.keys) }))
      .execute()
    res.status(201).json({ ok: true })
  }),
)

notificationsRouter.delete(
  '/push',
  handler(async (req, res) => {
    const user = requireUser(req)
    const { endpoint } = parseBody(z.object({ endpoint: z.string().max(2000) }), req)
    await db.deleteFrom('push_subscriptions').where('user_id', '=', user.id).where('endpoint', '=', endpoint).execute()
    res.status(204).end()
  }),
)

/** Deep link that binds the chat which opens it to the current player. */
notificationsRouter.post(
  '/telegram/link',
  handler(async (req, res) => {
    const user = requireUser(req)
    if (!user.playerId) throw forbidden('player.profile_required')
    if (!telegramEnabled || !config.TELEGRAM_BOT_USERNAME) throw conflict('telegram.disabled')
    const count = await db.selectFrom('telegram_accounts').select((eb) => eb.fn.countAll<number>().as('n')).where('player_id', '=', user.playerId).executeTakeFirstOrThrow()
    if (Number(count.n) >= MAX_ACCOUNTS) throw conflict('telegram.too_many_accounts')
    const token = randomBytes(12).toString('base64url')
    await db.insertInto('telegram_bind_tokens').values({ token, player_id: user.playerId, expires_at: new Date(Date.now() + 30 * 60_000) }).execute()
    res.json({ url: `https://t.me/${config.TELEGRAM_BOT_USERNAME}?start=${token}` })
  }),
)

notificationsRouter.delete(
  '/telegram/:chatId',
  handler(async (req, res) => {
    const user = requireUser(req)
    if (!user.playerId) throw forbidden('player.profile_required')
    await db.deleteFrom('telegram_accounts').where('player_id', '=', user.playerId).where('chat_id', '=', Number(req.params.chatId)).execute()
    res.status(204).end()
  }),
)

notificationsRouter.post(
  '/subscriptions',
  handler(async (req, res) => {
    const user = requireUser(req)
    const body = parseBody(z.discriminatedUnion('kind', [z.object({ kind: z.literal('club'), clubId: z.number().int() }), z.object({ kind: z.literal('rating') })]), req)
    const clubId = body.kind === 'club' ? body.clubId : null
    if (clubId && !(await db.selectFrom('clubs').select('id').where('id', '=', clubId).executeTakeFirst())) throw notFound('club.not_found')
    await db
      .insertInto('subscriptions')
      .values({ user_id: user.id, kind: body.kind, club_id: clubId })
      .onConflict((oc) => oc.expression(sql`user_id, kind, coalesce(club_id, 0)`).doNothing())
      .execute()
    res.status(201).json({ ok: true })
  }),
)

notificationsRouter.delete(
  '/subscriptions/:id',
  handler(async (req, res) => {
    const user = requireUser(req)
    await db.deleteFrom('subscriptions').where('id', '=', intParam(req, 'id')).where('user_id', '=', user.id).execute()
    res.status(204).end()
  }),
)

/** Organiser view: which participants can be reached in Telegram and whose bot is blocked. */
notificationsRouter.get(
  '/tournaments/:id/telegram',
  handler(async (req, res) => {
    const id = intParam(req, 'id')
    const t = await db.selectFrom('tournaments').select(['club_id']).where('id', '=', id).executeTakeFirst()
    if (!t) throw notFound('tournament.not_found')
    await requireClubRight(req, t.club_id, 'conduct', { tournamentId: id })
    const rows = await db
      .selectFrom('entries as e')
      .innerJoin('players as p', 'p.id', 'e.player_id')
      .leftJoin('telegram_accounts as a', 'a.player_id', 'p.id')
      .select(['p.id', 'p.first_name', 'p.last_name', 'a.chat_id', 'a.stopped', 'a.blocked_at'])
      .where('e.tournament_id', '=', id)
      .execute()
    const byPlayer = new Map<number, { playerId: number; name: string; status: 'none' | 'ok' | 'stopped' | 'blocked' }>()
    for (const r of rows) {
      const status = r.chat_id == null ? 'none' : r.blocked_at ? 'blocked' : r.stopped ? 'stopped' : 'ok'
      const prev = byPlayer.get(r.id)
      if (!prev || prev.status !== 'ok') byPlayer.set(r.id, { playerId: r.id, name: `${r.last_name} ${r.first_name}`, status: prev?.status === 'ok' ? 'ok' : status })
    }
    res.json([...byPlayer.values()])
  }),
)

/** Delivery latency (p50/p95) per type and channel over the last 7 days. */
notificationsRouter.get(
  '/stats',
  handler(async (req, res) => {
    requirePlatformAdmin(req)
    const rows = await db
      .selectFrom('notification_log')
      .select([
        'type',
        'channel',
        sql<number>`count(*) filter (where status = 'sent')`.as('sent'),
        sql<number>`count(*) filter (where status = 'failed')`.as('failed'),
        sql<number>`count(*) filter (where status = 'skipped')`.as('skipped'),
        sql<number | null>`percentile_cont(0.5) within group (order by latency_ms) filter (where status = 'sent')`.as('p50'),
        sql<number | null>`percentile_cont(0.95) within group (order by latency_ms) filter (where status = 'sent')`.as('p95'),
      ])
      .where('created_at', '>', new Date(Date.now() - 7 * 86400_000))
      .groupBy(['type', 'channel'])
      .execute()
    res.json(rows.map((r) => ({ ...r, sent: Number(r.sent), failed: Number(r.failed), skipped: Number(r.skipped), p50: r.p50 == null ? null : Math.round(r.p50), p95: r.p95 == null ? null : Math.round(r.p95) })))
  }),
)

