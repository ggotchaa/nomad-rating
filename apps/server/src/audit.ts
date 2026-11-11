// Audit log (spec 2, 4.8 A-5): who, when, what it was and what it became.

import type { Db, Transaction } from './db/index.ts'
import { db as defaultDb, json } from './db/index.ts'
import type { Database } from './db/types.ts'

export type AuditEntry = {
  actorUserId: number | null
  clubId?: number | null
  entity: string
  entityId: string | number
  action: string
  before?: unknown
  after?: unknown
  reason?: string | null
}

export async function audit(entry: AuditEntry, executor: Db | Transaction<Database> = defaultDb): Promise<void> {
  await executor
    .insertInto('audit_log')
    .values({
      actor_user_id: entry.actorUserId,
      club_id: entry.clubId ?? null,
      entity: entry.entity,
      entity_id: String(entry.entityId),
      action: entry.action,
      before: entry.before === undefined ? null : json(entry.before),
      after: entry.after === undefined ? null : json(entry.after),
      reason: entry.reason ?? null,
    })
    .execute()
}
