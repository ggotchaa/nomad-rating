import { sql } from 'kysely'
import type { Kysely } from 'kysely'

// Brackets −2 / mixed, stage warnings, seeds waiting for a group, manual group places, draft of the first stage.

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE stages DROP CONSTRAINT IF EXISTS stages_kind_check;
    ALTER TABLE stages ADD CONSTRAINT stages_kind_check CHECK (kind IN ('groups', 'round_robin', 'single_elim', 'all_places', 'minus2', 'mixed'));
    ALTER TABLE stages
      ADD COLUMN warnings jsonb NOT NULL DEFAULT '[]',
      ADD COLUMN seed_slots jsonb;
    ALTER TABLE groups ADD COLUMN manual_order integer[];
    ALTER TABLE tournaments
      ADD COLUMN draft jsonb,
      ADD COLUMN draft_published_at timestamptz;
    ALTER TABLE entries ADD COLUMN late_payment text CHECK (late_payment IN ('on_site', 'waived'));
  `.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE entries DROP COLUMN late_payment;
    ALTER TABLE tournaments DROP COLUMN draft, DROP COLUMN draft_published_at;
    ALTER TABLE groups DROP COLUMN manual_order;
    ALTER TABLE stages DROP COLUMN warnings, DROP COLUMN seed_slots;
    ALTER TABLE stages DROP CONSTRAINT IF EXISTS stages_kind_check;
    ALTER TABLE stages ADD CONSTRAINT stages_kind_check CHECK (kind IN ('groups', 'round_robin', 'single_elim', 'all_places'));
  `.execute(db)
}
