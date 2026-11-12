import { sql } from 'kysely'
import type { Kysely } from 'kysely'

// Stage 5: pairs and teams with invitations, team meetings, leagues (seasons, divisions, tours, fixtures).

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE teams (
      id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      kind text NOT NULL CHECK (kind IN ('pair', 'team')),
      name text NOT NULL,
      captain_player_id integer NOT NULL REFERENCES players ON DELETE CASCADE,
      min_size integer NOT NULL,
      max_size integer NOT NULL,
      join_token text NOT NULL UNIQUE,
      approve_joins boolean NOT NULL DEFAULT false,
      payer text NOT NULL DEFAULT 'captain' CHECK (payer IN ('captain', 'each')),
      copied_from integer REFERENCES teams ON DELETE SET NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE team_members (
      team_id integer NOT NULL REFERENCES teams ON DELETE CASCADE,
      player_id integer NOT NULL REFERENCES players ON DELETE CASCADE,
      role text NOT NULL DEFAULT 'member' CHECK (role IN ('captain', 'member')),
      status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'left')),
      joined_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (team_id, player_id)
    );
    CREATE INDEX team_members_player ON team_members (player_id);
    CREATE TABLE team_invitations (
      id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      team_id integer NOT NULL REFERENCES teams ON DELETE CASCADE,
      player_id integer NOT NULL REFERENCES players ON DELETE CASCADE,
      direction text NOT NULL CHECK (direction IN ('invite', 'request')),
      status text NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'accepted', 'declined', 'expired', 'revoked')),
      invited_by integer REFERENCES users ON DELETE SET NULL,
      expires_at timestamptz NOT NULL,
      responded_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX team_invitations_open ON team_invitations (status, expires_at);
    CREATE UNIQUE INDEX team_invitations_one_open ON team_invitations (team_id, player_id) WHERE status = 'sent';

    ALTER TABLE entries ADD COLUMN team_id integer REFERENCES teams ON DELETE SET NULL, ADD COLUMN roster integer[];
    CREATE INDEX entries_team ON entries (team_id);

    CREATE TABLE meeting_lineups (
      match_id integer NOT NULL REFERENCES matches ON DELETE CASCADE,
      side text NOT NULL CHECK (side IN ('home', 'away')),
      lineup integer[] NOT NULL,
      submitted_by integer REFERENCES users ON DELETE SET NULL,
      by_organizer boolean NOT NULL DEFAULT false,
      submitted_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (match_id, side)
    );
    CREATE TABLE meeting_games (
      id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      match_id integer NOT NULL REFERENCES matches ON DELETE CASCADE,
      game_index integer NOT NULL,
      kind text NOT NULL CHECK (kind IN ('singles', 'doubles')),
      home_players integer[] NOT NULL,
      away_players integer[] NOT NULL,
      status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'called', 'finished', 'skipped')),
      table_id integer REFERENCES hall_tables ON DELETE SET NULL,
      called_at timestamptz,
      sets_home integer,
      sets_away integer,
      games jsonb NOT NULL DEFAULT '[]',
      winner text CHECK (winner IN ('home', 'away')),
      finished_at timestamptz,
      UNIQUE (match_id, game_index)
    );

    CREATE TABLE leagues (
      id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      club_id integer NOT NULL REFERENCES clubs ON DELETE CASCADE,
      slug text NOT NULL UNIQUE,
      name text NOT NULL,
      description text NOT NULL DEFAULT '',
      format text NOT NULL CHECK (format IN ('divisions', 'common_tour', 'season_rr', 'free_dates')),
      created_by integer REFERENCES users ON DELETE SET NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE league_seasons (
      id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      league_id integer NOT NULL REFERENCES leagues ON DELETE CASCADE,
      name text NOT NULL,
      status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'registration', 'active', 'finished')),
      starts_on date NOT NULL,
      ends_on date NOT NULL,
      rules jsonb NOT NULL DEFAULT '{}',
      payment jsonb NOT NULL DEFAULT '{}',
      previous_season_id integer REFERENCES league_seasons ON DELETE SET NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE league_divisions (
      id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      season_id integer NOT NULL REFERENCES league_seasons ON DELETE CASCADE,
      name text NOT NULL,
      level integer NOT NULL,
      merged_into integer REFERENCES league_divisions ON DELETE SET NULL
    );
    CREATE TABLE league_participants (
      id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      season_id integer NOT NULL REFERENCES league_seasons ON DELETE CASCADE,
      player_id integer NOT NULL REFERENCES players ON DELETE CASCADE,
      division_id integer REFERENCES league_divisions ON DELETE SET NULL,
      status text NOT NULL DEFAULT 'active' CHECK (status IN ('invited', 'active', 'frozen', 'left', 'declined')),
      joined_tour integer NOT NULL DEFAULT 1,
      missed_tours integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (season_id, player_id)
    );
    CREATE TABLE league_tours (
      id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      season_id integer NOT NULL REFERENCES league_seasons ON DELETE CASCADE,
      number integer NOT NULL,
      kind text NOT NULL DEFAULT 'regular' CHECK (kind IN ('regular', 'playoff')),
      starts_at timestamptz NOT NULL,
      deadline_at timestamptz,
      status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'running', 'applied')),
      reminded_at timestamptz,
      UNIQUE (season_id, number)
    );
    ALTER TABLE tournaments ADD COLUMN league_tour_id integer REFERENCES league_tours ON DELETE SET NULL,
      ADD COLUMN league_division_id integer REFERENCES league_divisions ON DELETE SET NULL;
    CREATE TABLE league_results (
      tour_id integer NOT NULL REFERENCES league_tours ON DELETE CASCADE,
      participant_id integer NOT NULL REFERENCES league_participants ON DELETE CASCADE,
      division_id integer REFERENCES league_divisions ON DELETE SET NULL,
      place integer,
      points integer NOT NULL DEFAULT 0,
      missed boolean NOT NULL DEFAULT false,
      PRIMARY KEY (tour_id, participant_id)
    );
    CREATE TABLE league_moves (
      id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      season_id integer NOT NULL REFERENCES league_seasons ON DELETE CASCADE,
      tour_id integer REFERENCES league_tours ON DELETE CASCADE,
      participant_id integer NOT NULL REFERENCES league_participants ON DELETE CASCADE,
      from_division integer REFERENCES league_divisions ON DELETE SET NULL,
      to_division integer REFERENCES league_divisions ON DELETE SET NULL,
      reason text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE league_fixtures (
      id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      season_id integer NOT NULL REFERENCES league_seasons ON DELETE CASCADE,
      division_id integer REFERENCES league_divisions ON DELETE SET NULL,
      home_participant integer NOT NULL REFERENCES league_participants ON DELETE CASCADE,
      away_participant integer NOT NULL REFERENCES league_participants ON DELETE CASCADE,
      round integer NOT NULL,
      status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'proposed', 'scheduled', 'reported', 'confirmed')),
      proposed_by integer REFERENCES league_participants ON DELETE SET NULL,
      starts_at timestamptz,
      table_id integer REFERENCES hall_tables ON DELETE SET NULL,
      booking_id integer REFERENCES bookings ON DELETE SET NULL,
      deadline_at timestamptz,
      sets_home integer,
      sets_away integer,
      reported_by integer REFERENCES league_participants ON DELETE SET NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX league_fixtures_season ON league_fixtures (season_id, status);
  `.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    DROP TABLE league_fixtures, league_moves, league_results;
    ALTER TABLE tournaments DROP COLUMN league_tour_id, DROP COLUMN league_division_id;
    DROP TABLE league_tours, league_participants, league_divisions, league_seasons, leagues, meeting_games, meeting_lineups;
    ALTER TABLE entries DROP COLUMN team_id, DROP COLUMN roster;
    DROP TABLE team_invitations, team_members, teams;
  `.execute(db)
}
