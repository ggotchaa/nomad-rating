import { sql } from 'kysely'
import type { Kysely } from 'kysely'

// Stage 3: rating replay state, disputes, notification inbox/prefs/log, push and Telegram channels, subscriptions.

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE tournaments ADD COLUMN rating_coefficient numeric NOT NULL DEFAULT 1;
    ALTER TABLE rating_snapshots ADD COLUMN state_before jsonb, ADD COLUMN state_after jsonb;

    CREATE TABLE disputes (
      id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      entity text NOT NULL,
      entity_id text NOT NULL,
      tournament_id integer REFERENCES tournaments ON DELETE CASCADE,
      club_id integer REFERENCES clubs ON DELETE CASCADE,
      user_id integer NOT NULL REFERENCES users ON DELETE CASCADE,
      reason text NOT NULL,
      status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'rejected')),
      resolution text,
      resolved_by integer REFERENCES users ON DELETE SET NULL,
      resolved_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX disputes_club ON disputes (club_id, status);

    CREATE TABLE notifications (
      id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      user_id integer NOT NULL REFERENCES users ON DELETE CASCADE,
      type text NOT NULL,
      data jsonb NOT NULL DEFAULT '{}',
      urgent boolean NOT NULL DEFAULT false,
      read_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX notifications_user ON notifications (user_id, created_at DESC);

    CREATE TABLE notification_prefs (
      user_id integer NOT NULL REFERENCES users ON DELETE CASCADE,
      type text NOT NULL,
      channel text NOT NULL CHECK (channel IN ('push', 'telegram', 'email')),
      enabled boolean NOT NULL,
      PRIMARY KEY (user_id, type, channel)
    );

    CREATE TABLE notification_log (
      id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      notification_id integer,
      user_id integer NOT NULL,
      type text NOT NULL,
      channel text NOT NULL,
      attempt integer NOT NULL,
      status text NOT NULL CHECK (status IN ('sent', 'failed', 'skipped')),
      error text,
      latency_ms integer,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX notification_log_type ON notification_log (type, created_at DESC);

    CREATE TABLE push_subscriptions (
      id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      user_id integer NOT NULL REFERENCES users ON DELETE CASCADE,
      endpoint text NOT NULL UNIQUE,
      keys jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE telegram_accounts (
      chat_id bigint PRIMARY KEY,
      player_id integer NOT NULL REFERENCES players ON DELETE CASCADE,
      username text,
      lang text NOT NULL DEFAULT 'ru',
      stopped boolean NOT NULL DEFAULT false,
      blocked_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX telegram_accounts_player ON telegram_accounts (player_id);

    CREATE TABLE telegram_bind_tokens (
      token text PRIMARY KEY,
      player_id integer NOT NULL REFERENCES players ON DELETE CASCADE,
      expires_at timestamptz NOT NULL
    );

    CREATE TABLE telegram_messages (
      ref text NOT NULL,
      chat_id bigint NOT NULL,
      message_id integer NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (ref, chat_id)
    );

    CREATE TABLE subscriptions (
      id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      user_id integer NOT NULL REFERENCES users ON DELETE CASCADE,
      kind text NOT NULL CHECK (kind IN ('club', 'rating')),
      club_id integer REFERENCES clubs ON DELETE CASCADE,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX subscriptions_key ON subscriptions (user_id, kind, coalesce(club_id, 0));

    CREATE TABLE notification_dedupe (
      key text PRIMARY KEY,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    DROP TABLE IF EXISTS notification_dedupe, subscriptions, telegram_messages, telegram_bind_tokens, telegram_accounts,
      push_subscriptions, notification_log, notification_prefs, notifications, disputes CASCADE;
    ALTER TABLE rating_snapshots DROP COLUMN IF EXISTS state_before, DROP COLUMN IF EXISTS state_after;
    ALTER TABLE tournaments DROP COLUMN IF EXISTS rating_coefficient;
  `.execute(db)
}
