// Account flows (R-1, R-21, R-30): e-mail confirmation, password reset, sign-in methods, Google OIDC,
// first-login questionnaire, admin TOTP, own profile and photo, active club.

import { Router } from 'express'
import express from 'express'
import { Google, decodeIdToken, generateCodeVerifier, generateState } from 'arctic'
import { generateSecret, generateURI, verify } from 'otplib'
import { z } from 'zod'
import { START_LEVELS, searchName } from '@nomad/shared'
import { config } from '../config.ts'
import { db, json } from '../db/index.ts'
import type { Transaction } from '../db/index.ts'
import type { Database } from '../db/types.ts'
import { audit } from '../audit.ts'
import { hashPassword, verifyPassword } from '../auth/password.ts'
import { createSession, sessionDigest, SESSION_COOKIE } from '../auth/sessions.ts'
import { requireUser } from '../auth/access.ts'
import { consumeToken, issueToken } from '../auth/tokens.ts'
import { badRequest, conflict, forbidden, handler, notFound, unauthorized } from '../http/errors.ts'
import { parseBody } from '../http/validate.ts'
import { mails, sendMail, siteLink } from '../mail/index.ts'
import { IMAGE_MAX_BYTES, IMAGE_TYPES, removeFile, saveFile } from '../storage/index.ts'
import { currentUserView, limiter } from './auth.ts'

export const accountRouter = Router()
export const myAccountRouter = Router()

const password = z.string().min(8).max(200)
const birthYear = z.number().int().min(1920).max(new Date().getFullYear() - 5)

const userView = async (userId: number, req: express.Request) =>
  currentUserView(userId, req.user ? { activeClubId: req.user.activeClubId, mfaVerified: req.user.mfaVerified } : undefined)

// --- E-mail confirmation and password reset ---------------------------------------

accountRouter.post(
  '/confirm-email',
  limiter,
  handler(async (req, res) => {
    const { token } = parseBody(z.object({ token: z.string().min(10).max(100) }), req)
    const userId = await consumeToken(token, 'verify_email')
    await db.updateTable('users').set({ email_verified_at: new Date() }).where('id', '=', userId).where('email_verified_at', 'is', null).execute()
    await audit({ actorUserId: userId, entity: 'user', entityId: userId, action: 'email_verified' })
    res.json({ ok: true })
  }),
)

accountRouter.post(
  '/resend-confirmation',
  limiter,
  handler(async (req, res) => {
    const user = requireUser(req)
    const row = await db.selectFrom('users').select(['email', 'email_verified_at']).where('id', '=', user.id).executeTakeFirstOrThrow()
    if (!row.email_verified_at) await sendMail(mails.confirmEmail(row.email, await issueToken(user.id, 'verify_email')))
    res.status(204).end()
  }),
)

accountRouter.post(
  '/forgot-password',
  limiter,
  handler(async (req, res) => {
    const { email } = parseBody(z.object({ email: z.email() }), req)
    const user = await db
      .selectFrom('users')
      .select(['id', 'email'])
      .where((eb) => eb(eb.fn('lower', ['email']), '=', email.toLowerCase()))
      .where('blocked_at', 'is', null)
      .executeTakeFirst()
    // Same answer whether the account exists or not.
    if (user) await sendMail(mails.resetPassword(user.email, await issueToken(user.id, 'reset_password')))
    res.status(204).end()
  }),
)

accountRouter.post(
  '/reset-password',
  limiter,
  handler(async (req, res) => {
    const body = parseBody(z.object({ token: z.string().min(10).max(100), password }), req)
    const userId = await consumeToken(body.token, 'reset_password')
    // The link came by e-mail, so the address is confirmed too.
    const passwordHash = await hashPassword(body.password)
    await db
      .updateTable('users')
      .set((eb) => ({ password_hash: passwordHash, email_verified_at: eb.fn.coalesce('email_verified_at', eb.val(new Date())) }))
      .where('id', '=', userId)
      .execute()
    await db.deleteFrom('sessions').where('user_id', '=', userId).execute()
    await audit({ actorUserId: userId, entity: 'user', entityId: userId, action: 'password_reset' })
    await createSession(res, userId, req.get('user-agent'))
    res.json(await currentUserView(userId))
  }),
)

// --- Sign-in methods ----------------------------------------------------------

accountRouter.put(
  '/password',
  handler(async (req, res) => {
    const user = requireUser(req)
    const body = parseBody(z.object({ current: z.string().max(200).optional(), password }), req)
    const row = await db.selectFrom('users').select('password_hash').where('id', '=', user.id).executeTakeFirstOrThrow()
    if (row.password_hash && !(await verifyPassword(body.current ?? '', row.password_hash))) throw unauthorized('auth.invalid_credentials')
    await db.updateTable('users').set({ password_hash: await hashPassword(body.password) }).where('id', '=', user.id).execute()
    await db.deleteFrom('sessions').where('user_id', '=', user.id).where('id', '<>', user.sessionId).execute()
    await audit({ actorUserId: user.id, entity: 'user', entityId: user.id, action: row.password_hash ? 'password_change' : 'password_set' })
    res.json(await userView(user.id, req))
  }),
)

/** Removes a sign-in method; at least one must remain. */
accountRouter.delete(
  '/methods/:method',
  handler(async (req, res) => {
    const user = requireUser(req)
    const method = z.enum(['password', 'google']).parse(req.params.method)
    const row = await db.selectFrom('users').select(['password_hash', 'google_sub']).where('id', '=', user.id).executeTakeFirstOrThrow()
    const other = method === 'password' ? row.google_sub : row.password_hash
    if (!other) throw conflict('auth.last_method')
    await db
      .updateTable('users')
      .set(method === 'password' ? { password_hash: null } : { google_sub: null })
      .where('id', '=', user.id)
      .execute()
    await audit({ actorUserId: user.id, entity: 'user', entityId: user.id, action: `unlink_${method}` })
    res.json(await userView(user.id, req))
  }),
)

// --- Google (OpenID Connect) ----------------------------------------------------------

const googleEnabled = () => Boolean(config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET)
const google = () =>
  new Google(config.GOOGLE_CLIENT_ID, config.GOOGLE_CLIENT_SECRET, config.GOOGLE_REDIRECT_URI || siteLink('/api/auth/google/callback'))

/** Only same-site relative paths, never `//host`. */
export const safeReturnTo = (value: unknown): string | null =>
  typeof value === 'string' && /^\/(?!\/)[^\s\\]*$/.test(value) && value.length < 500 ? value : null

const OAUTH_COOKIE = { httpOnly: true, sameSite: 'lax' as const, secure: config.NODE_ENV === 'production', maxAge: 10 * 60000, path: '/api/auth/google' }

accountRouter.get('/providers', (_req, res) => {
  res.json({ google: googleEnabled() })
})

accountRouter.get('/google', (req, res) => {
  if (!googleEnabled()) throw notFound('auth.google_disabled')
  const state = generateState()
  const verifier = generateCodeVerifier()
  const url = google().createAuthorizationURL(state, verifier, ['openid', 'email', 'profile'])
  url.searchParams.set('prompt', 'select_account')
  res.cookie('g_state', state, OAUTH_COOKIE)
  res.cookie('g_verifier', verifier, OAUTH_COOKIE)
  res.cookie('g_return', safeReturnTo(req.query.returnTo) ?? '', OAUTH_COOKIE)
  res.redirect(url.toString())
})

type GoogleClaims = { sub: string; email?: string; email_verified?: boolean }

async function claimClubProfileByEmail(trx: Transaction<Database>, userId: number, email: string): Promise<void> {
  const profile = await trx
    .selectFrom('players')
    .select('id')
    .where('user_id', 'is', null)
    .where((eb) => eb(eb.fn('lower', ['contact_email']), '=', email.toLowerCase()))
    .executeTakeFirst()
  if (!profile) return
  await trx.updateTable('players').set({ user_id: userId, claim_code: null, updated_at: new Date() }).where('id', '=', profile.id).execute()
  await audit({ actorUserId: userId, entity: 'player', entityId: profile.id, action: 'claim_by_email' }, trx)
}

accountRouter.get(
  '/google/callback',
  handler(async (req, res) => {
    if (!googleEnabled()) throw notFound('auth.google_disabled')
    const cookies = req.cookies as Record<string, string | undefined>
    const returnTo = safeReturnTo(cookies.g_return)
    for (const name of ['g_state', 'g_verifier', 'g_return']) res.clearCookie(name, { path: OAUTH_COOKIE.path })
    const fail = (code: string) => res.redirect(siteLink(`/login?error=${encodeURIComponent(code)}`))
    if (!cookies.g_state || cookies.g_state !== req.query.state || !cookies.g_verifier || typeof req.query.code !== 'string') return fail('auth.google_failed')
    let claims: GoogleClaims
    try {
      const tokens = await google().validateAuthorizationCode(req.query.code, cookies.g_verifier)
      claims = decodeIdToken(tokens.idToken()) as GoogleClaims
    } catch {
      return fail('auth.google_failed')
    }
    if (!claims.email || !claims.email_verified) return fail('auth.google_unverified')
    const email = claims.email

    // Linking from the security page of a signed-in user.
    if (req.user) {
      const taken = await db.selectFrom('users').select('id').where('google_sub', '=', claims.sub).executeTakeFirst()
      if (taken && taken.id !== req.user.id) return res.redirect(siteLink('/me/security?error=auth.google_taken'))
      await db.updateTable('users').set({ google_sub: claims.sub }).where('id', '=', req.user.id).execute()
      await audit({ actorUserId: req.user.id, entity: 'user', entityId: req.user.id, action: 'link_google' })
      return res.redirect(siteLink('/me/security'))
    }

    const userId = await db.transaction().execute(async (trx) => {
      const bySub = await trx.selectFrom('users').select(['id', 'blocked_at']).where('google_sub', '=', claims.sub).executeTakeFirst()
      if (bySub) return bySub.blocked_at ? null : bySub.id
      const byEmail = await trx
        .selectFrom('users')
        .select(['id', 'blocked_at'])
        .where((eb) => eb(eb.fn('lower', ['email']), '=', email.toLowerCase()))
        .executeTakeFirst()
      if (byEmail) {
        if (byEmail.blocked_at) return null
        // Google verified the address: link to the existing account.
        await trx
          .updateTable('users')
          .set((eb) => ({ google_sub: claims.sub, email_verified_at: eb.fn.coalesce('email_verified_at', eb.val(new Date())) }))
          .where('id', '=', byEmail.id)
          .execute()
        await audit({ actorUserId: byEmail.id, entity: 'user', entityId: byEmail.id, action: 'link_google' }, trx)
        return byEmail.id
      }
      const user = await trx.insertInto('users').values({ email, google_sub: claims.sub, email_verified_at: new Date() }).returning('id').executeTakeFirstOrThrow()
      await claimClubProfileByEmail(trx, user.id, email)
      await audit({ actorUserId: user.id, entity: 'user', entityId: user.id, action: 'register_google' }, trx)
      return user.id
    })
    if (!userId) return fail('auth.invalid_credentials')
    await createSession(res, userId, req.get('user-agent'))
    const state = await db
      .selectFrom('users as u')
      .leftJoin('players as p', 'p.user_id', 'u.id')
      .select(['u.consent_at', 'p.id as player_id'])
      .where('u.id', '=', userId)
      .executeTakeFirstOrThrow()
    const target = returnTo ?? '/me'
    if (!state.player_id || !state.consent_at) return res.redirect(siteLink(`/welcome?returnTo=${encodeURIComponent(target)}`))
    res.redirect(siteLink(target))
  }),
)

// --- First-login questionnaire (accounts without a player profile) ---------------------

const questionnaire = z.object({
  consent: z.literal(true),
  profile: z
    .object({
      firstName: z.string().trim().min(1).max(80),
      lastName: z.string().trim().min(1).max(80),
      middleName: z.string().trim().max(80).optional(),
      gender: z.enum(['m', 'f']),
      birthYear,
      cityId: z.number().int().positive(),
      hand: z.enum(['right', 'left']).optional(),
      startLevel: z.enum(Object.keys(START_LEVELS) as [keyof typeof START_LEVELS]).default('amateur'),
    })
    .optional(),
})

accountRouter.post(
  '/welcome',
  handler(async (req, res) => {
    const user = requireUser(req)
    const body = parseBody(questionnaire, req)
    await db.transaction().execute(async (trx) => {
      await trx.updateTable('users').set({ consent_at: new Date() }).where('id', '=', user.id).execute()
      const existing = await trx.selectFrom('players').select('id').where('user_id', '=', user.id).executeTakeFirst()
      if (existing) return
      const p = body.profile
      if (!p) throw badRequest('player.profile_required')
      const player = await trx
        .insertInto('players')
        .values({
          user_id: user.id,
          first_name: p.firstName,
          last_name: p.lastName,
          middle_name: p.middleName ?? null,
          gender: p.gender,
          birth_year: p.birthYear,
          city_id: p.cityId,
          hand: p.hand ?? null,
          start_level: START_LEVELS[p.startLevel],
          search_name: searchName(p),
        })
        .returning('id')
        .executeTakeFirstOrThrow()
      await trx.insertInto('player_ratings').values({ player_id: player.id, kind: 'singles', rating: null, calibration: json({ tournaments: 0 }) }).execute()
      await audit({ actorUserId: user.id, entity: 'player', entityId: player.id, action: 'create_profile' }, trx)
    })
    res.json(await userView(user.id, req))
  }),
)

// --- Platform admin TOTP ---------------------------------------------------------------

const code = z.object({ code: z.string().regex(/^\d{6}$/) })

async function checkTotp(userId: number, token: string): Promise<{ enabled: boolean }> {
  const row = await db.selectFrom('users').select(['totp_secret', 'totp_enabled_at']).where('id', '=', userId).executeTakeFirstOrThrow()
  if (!row.totp_secret) throw conflict('auth.mfa_not_set_up')
  const result = await verify({ secret: row.totp_secret, token, epochTolerance: 30 })
  if (!result.valid) throw badRequest('auth.mfa_invalid')
  return { enabled: row.totp_enabled_at != null }
}

const markSessionVerified = (token: string | undefined) =>
  token ? db.updateTable('sessions').set({ mfa_verified_at: new Date() }).where('id', '=', sessionDigest(token)).execute() : Promise.resolve()

accountRouter.post(
  '/2fa/setup',
  handler(async (req, res) => {
    const user = requireUser(req)
    if (user.platformRole !== 'admin') throw forbidden()
    if (user.totpEnabled) throw conflict('auth.mfa_already_enabled')
    const secret = generateSecret()
    await db.updateTable('users').set({ totp_secret: secret }).where('id', '=', user.id).execute()
    res.json({ secret, uri: generateURI({ issuer: 'Nomad', label: user.email, secret }) })
  }),
)

accountRouter.post(
  '/2fa/enable',
  limiter,
  handler(async (req, res) => {
    const user = requireUser(req)
    const { code: token } = parseBody(code, req)
    await checkTotp(user.id, token)
    await db.updateTable('users').set({ totp_enabled_at: new Date() }).where('id', '=', user.id).execute()
    await markSessionVerified(req.cookies?.[SESSION_COOKIE] as string | undefined)
    await audit({ actorUserId: user.id, entity: 'user', entityId: user.id, action: 'mfa_enabled' })
    res.json(await currentUserView(user.id, { activeClubId: user.activeClubId, mfaVerified: true }))
  }),
)

accountRouter.post(
  '/2fa/verify',
  limiter,
  handler(async (req, res) => {
    const user = requireUser(req)
    const { code: token } = parseBody(code, req)
    const { enabled } = await checkTotp(user.id, token)
    if (!enabled) throw conflict('auth.mfa_not_set_up')
    await markSessionVerified(req.cookies?.[SESSION_COOKIE] as string | undefined)
    res.json(await currentUserView(user.id, { activeClubId: user.activeClubId, mfaVerified: true }))
  }),
)

accountRouter.post(
  '/2fa/disable',
  limiter,
  handler(async (req, res) => {
    const user = requireUser(req)
    const { code: token } = parseBody(code, req)
    await checkTotp(user.id, token)
    if (config.ADMIN_2FA_REQUIRED && user.platformRole === 'admin') throw conflict('auth.mfa_required')
    await db.updateTable('users').set({ totp_secret: null, totp_enabled_at: null }).where('id', '=', user.id).execute()
    await audit({ actorUserId: user.id, entity: 'user', entityId: user.id, action: 'mfa_disabled' })
    res.json(await userView(user.id, req))
  }),
)

// --- Own profile, photo, active club ---------------------------------------------------

const profileUpdate = z.object({
  firstName: z.string().trim().min(1).max(80).optional(),
  lastName: z.string().trim().min(1).max(80).optional(),
  middleName: z.string().trim().max(80).nullable().optional(),
  gender: z.enum(['m', 'f']).optional(),
  birthYear: birthYear.optional(),
  cityId: z.number().int().positive().optional(),
  hand: z.enum(['right', 'left']).nullable().optional(),
  startLevel: z.enum(Object.keys(START_LEVELS) as [keyof typeof START_LEVELS]).optional(),
})

myAccountRouter.patch(
  '/profile',
  handler(async (req, res) => {
    const user = requireUser(req)
    if (!user.playerId) throw forbidden('player.profile_required')
    const body = parseBody(profileUpdate, req)
    const before = await db.selectFrom('players').selectAll().where('id', '=', user.playerId).executeTakeFirstOrThrow()
    if (body.startLevel) {
      // R-2: the start level only matters until the first rating.
      const rating = await db.selectFrom('player_ratings').select('rating').where('player_id', '=', before.id).where('kind', '=', 'singles').executeTakeFirst()
      if (rating?.rating != null) throw conflict('player.start_level_locked')
    }
    const name = {
      firstName: body.firstName ?? before.first_name,
      lastName: body.lastName ?? before.last_name,
      middleName: body.middleName === undefined ? before.middle_name : body.middleName,
    }
    await db
      .updateTable('players')
      .set({
        first_name: name.firstName,
        last_name: name.lastName,
        middle_name: name.middleName,
        search_name: searchName(name),
        ...(body.gender && { gender: body.gender }),
        ...(body.birthYear && { birth_year: body.birthYear }),
        ...(body.cityId && { city_id: body.cityId }),
        ...(body.hand !== undefined && { hand: body.hand }),
        ...(body.startLevel && { start_level: START_LEVELS[body.startLevel] }),
        updated_at: new Date(),
      })
      .where('id', '=', before.id)
      .execute()
    await audit({ actorUserId: user.id, entity: 'player', entityId: before.id, action: 'update_profile', after: body })
    res.json(await userView(user.id, req))
  }),
)

myAccountRouter.post(
  '/photo',
  express.raw({ type: Object.keys(IMAGE_TYPES), limit: IMAGE_MAX_BYTES }),
  handler(async (req, res) => {
    const user = requireUser(req)
    if (!user.playerId) throw forbidden('player.profile_required')
    const ext = IMAGE_TYPES[req.get('content-type')?.split(';')[0]?.trim() ?? '']
    if (!ext || !Buffer.isBuffer(req.body) || req.body.length === 0) throw badRequest('upload.invalid_type')
    const url = await saveFile('photos', req.body, ext)
    await db.updateTable('players').set({ photo_url: url, updated_at: new Date() }).where('id', '=', user.playerId).execute()
    await audit({ actorUserId: user.id, entity: 'player', entityId: user.playerId, action: 'photo', after: { url } })
    res.json({ photoUrl: url })
  }),
)

myAccountRouter.put(
  '/active-club',
  handler(async (req, res) => {
    const user = requireUser(req)
    const { clubId } = parseBody(z.object({ clubId: z.number().int().positive() }), req)
    const member = await db.selectFrom('club_members').select('club_id').where('club_id', '=', clubId).where('user_id', '=', user.id).executeTakeFirst()
    if (!member) throw forbidden('club.not_member')
    await db.updateTable('sessions').set({ active_club_id: clubId }).where('id', '=', user.sessionId).execute()
    res.json({ activeClubId: clubId })
  }),
)

myAccountRouter.put(
  '/locale',
  handler(async (req, res) => {
    const user = requireUser(req)
    const { locale } = parseBody(z.object({ locale: z.enum(['ru', 'kk', 'en']) }), req)
    await db.updateTable('users').set({ locale }).where('id', '=', user.id).execute()
    await audit({ actorUserId: user.id, entity: 'user', entityId: user.id, action: 'locale', after: { locale } })
    res.json({ locale })
  }),
)

// --- Account deletion: personal data is erased, sports history stays under an anonymous profile ---

accountRouter.post(
  '/account/delete',
  limiter,
  handler(async (req, res) => {
    const user = requireUser(req)
    const body = parseBody(z.object({ password: z.string().max(200), code: z.string().max(6).optional() }), req)
    const row = await db.selectFrom('users').select(['password_hash', 'platform_role', 'totp_enabled_at']).where('id', '=', user.id).executeTakeFirstOrThrow()
    if (!row.password_hash) throw conflict('auth.delete_needs_password')
    if (!(await verifyPassword(body.password, row.password_hash))) throw unauthorized('auth.invalid_credentials')
    if (row.totp_enabled_at) await checkTotp(user.id, body.code ?? '')
    if (row.platform_role === 'admin') throw conflict('auth.delete_admin')
    const organizer = await db.selectFrom('club_members').select('club_id').where('user_id', '=', user.id).where('role', '=', 'organizer').executeTakeFirst()
    if (organizer) throw conflict('auth.delete_organizer')

    const photo = await db.transaction().execute(async (trx) => {
      const player = await trx.selectFrom('players').select(['id', 'photo_url']).where('user_id', '=', user.id).executeTakeFirst()
      if (player) {
        await trx.deleteFrom('telegram_accounts').where('player_id', '=', player.id).execute()
        await trx.deleteFrom('telegram_bind_tokens').where('player_id', '=', player.id).execute()
        await trx.deleteFrom('team_invitations').where('player_id', '=', player.id).where('status', '=', 'sent').execute()
        await trx.updateTable('rttf_profiles').set({ player_id: null }).where('player_id', '=', player.id).execute()
        await trx
          .updateTable('players')
          .set({ user_id: null, first_name: 'Удалённый', last_name: 'игрок', middle_name: null, hand: null, photo_url: null, claim_code: null, contact_email: null, search_name: 'удаленный игрок', updated_at: new Date() })
          .where('id', '=', player.id)
          .execute()
      }
      await trx.deleteFrom('sessions').where('user_id', '=', user.id).execute()
      await trx.deleteFrom('auth_tokens').where('user_id', '=', user.id).execute()
      await trx.deleteFrom('push_subscriptions').where('user_id', '=', user.id).execute()
      await trx.deleteFrom('notifications').where('user_id', '=', user.id).execute()
      await trx.deleteFrom('notification_prefs').where('user_id', '=', user.id).execute()
      await trx.deleteFrom('subscriptions').where('user_id', '=', user.id).execute()
      await trx.deleteFrom('club_members').where('user_id', '=', user.id).execute()
      await trx
        .updateTable('users')
        .set({ email: `deleted-${user.id}@deleted.invalid`, email_verified_at: null, password_hash: null, google_sub: null, totp_secret: null, totp_enabled_at: null, blocked_at: new Date() })
        .where('id', '=', user.id)
        .execute()
      await audit({ actorUserId: user.id, entity: 'user', entityId: user.id, action: 'account_deleted', after: { playerId: player?.id ?? null } }, trx)
      return player?.photo_url ?? null
    })
    if (photo) await removeFile(photo)
    res.clearCookie(SESSION_COOKIE, { path: '/' })
    res.status(204).end()
  }),
)
