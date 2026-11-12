// One-time tokens: the user gets a random token, the database keeps its SHA-256.

import { createHash, randomBytes } from 'node:crypto'
import { db } from '../db/index.ts'
import type { AuthTokensTable } from '../db/types.ts'
import { badRequest } from '../http/errors.ts'

export const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex')
export const newToken = () => randomBytes(32).toString('base64url')

type Kind = AuthTokensTable['kind']

const TTL: Record<Kind, number> = { verify_email: 48 * 3600000, reset_password: 3600000 }

export async function issueToken(userId: number, kind: Kind): Promise<string> {
  const token = newToken()
  await db.updateTable('auth_tokens').set({ used_at: new Date() }).where('user_id', '=', userId).where('kind', '=', kind).where('used_at', 'is', null).execute()
  await db.insertInto('auth_tokens').values({ user_id: userId, kind, token_hash: tokenHash(token), expires_at: new Date(Date.now() + TTL[kind]) }).execute()
  return token
}

/** Marks the token used and returns its user; throws `auth.token_invalid` when unknown, used or expired. */
export async function consumeToken(token: string, kind: Kind): Promise<number> {
  const row = await db
    .updateTable('auth_tokens')
    .set({ used_at: new Date() })
    .where('token_hash', '=', tokenHash(token))
    .where('kind', '=', kind)
    .where('used_at', 'is', null)
    .where('expires_at', '>', new Date())
    .returning('user_id')
    .executeTakeFirst()
  if (!row) throw badRequest('auth.token_invalid')
  return row.user_id
}
