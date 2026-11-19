import { sql } from 'kysely'
import type { Kysely } from 'kysely'

// T-19: a user disputes a player card already bound to another account; a platform admin decides.

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE profile_claim_disputes (
      id serial PRIMARY KEY,
      player_id integer NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      claimant_user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      holder_user_id integer REFERENCES users(id) ON DELETE SET NULL,
      reason text NOT NULL DEFAULT '',
      documents jsonb NOT NULL DEFAULT '[]',
      status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'approved', 'rejected')),
      decision_note text,
      decided_by integer REFERENCES users(id) ON DELETE SET NULL,
      decided_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX profile_claim_disputes_status ON profile_claim_disputes (status);
    CREATE UNIQUE INDEX profile_claim_disputes_open ON profile_claim_disputes (player_id, claimant_user_id) WHERE status = 'open';
  `.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE profile_claim_disputes`.execute(db)
}
