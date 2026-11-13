import { sql } from 'kysely'
import type { Kysely } from 'kysely'

// Organiser format templates (F-3).

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE club_format_templates (
      id serial PRIMARY KEY,
      club_id integer NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
      name text NOT NULL,
      format jsonb NOT NULL,
      created_by integer REFERENCES users(id) ON DELETE SET NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX club_format_templates_club ON club_format_templates (club_id);
  `.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS club_format_templates`.execute(db)
}
