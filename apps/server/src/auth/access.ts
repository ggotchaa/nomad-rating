// Club rights (spec 2): the organiser has every right, a helper only the ticked ones and only
// inside his scope (whole club, some halls, some tournaments). Checked on the server for every route.

import type { Request } from 'express'
import { CLUB_RIGHTS } from '@nomad/shared'
import type { ClubRight } from '@nomad/shared'
import { db } from '../db/index.ts'
import { forbidden, unauthorized } from '../http/errors.ts'
import type { SessionUser } from './sessions.ts'

export function requireUser(req: Request): SessionUser {
  if (!req.user) throw unauthorized()
  return req.user
}

export function requirePlatformAdmin(req: Request): SessionUser {
  const user = requireUser(req)
  if (user.platformRole !== 'admin') throw forbidden()
  return user
}

export type ClubScopeTarget = { hallId?: number; tournamentId?: number }

export type ClubAccessResult = { role: 'organizer' | 'helper'; rights: ClubRight[] }

export async function clubAccess(userId: number, clubId: number): Promise<ClubAccessResult | null> {
  const member = await db
    .selectFrom('club_members')
    .select(['role', 'rights', 'scope'])
    .where('club_id', '=', clubId)
    .where('user_id', '=', userId)
    .executeTakeFirst()
  if (!member) return null
  if (member.role === 'organizer') return { role: 'organizer', rights: [...CLUB_RIGHTS] }
  return { role: 'helper', rights: member.rights.filter((r): r is ClubRight => (CLUB_RIGHTS as readonly string[]).includes(r)) }
}

/** Throws 403 unless the user has `right` in `clubId` (and the target is inside a helper's scope). */
export async function requireClubRight(
  req: Request,
  clubId: number,
  right: ClubRight | 'organizer_only',
  target: ClubScopeTarget = {},
): Promise<SessionUser> {
  const user = requireUser(req)
  const member = await db
    .selectFrom('club_members')
    .select(['role', 'rights', 'scope'])
    .where('club_id', '=', clubId)
    .where('user_id', '=', user.id)
    .executeTakeFirst()
  if (!member) throw forbidden('club.not_member')
  if (member.role === 'organizer') return user
  if (right === 'organizer_only' || !member.rights.includes(right)) throw forbidden('club.right_missing')
  const scope = member.scope
  if (scope.kind === 'halls' && target.hallId != null && !scope.ids?.includes(target.hallId)) throw forbidden('club.out_of_scope')
  if (scope.kind === 'tournaments' && (target.tournamentId == null || !scope.ids?.includes(target.tournamentId)))
    throw forbidden('club.out_of_scope')
  return user
}
