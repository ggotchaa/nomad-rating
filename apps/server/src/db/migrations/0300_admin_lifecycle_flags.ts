import { sql } from 'kysely'
import type { Kysely } from 'kysely'

// Admin lifecycle: test flag, archive (hidden from public lists), postponement, planned match time.

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE tournaments
      ADD COLUMN is_test boolean NOT NULL DEFAULT false,
      ADD COLUMN archived_at timestamptz,
      ADD COLUMN postponed_at timestamptz,
      ADD COLUMN postponed_reason text;
    ALTER TABLE matches ADD COLUMN scheduled_at timestamptz;
  `.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE tournaments DROP COLUMN is_test, DROP COLUMN archived_at, DROP COLUMN postponed_at, DROP COLUMN postponed_reason;
    ALTER TABLE matches DROP COLUMN scheduled_at;
  `.execute(db)
}
