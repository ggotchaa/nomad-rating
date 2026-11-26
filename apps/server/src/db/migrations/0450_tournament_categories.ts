import { sql } from 'kysely'
import type { Kysely } from 'kysely'

// Categories: a tournament day with several sub-tournaments. The main tournament is the first category,
// the others point to it with parent_id and keep their own format, time, restrictions and entries.

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE tournaments
      ADD COLUMN parent_id integer REFERENCES tournaments(id) ON DELETE CASCADE,
      ADD COLUMN category_name text;
    CREATE INDEX tournaments_parent ON tournaments (parent_id) WHERE parent_id IS NOT NULL;
  `.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE tournaments DROP COLUMN parent_id, DROP COLUMN category_name`.execute(db)
}
