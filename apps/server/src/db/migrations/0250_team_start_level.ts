import { sql } from 'kysely'
import type { Kysely } from 'kysely'

// «Разрядник» waits for an organiser: requested_level is applied to start_level only when confirmed.

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE players
      ADD COLUMN requested_level integer,
      ADD COLUMN level_status text CHECK (level_status IN ('pending', 'confirmed', 'rejected'));
    CREATE INDEX players_level_pending ON players (level_status) WHERE level_status = 'pending';
  `.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE players DROP COLUMN requested_level, DROP COLUMN level_status`.execute(db)
}
