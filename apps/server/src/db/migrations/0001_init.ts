import { sql } from 'kysely'
import type { Kysely } from 'kysely'

// First slice of the target schema: accounts, players and ratings, clubs and halls,
// tournaments with stages/groups/matches, rating events, bookings, payments, audit.
// Status lists mirror packages/shared/src/status.ts at the time of this migration.

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE EXTENSION IF NOT EXISTS btree_gist;
    CREATE EXTENSION IF NOT EXISTS pg_trgm;

    CREATE TABLE cities (
      id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      slug text NOT NULL UNIQUE,
      name_ru text NOT NULL,
      name_kk text NOT NULL,
      name_en text NOT NULL,
      region_ru text NOT NULL DEFAULT '',
      timezone text NOT NULL DEFAULT 'Asia/Almaty',
      sort_order integer NOT NULL DEFAULT 0
    );

    CREATE TABLE users (
      id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      email text NOT NULL,
      email_verified_at timestamptz,
      password_hash text,
      google_sub text UNIQUE,
      platform_role text NOT NULL DEFAULT 'user' CHECK (platform_role IN ('user', 'admin')),
      locale text NOT NULL DEFAULT 'ru' CHECK (locale IN ('ru', 'kk', 'en')),
      totp_secret text,
      blocked_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX users_email_key ON users (lower(email));

    CREATE TABLE sessions (
      id text PRIMARY KEY,
      user_id integer NOT NULL REFERENCES users ON DELETE CASCADE,
      active_club_id integer,
      user_agent text,
      created_at timestamptz NOT NULL DEFAULT now(),
      expires_at timestamptz NOT NULL
    );
    CREATE INDEX sessions_user ON sessions (user_id);

    CREATE TABLE players (
      id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      user_id integer UNIQUE REFERENCES users ON DELETE SET NULL,
      first_name text NOT NULL,
      last_name text NOT NULL,
      middle_name text,
      gender text NOT NULL CHECK (gender IN ('m', 'f')),
      birth_year integer NOT NULL CHECK (birth_year BETWEEN 1920 AND 2030),
      city_id integer REFERENCES cities,
      hand text CHECK (hand IN ('right', 'left')),
      photo_url text,
      start_level integer NOT NULL DEFAULT 1000,
      added_by_club_id integer,
      claim_code text UNIQUE,
      contact_email text,
      search_name text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX players_search ON players USING gin (search_name gin_trgm_ops);
    CREATE INDEX players_city ON players (city_id);

    CREATE TABLE player_ratings (
      player_id integer NOT NULL REFERENCES players ON DELETE CASCADE,
      kind text NOT NULL CHECK (kind IN ('singles', 'doubles')),
      rating integer,
      source text CHECK (source IN ('calibration', 'rttf', 'admin')),
      rated_matches integer NOT NULL DEFAULT 0,
      tournaments integer NOT NULL DEFAULT 0,
      matches integer NOT NULL DEFAULT 0,
      wins integer NOT NULL DEFAULT 0,
      max_rating integer,
      calibration jsonb NOT NULL DEFAULT '{}',
      last_rated_at timestamptz,
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (player_id, kind)
    );
    CREATE INDEX player_ratings_list ON player_ratings (kind, rating DESC) WHERE rating IS NOT NULL;

    CREATE TABLE clubs (
      id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      slug text NOT NULL UNIQUE,
      name text NOT NULL,
      description text NOT NULL DEFAULT '',
      city_id integer NOT NULL REFERENCES cities,
      logo_url text,
      cover_url text,
      status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'review', 'active', 'rejected', 'blocked')),
      owner_user_id integer NOT NULL REFERENCES users,
      telegram_url text,
      instagram_url text,
      contact_email text,
      contact_telegram text,
      requisites jsonb NOT NULL DEFAULT '{}',
      commission jsonb,
      hall_payment_enabled boolean NOT NULL DEFAULT true,
      tournament_defaults jsonb NOT NULL DEFAULT '{}',
      verified_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    ALTER TABLE players ADD CONSTRAINT players_added_by_club FOREIGN KEY (added_by_club_id) REFERENCES clubs ON DELETE SET NULL;

    CREATE TABLE club_members (
      club_id integer NOT NULL REFERENCES clubs ON DELETE CASCADE,
      user_id integer NOT NULL REFERENCES users ON DELETE CASCADE,
      role text NOT NULL CHECK (role IN ('organizer', 'helper')),
      rights text[] NOT NULL DEFAULT '{}',
      scope jsonb NOT NULL DEFAULT '{"kind":"club"}',
      invited_by integer REFERENCES users ON DELETE SET NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (club_id, user_id)
    );
    CREATE UNIQUE INDEX club_members_one_organizer ON club_members (club_id) WHERE role = 'organizer';

    CREATE TABLE halls (
      id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      club_id integer NOT NULL REFERENCES clubs ON DELETE CASCADE,
      name text NOT NULL,
      address text NOT NULL DEFAULT '',
      lat double precision,
      lng double precision,
      how_to_find text NOT NULL DEFAULT '',
      parking text NOT NULL DEFAULT '',
      timezone text NOT NULL DEFAULT 'Asia/Almaty',
      opening_hours jsonb NOT NULL DEFAULT '{}',
      comment_for_players text NOT NULL DEFAULT '',
      equipment jsonb NOT NULL DEFAULT '{}',
      plan jsonb NOT NULL DEFAULT '{"width":20,"length":12,"landmarks":[]}',
      is_default boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX halls_club ON halls (club_id);

    CREATE TABLE hall_tables (
      id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      hall_id integer NOT NULL REFERENCES halls ON DELETE CASCADE,
      number integer NOT NULL,
      label text,
      x double precision NOT NULL DEFAULT 0,
      y double precision NOT NULL DEFAULT 0,
      rotation integer NOT NULL DEFAULT 0 CHECK (rotation IN (0, 90)),
      bookable boolean NOT NULL DEFAULT true,
      price_per_hour bigint,
      model text,
      status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'broken')),
      UNIQUE (hall_id, number)
    );

    CREATE TABLE booking_settings (
      hall_id integer PRIMARY KEY REFERENCES halls ON DELETE CASCADE,
      settings jsonb NOT NULL
    );

    CREATE TABLE tournaments (
      id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      club_id integer NOT NULL REFERENCES clubs,
      hall_id integer NOT NULL REFERENCES halls,
      slug text NOT NULL UNIQUE,
      title text NOT NULL,
      type text NOT NULL DEFAULT 'singles' CHECK (type IN ('singles', 'doubles', 'team')),
      status text NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'published', 'registration_closed', 'running', 'finished', 'finished_early', 'cancelled')),
      starts_at timestamptz NOT NULL,
      estimated_end_at timestamptz NOT NULL,
      registration_closes_at timestamptz,
      max_participants integer NOT NULL CHECK (max_participants >= 2),
      min_participants integer NOT NULL DEFAULT 4,
      fee bigint NOT NULL DEFAULT 0 CHECK (fee >= 0),
      restrictions jsonb NOT NULL DEFAULT '{}',
      prizes text NOT NULL DEFAULT '',
      description text NOT NULL DEFAULT '',
      comment_for_players text NOT NULL DEFAULT '',
      staff_comment text NOT NULL DEFAULT '',
      cover_url text,
      format jsonb NOT NULL,
      settings jsonb NOT NULL DEFAULT '{}',
      refund_rules jsonb NOT NULL DEFAULT '[]',
      table_ids integer[] NOT NULL DEFAULT '{}',
      is_rated boolean NOT NULL DEFAULT true,
      series_id integer,
      address_snapshot jsonb,
      cancelled_reason text,
      created_by integer REFERENCES users ON DELETE SET NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      published_at timestamptz,
      started_at timestamptz,
      finished_at timestamptz
    );
    CREATE INDEX tournaments_calendar ON tournaments (starts_at) WHERE status <> 'draft';
    CREATE INDEX tournaments_club ON tournaments (club_id, starts_at DESC);

    CREATE TABLE payments (
      id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      provider text NOT NULL,
      method text NOT NULL CHECK (method IN ('online', 'at_club')),
      purpose text NOT NULL CHECK (purpose IN ('tournament_entry', 'booking', 'season')),
      amount bigint NOT NULL CHECK (amount >= 0),
      commission bigint NOT NULL DEFAULT 0,
      status text NOT NULL DEFAULT 'created'
        CHECK (status IN ('created', 'processing', 'succeeded', 'declined', 'expired', 'refunded_partial', 'refunded_full')),
      external_id text,
      idempotency_key text NOT NULL UNIQUE,
      user_id integer REFERENCES users ON DELETE SET NULL,
      club_id integer NOT NULL REFERENCES clubs,
      metadata jsonb NOT NULL DEFAULT '{}',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE entries (
      id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      tournament_id integer NOT NULL REFERENCES tournaments ON DELETE CASCADE,
      player_id integer NOT NULL REFERENCES players,
      status text NOT NULL CHECK (status IN ('assembling', 'awaiting_payment', 'paid', 'checked_in', 'playing', 'completed',
        'withdrew', 'expired', 'cancelled_by_player', 'removed_by_club', 'waitlist', 'invited')),
      hold_until timestamptz,
      waitlist_position integer,
      payment_id integer REFERENCES payments,
      seed integer,
      final_place integer,
      final_place_to integer,
      rating_at_start integer,
      registered_by integer REFERENCES users ON DELETE SET NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX entries_one_active ON entries (tournament_id, player_id)
      WHERE status IN ('assembling', 'awaiting_payment', 'paid', 'checked_in', 'playing', 'completed', 'withdrew', 'waitlist', 'invited');
    CREATE INDEX entries_player ON entries (player_id);

    CREATE TABLE stages (
      id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      tournament_id integer NOT NULL REFERENCES tournaments ON DELETE CASCADE,
      stage_key text NOT NULL,
      kind text NOT NULL CHECK (kind IN ('groups', 'round_robin', 'single_elim', 'all_places')),
      name text NOT NULL,
      order_index integer NOT NULL,
      status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'finished')),
      bracket jsonb,
      seeds jsonb,
      UNIQUE (tournament_id, stage_key)
    );

    CREATE TABLE groups (
      id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      stage_id integer NOT NULL REFERENCES stages ON DELETE CASCADE,
      code text NOT NULL,
      order_index integer NOT NULL,
      standings jsonb,
      UNIQUE (stage_id, code)
    );

    CREATE TABLE group_members (
      group_id integer NOT NULL REFERENCES groups ON DELETE CASCADE,
      entry_id integer NOT NULL REFERENCES entries ON DELETE CASCADE,
      seed_index integer NOT NULL,
      PRIMARY KEY (group_id, entry_id)
    );

    CREATE TABLE matches (
      id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      tournament_id integer NOT NULL REFERENCES tournaments ON DELETE CASCADE,
      stage_id integer NOT NULL REFERENCES stages ON DELETE CASCADE,
      group_id integer REFERENCES groups ON DELETE CASCADE,
      number integer NOT NULL,
      bracket_number integer,
      round integer NOT NULL,
      tour integer,
      stage_label text,
      place_from integer,
      place_to integer,
      home_source jsonb,
      away_source jsonb,
      home_entry_id integer REFERENCES entries,
      away_entry_id integer REFERENCES entries,
      status text NOT NULL CHECK (status IN ('waiting', 'scheduled', 'called', 'playing', 'finished', 'walkover', 'retired', 'annulled')),
      result_type text CHECK (result_type IN ('normal', 'walkover', 'retired', 'bye')),
      table_id integer REFERENCES hall_tables,
      called_at timestamptz,
      started_at timestamptz,
      finished_at timestamptz,
      sets_home integer,
      sets_away integer,
      games jsonb NOT NULL DEFAULT '[]',
      winner_entry_id integer REFERENCES entries,
      is_rated boolean NOT NULL DEFAULT true,
      UNIQUE (tournament_id, number)
    );
    CREATE INDEX matches_home ON matches (home_entry_id);
    CREATE INDEX matches_away ON matches (away_entry_id);

    CREATE TABLE rating_events (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      tournament_id integer NOT NULL REFERENCES tournaments ON DELETE CASCADE,
      match_id integer NOT NULL REFERENCES matches ON DELETE CASCADE,
      player_id integer NOT NULL REFERENCES players ON DELETE CASCADE,
      opponent_id integer NOT NULL REFERENCES players ON DELETE CASCADE,
      kind text NOT NULL CHECK (kind IN ('singles', 'doubles')),
      rating_before integer NOT NULL,
      opponent_rating integer NOT NULL,
      expected numeric(7, 6) NOT NULL,
      k integer NOT NULL,
      score smallint NOT NULL,
      delta numeric(9, 4) NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX rating_events_player ON rating_events (player_id, kind);
    CREATE INDEX rating_events_tournament ON rating_events (tournament_id);

    CREATE TABLE rating_snapshots (
      player_id integer NOT NULL REFERENCES players ON DELETE CASCADE,
      kind text NOT NULL CHECK (kind IN ('singles', 'doubles')),
      tournament_id integer NOT NULL REFERENCES tournaments ON DELETE CASCADE,
      rating_before integer,
      rating_after integer,
      delta integer NOT NULL DEFAULT 0,
      place integer,
      matches integer NOT NULL DEFAULT 0,
      wins integer NOT NULL DEFAULT 0,
      calibrated boolean NOT NULL DEFAULT false,
      at timestamptz NOT NULL,
      PRIMARY KEY (player_id, kind, tournament_id)
    );
    CREATE INDEX rating_snapshots_history ON rating_snapshots (player_id, kind, at);

    CREATE TABLE table_blocks (
      id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      hall_id integer NOT NULL REFERENCES halls ON DELETE CASCADE,
      table_ids integer[] NOT NULL DEFAULT '{}',
      starts_at timestamptz NOT NULL,
      ends_at timestamptz NOT NULL,
      kind text NOT NULL CHECK (kind IN ('training', 'closed', 'tournament', 'maintenance')),
      tournament_id integer REFERENCES tournaments ON DELETE CASCADE,
      note text NOT NULL DEFAULT '',
      created_by integer REFERENCES users ON DELETE SET NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      CHECK (ends_at > starts_at)
    );
    CREATE INDEX table_blocks_hall ON table_blocks (hall_id, starts_at);

    CREATE TABLE bookings (
      id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      hall_id integer NOT NULL REFERENCES halls,
      table_id integer NOT NULL REFERENCES hall_tables,
      club_id integer NOT NULL REFERENCES clubs,
      player_id integer REFERENCES players,
      guest_name text,
      guest_contact text,
      created_by integer REFERENCES users ON DELETE SET NULL,
      starts_at timestamptz NOT NULL,
      ends_at timestamptz NOT NULL,
      period tstzrange GENERATED ALWAYS AS (tstzrange(starts_at, ends_at, '[)')) STORED,
      status text NOT NULL CHECK (status IN ('held', 'confirmed', 'arrived', 'no_show', 'expired',
        'cancelled_by_player', 'cancelled_by_club', 'moved')),
      hold_until timestamptz,
      price bigint NOT NULL DEFAULT 0,
      payment_id integer REFERENCES payments,
      source text NOT NULL DEFAULT 'online' CHECK (source IN ('online', 'phone')),
      note text NOT NULL DEFAULT '',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CHECK (ends_at > starts_at),
      CHECK (player_id IS NOT NULL OR guest_name IS NOT NULL),
      -- B-10: two active bookings of one table can never overlap.
      CONSTRAINT bookings_no_overlap EXCLUDE USING gist (table_id WITH =, period WITH &&)
        WHERE (status IN ('held', 'confirmed', 'arrived', 'no_show'))
    );
    CREATE INDEX bookings_hall_day ON bookings (hall_id, starts_at);
    CREATE INDEX bookings_player ON bookings (player_id);

    CREATE TABLE audit_log (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      at timestamptz NOT NULL DEFAULT now(),
      actor_user_id integer REFERENCES users ON DELETE SET NULL,
      club_id integer,
      entity text NOT NULL,
      entity_id text NOT NULL,
      action text NOT NULL,
      before jsonb,
      after jsonb,
      reason text
    );
    CREATE INDEX audit_log_entity ON audit_log (entity, entity_id);
    CREATE INDEX audit_log_club ON audit_log (club_id, at DESC);

    CREATE TABLE platform_settings (
      key text PRIMARY KEY,
      value jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
  `.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    DROP TABLE IF EXISTS platform_settings, audit_log, bookings, table_blocks, rating_snapshots, rating_events,
      matches, group_members, groups, stages, entries, payments, tournaments, booking_settings, hall_tables, halls,
      club_members, players, clubs, player_ratings, sessions, users, cities CASCADE;
  `.execute(db)
}
