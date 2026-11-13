import { sql } from 'kysely'
import type { Kysely } from 'kysely'

// R-26: per-member check-in for pair/team entries.

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE entries ADD COLUMN checked_in_players integer[] NOT NULL DEFAULT '{}'`.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE entries DROP COLUMN checked_in_players`.execute(db)
}
