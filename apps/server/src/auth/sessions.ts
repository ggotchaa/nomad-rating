// Cookie sessions: the browser keeps a random token, the database keeps its SHA-256.

import { createHash, randomBytes } from 'node:crypto'
import type { NextFunction, Request, Response } from 'express'
import { config } from '../config.ts'
import { db } from '../db/index.ts'
import type { ClubRight } from '@nomad/shared'

export const SESSION_COOKIE = 'nomad_session'

export type SessionUser = {
  id: number
  email: string
  platformRole: 'user' | 'admin'
  locale: 'ru' | 'kk' | 'en'
  playerId: number | null
  sessionId: string
  activeClubId: number | null
  totpEnabled: boolean
  mfaVerified: boolean
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: SessionUser
  }
}

const digest = (token: string) => createHash('sha256').update(token).digest('hex')

export const sessionDigest = (token: string) => digest(token)

export async function createSession(res: Response, userId: number, userAgent?: string): Promise<void> {
  const token = randomBytes(32).toString('base64url')
  const expires = new Date(Date.now() + config.SESSION_DAYS * 86400000)
  const member = await db
    .selectFrom('club_members')
    .select('club_id')
    .where('user_id', '=', userId)
    .orderBy('created_at')
    .executeTakeFirst()
  await db
    .insertInto('sessions')
    .values({
      id: digest(token),
      user_id: userId,
      expires_at: expires,
      user_agent: userAgent?.slice(0, 300) ?? null,
      active_club_id: member?.club_id ?? null,
    })
    .execute()
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.NODE_ENV === 'production',
    expires,
    path: '/',
  })
}

export async function destroySession(req: Request, res: Response): Promise<void> {
  const token = req.cookies?.[SESSION_COOKIE] as string | undefined
  if (token) await db.deleteFrom('sessions').where('id', '=', digest(token)).execute()
  res.clearCookie(SESSION_COOKIE, { path: '/' })
}

export async function userFromToken(token: string | undefined): Promise<SessionUser | undefined> {
  if (!token) return undefined
  const row = await db
    .selectFrom('sessions as s')
    .innerJoin('users as u', 'u.id', 's.user_id')
    .leftJoin('players as p', 'p.user_id', 'u.id')
    .select(['s.id as sessionId', 's.active_club_id', 'u.id', 'u.email', 'u.platform_role', 'u.locale', 'u.blocked_at', 'u.totp_enabled_at', 's.mfa_verified_at', 'p.id as playerId'])
    .where('s.id', '=', digest(token))
    .where('s.expires_at', '>', new Date())
    .executeTakeFirst()
  if (!row || row.blocked_at) return undefined
  return {
    id: row.id,
    email: row.email,
    platformRole: row.platform_role,
    locale: row.locale,
    playerId: row.playerId,
    sessionId: row.sessionId,
    activeClubId: row.active_club_id,
    totpEnabled: row.totp_enabled_at != null,
    mfaVerified: row.mfa_verified_at != null,
  }
}

/** Loads the user (if any) for every request. */
export async function sessionMiddleware(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    req.user = await userFromToken(req.cookies?.[SESSION_COOKIE] as string | undefined)
    next()
  } catch (e) {
    next(e)
  }
}

export type ClubAccess = { role: 'organizer' | 'helper' | 'platform_admin'; rights: ReadonlySet<ClubRight | string> }
