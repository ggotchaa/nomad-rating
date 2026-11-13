import { sql } from 'kysely'
import type { Kysely } from 'kysely'

// telegram_accounts.lang = explicit /lang choice only (NULL → the user's locale).

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE telegram_accounts ALTER COLUMN lang DROP NOT NULL, ALTER COLUMN lang DROP DEFAULT;
    UPDATE telegram_accounts SET lang = NULL WHERE lang = 'ru';
  `.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    UPDATE telegram_accounts SET lang = 'ru' WHERE lang IS NULL;
    ALTER TABLE telegram_accounts ALTER COLUMN lang SET DEFAULT 'ru', ALTER COLUMN lang SET NOT NULL;
  `.execute(db)
}
