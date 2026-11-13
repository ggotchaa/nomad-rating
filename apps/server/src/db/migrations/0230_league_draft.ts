import { sql } from 'kysely'
import type { Kysely } from 'kysely'

// Leagues P1: division drafts with publication, warned skips and no-shows, waiting list,
// overall tour places, fixture technical results, play-off fixtures and Elo deltas.

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE league_seasons ADD COLUMN draft_pending boolean NOT NULL DEFAULT false;
    ALTER TABLE league_participants
      ADD COLUMN draft_division_id integer REFERENCES league_divisions(id) ON DELETE SET NULL,
      ADD COLUMN draft_reason text,
      ADD COLUMN no_shows int NOT NULL DEFAULT 0,
      ADD COLUMN freezes_used int NOT NULL DEFAULT 0,
      DROP CONSTRAINT IF EXISTS league_participants_status_check,
      ADD CONSTRAINT league_participants_status_check CHECK (status IN ('invited', 'active', 'frozen', 'left', 'declined', 'waiting'));
    ALTER TABLE league_results ADD COLUMN overall_place int, ADD COLUMN no_show boolean NOT NULL DEFAULT false;
    CREATE TABLE league_tour_skips (
      tour_id integer NOT NULL REFERENCES league_tours(id) ON DELETE CASCADE,
      participant_id integer NOT NULL REFERENCES league_participants(id) ON DELETE CASCADE,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (tour_id, participant_id)
    );
    ALTER TABLE league_fixtures
      ADD COLUMN kind text NOT NULL DEFAULT 'regular' CHECK (kind IN ('regular', 'playoff')),
      ADD COLUMN technical text CHECK (technical IN ('home', 'away', 'both')),
      ADD COLUMN rating_home int,
      ADD COLUMN rating_away int;
  `.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE league_fixtures DROP COLUMN kind, DROP COLUMN technical, DROP COLUMN rating_home, DROP COLUMN rating_away;
    DROP TABLE league_tour_skips;
    ALTER TABLE league_results DROP COLUMN overall_place, DROP COLUMN no_show;
    DELETE FROM league_participants WHERE status = 'waiting';
    ALTER TABLE league_participants DROP COLUMN draft_division_id, DROP COLUMN draft_reason, DROP COLUMN no_shows, DROP COLUMN freezes_used,
      DROP CONSTRAINT league_participants_status_check,
      ADD CONSTRAINT league_participants_status_check CHECK (status IN ('invited', 'active', 'frozen', 'left', 'declined'));
    ALTER TABLE league_seasons DROP COLUMN draft_pending;
  `.execute(db)
}
