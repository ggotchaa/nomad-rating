import { sql } from 'kysely'
import type { Kysely } from 'kysely'

// Club documents uploaded for verification (A-1).

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE club_documents (
      id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      club_id integer NOT NULL REFERENCES clubs ON DELETE CASCADE,
      name text NOT NULL,
      url text NOT NULL,
      mime text NOT NULL,
      size integer NOT NULL,
      uploaded_by integer REFERENCES users ON DELETE SET NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX club_documents_club ON club_documents (club_id);
  `.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE club_documents`.execute(db)
}
