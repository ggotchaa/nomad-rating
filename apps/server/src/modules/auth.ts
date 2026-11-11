// Accounts (R-1): e-mail + password. Google sign-in, e-mail confirmation and password reset come in stage 1.

import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { z } from 'zod'
import { START_LEVELS, searchName } from '@nomad/shared'
import { db, json } from '../db/index.ts'
import { hashPassword, verifyPassword } from '../auth/password.ts'
import { createSession, destroySession } from '../auth/sessions.ts'
import { requireUser } from '../auth/access.ts'
import { conflict, handler, unauthorized } from '../http/errors.ts'
import { parseBody } from '../http/validate.ts'
import { audit } from '../audit.ts'

const registerSchema = z.object({
  email: z.email().max(200),
  password: z.string().min(8).max(200),
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  middleName: z.string().trim().max(80).optional(),
  gender: z.enum(['m', 'f']),
  birthYear: z.number().int().min(1920).max(new Date().getFullYear() - 5),
  cityId: z.number().int().positive(),
  hand: z.enum(['right', 'left']).optional(),
  startLevel: z.enum(Object.keys(START_LEVELS) as [keyof typeof START_LEVELS]).default('amateur'),
})

const loginSchema = z.object({ email: z.email(), password: z.string().min(1) })

const limiter = rateLimit({ windowMs: 15 * 60000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false })

export async function currentUserView(userId: number) {
  const user = await db.selectFrom('users').select(['id', 'email', 'platform_role', 'locale']).where('id', '=', userId).executeTakeFirstOrThrow()
  const player = await db
    .selectFrom('players as p')
    .leftJoin('cities as c', 'c.id', 'p.city_id')
    .leftJoin('player_ratings as r', (j) => j.onRef('r.player_id', '=', 'p.id').on('r.kind', '=', 'singles'))
    .select(['p.id', 'p.first_name', 'p.last_name', 'p.gender', 'p.birth_year', 'p.photo_url', 'p.start_level', 'c.name_ru as city', 'r.rating'])
    .where('p.user_id', '=', userId)
    .executeTakeFirst()
  const clubs = await db
    .selectFrom('club_members as m')
    .innerJoin('clubs as c', 'c.id', 'm.club_id')
    .select(['c.id', 'c.slug', 'c.name', 'm.role', 'm.rights'])
    .where('m.user_id', '=', userId)
    .execute()
  return { user: { id: user.id, email: user.email, role: user.platform_role, locale: user.locale }, player: player ?? null, clubs }
}

export const authRouter = Router()

authRouter.post(
  '/register',
  limiter,
  handler(async (req, res) => {
    const body = parseBody(registerSchema, req)
    const exists = await db.selectFrom('users').select('id').where((eb) => eb(eb.fn('lower', ['email']), '=', body.email.toLowerCase())).executeTakeFirst()
    if (exists) throw conflict('auth.email_taken')
    const passwordHash = await hashPassword(body.password)
    const userId = await db.transaction().execute(async (trx) => {
      const user = await trx.insertInto('users').values({ email: body.email, password_hash: passwordHash }).returning('id').executeTakeFirstOrThrow()
      // R-10: a profile the club created with this e-mail becomes the new account automatically.
      const clubProfile = await trx
        .selectFrom('players')
        .select('id')
        .where('user_id', 'is', null)
        .where((eb) => eb(eb.fn('lower', ['contact_email']), '=', body.email.toLowerCase()))
        .executeTakeFirst()
      if (clubProfile) {
        await trx.updateTable('players').set({ user_id: user.id, updated_at: new Date() }).where('id', '=', clubProfile.id).execute()
        await audit({ actorUserId: user.id, entity: 'player', entityId: clubProfile.id, action: 'claim_by_email' }, trx)
      } else {
        const player = await trx
          .insertInto('players')
          .values({
            user_id: user.id,
            first_name: body.firstName,
            last_name: body.lastName,
            middle_name: body.middleName ?? null,
            gender: body.gender,
            birth_year: body.birthYear,
            city_id: body.cityId,
            hand: body.hand ?? null,
            start_level: START_LEVELS[body.startLevel],
            search_name: searchName(body),
          })
          .returning('id')
          .executeTakeFirstOrThrow()
        await trx.insertInto('player_ratings').values({ player_id: player.id, kind: 'singles', rating: null, calibration: json({ tournaments: 0 }) }).execute()
      }
      return user.id
    })
    await createSession(res, userId, req.get('user-agent'))
    res.status(201).json(await currentUserView(userId))
  }),
)

authRouter.post(
  '/login',
  limiter,
  handler(async (req, res) => {
    const body = parseBody(loginSchema, req)
    const user = await db
      .selectFrom('users')
      .select(['id', 'password_hash', 'blocked_at'])
      .where((eb) => eb(eb.fn('lower', ['email']), '=', body.email.toLowerCase()))
      .executeTakeFirst()
    if (!user || user.blocked_at || !(await verifyPassword(body.password, user.password_hash))) throw unauthorized('auth.invalid_credentials')
    await createSession(res, user.id, req.get('user-agent'))
    res.json(await currentUserView(user.id))
  }),
)

authRouter.post(
  '/logout',
  handler(async (req, res) => {
    await destroySession(req, res)
    res.status(204).end()
  }),
)

authRouter.get(
  '/me',
  handler(async (req, res) => {
    if (!req.user) {
      res.json({ user: null, player: null, clubs: [] })
      return
    }
    res.json(await currentUserView(requireUser(req).id))
  }),
)
