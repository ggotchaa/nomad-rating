import { sql } from 'kysely'
import type { Kysely } from 'kysely'

// Stage 6: recurring blocks, booking cancel links and reminders, manual rating corrections.

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE recurring_blocks (
      id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      hall_id integer NOT NULL REFERENCES halls ON DELETE CASCADE,
      table_ids integer[] NOT NULL DEFAULT '{}',
      weekdays integer[] NOT NULL,
      start_minutes integer NOT NULL CHECK (start_minutes BETWEEN 0 AND 1439),
      end_minutes integer NOT NULL CHECK (end_minutes BETWEEN 0 AND 1440),
      valid_from text NOT NULL CHECK (valid_from ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
      valid_until text,
      kind text NOT NULL CHECK (kind IN ('training', 'closed', 'maintenance')),
      note text NOT NULL DEFAULT '',
      created_by integer REFERENCES users ON DELETE SET NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX recurring_blocks_hall ON recurring_blocks (hall_id);

    ALTER TABLE bookings
      ADD COLUMN cancel_token text UNIQUE DEFAULT md5(random()::text || clock_timestamp()::text),
      ADD COLUMN reminded_at timestamptz;

    CREATE TABLE rating_adjustments (
      id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      player_id integer NOT NULL REFERENCES players ON DELETE CASCADE,
      rating_before integer,
      rating_after integer NOT NULL,
      from_tournament_id integer REFERENCES tournaments ON DELETE SET NULL,
      reason text NOT NULL,
      created_by integer REFERENCES users ON DELETE SET NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX audit_log_at ON audit_log (at DESC);
  `.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    DROP INDEX IF EXISTS audit_log_at;
    DROP TABLE rating_adjustments;
    ALTER TABLE bookings DROP COLUMN cancel_token, DROP COLUMN reminded_at;
    DROP TABLE recurring_blocks;
  `.execute(db)
}
