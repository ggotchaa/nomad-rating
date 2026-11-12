import { sql } from 'kysely'
import type { Kysely } from 'kysely'

// Stage 1: e-mail tokens, 2FA, consent, club review reasons, helper invitations,
// player merge requests, RTTF base and claims.

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE users ADD COLUMN totp_enabled_at timestamptz;
    ALTER TABLE users ADD COLUMN consent_at timestamptz;
    ALTER TABLE sessions ADD COLUMN mfa_verified_at timestamptz;
    ALTER TABLE clubs ADD COLUMN status_reason text;
    ALTER TABLE clubs ADD COLUMN comment_for_players text NOT NULL DEFAULT '';

    CREATE TABLE auth_tokens (
      id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      user_id integer NOT NULL REFERENCES users ON DELETE CASCADE,
      kind text NOT NULL CHECK (kind IN ('verify_email', 'reset_password')),
      token_hash text NOT NULL UNIQUE,
      expires_at timestamptz NOT NULL,
      used_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX auth_tokens_user ON auth_tokens (user_id, kind);

    CREATE TABLE club_invitations (
      id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      club_id integer NOT NULL REFERENCES clubs ON DELETE CASCADE,
      email text,
      token_hash text NOT NULL UNIQUE,
      rights text[] NOT NULL DEFAULT '{}',
      scope jsonb NOT NULL DEFAULT '{"kind":"club"}',
      template text,
      status text NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'accepted', 'declined', 'expired', 'revoked')),
      expires_at timestamptz NOT NULL,
      invited_by integer REFERENCES users ON DELETE SET NULL,
      accepted_by integer REFERENCES users ON DELETE SET NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX club_invitations_club ON club_invitations (club_id, status);

    CREATE TABLE player_merge_requests (
      id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      club_id integer REFERENCES clubs ON DELETE SET NULL,
      source_player_id integer NOT NULL REFERENCES players ON DELETE CASCADE,
      target_player_id integer NOT NULL REFERENCES players ON DELETE CASCADE,
      reason text NOT NULL DEFAULT '',
      status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'merged', 'rejected')),
      requested_by integer REFERENCES users ON DELETE SET NULL,
      resolved_by integer REFERENCES users ON DELETE SET NULL,
      resolved_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      CHECK (source_player_id <> target_player_id)
    );

    CREATE TABLE rttf_profiles (
      id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      rttf_id text UNIQUE,
      full_name text NOT NULL,
      search_name text NOT NULL,
      birth_year integer,
      city text NOT NULL DEFAULT '',
      rating integer NOT NULL CHECK (rating >= 0),
      player_id integer UNIQUE REFERENCES players ON DELETE SET NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX rttf_profiles_search ON rttf_profiles USING gin (search_name gin_trgm_ops);

    CREATE TABLE rttf_claims (
      id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      kind text NOT NULL CHECK (kind IN ('claim', 'add_request')),
      rttf_profile_id integer REFERENCES rttf_profiles ON DELETE CASCADE,
      player_id integer NOT NULL REFERENCES players ON DELETE CASCADE,
      status text NOT NULL CHECK (status IN ('approved', 'pending', 'conflict', 'rejected')),
      reason text NOT NULL DEFAULT '',
      payload jsonb NOT NULL DEFAULT '{}',
      resolved_by integer REFERENCES users ON DELETE SET NULL,
      resolved_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX rttf_claims_status ON rttf_claims (status);
  `.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    DROP TABLE rttf_claims, rttf_profiles, player_merge_requests, club_invitations, auth_tokens;
    ALTER TABLE clubs DROP COLUMN comment_for_players, DROP COLUMN status_reason;
    ALTER TABLE sessions DROP COLUMN mfa_verified_at;
    ALTER TABLE users DROP COLUMN consent_at, DROP COLUMN totp_enabled_at;
  `.execute(db)
}
