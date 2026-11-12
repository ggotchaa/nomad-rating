import { sql } from 'kysely'
import type { Kysely } from 'kysely'

// Stage 2: series, check-in secret, call responses, score reports by players, result versions.

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE series (
      id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      club_id integer NOT NULL REFERENCES clubs ON DELETE CASCADE,
      name text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    ALTER TABLE tournaments
      ADD COLUMN checkin_secret text NOT NULL DEFAULT md5(random()::text || clock_timestamp()::text),
      ADD COLUMN copied_from integer REFERENCES tournaments ON DELETE SET NULL,
      ADD CONSTRAINT tournaments_series_fk FOREIGN KEY (series_id) REFERENCES series ON DELETE SET NULL;
    ALTER TABLE entries ADD COLUMN checked_in_at timestamptz;
    ALTER TABLE matches
      ADD COLUMN version integer NOT NULL DEFAULT 0,
      ADD COLUMN call_count integer NOT NULL DEFAULT 0,
      ADD COLUMN call_responses jsonb NOT NULL DEFAULT '{}',
      ADD COLUMN reported_score jsonb,
      ADD COLUMN reported_by integer REFERENCES entries,
      ADD COLUMN disputed boolean NOT NULL DEFAULT false;
    CREATE INDEX matches_called ON matches (status, called_at) WHERE status = 'called';
  `.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    DROP INDEX IF EXISTS matches_called;
    ALTER TABLE matches DROP COLUMN version, DROP COLUMN call_count, DROP COLUMN call_responses,
      DROP COLUMN reported_score, DROP COLUMN reported_by, DROP COLUMN disputed;
    ALTER TABLE entries DROP COLUMN checked_in_at;
    ALTER TABLE tournaments DROP CONSTRAINT tournaments_series_fk, DROP COLUMN checkin_secret, DROP COLUMN copied_from;
    DROP TABLE series;
  `.execute(db)
}
