import { sql } from 'kysely'
import type { Kysely } from 'kysely'

// Underfill warning / organiser acknowledgement; retirement reason; group matches excluded from the table.

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE tournaments ADD COLUMN underfill_warned_at timestamptz, ADD COLUMN underfill_ack_at timestamptz;
    ALTER TABLE matches ADD COLUMN result_note text, ADD COLUMN excluded boolean NOT NULL DEFAULT false;
  `.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE tournaments DROP COLUMN underfill_warned_at, DROP COLUMN underfill_ack_at;
    ALTER TABLE matches DROP COLUMN result_note, DROP COLUMN excluded;
  `.execute(db)
}
