import { Migrator } from 'kysely/migration'
import type { Migration, MigrationProvider } from 'kysely/migration'
import { db } from './index.ts'
import * as m0001 from './migrations/0001_init.ts'
import * as m0002 from './migrations/0002_accounts_clubs.ts'
import * as m0003 from './migrations/0003_conduct.ts'
import * as m0004 from './migrations/0004_rating_notify.ts'
import * as m0005 from './migrations/0005_teams_leagues.ts'
import * as m0006 from './migrations/0006_booking_admin.ts'
import * as m0007 from './migrations/0007_cities_locale.ts'
import * as m0140 from './migrations/0140_notify_lang.ts'

// Migrations are listed explicitly (works the same from sources and from a bundle).
const migrations: Record<string, Migration> = {
  '0001_init': m0001,
  '0002_accounts_clubs': m0002,
  '0003_conduct': m0003,
  '0004_rating_notify': m0004,
  '0005_teams_leagues': m0005,
  '0006_booking_admin': m0006,
  '0007_cities_locale': m0007,
  '0140_notify_lang': m0140,
}

const provider: MigrationProvider = { getMigrations: async () => migrations }

export async function migrateToLatest(): Promise<void> {
  const migrator = new Migrator({ db, provider })
  const { error, results } = await migrator.migrateToLatest()
  for (const r of results ?? []) console.log(`migration ${r.migrationName}: ${r.status}`)
  if (error) throw error
}

if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, '/')}` || process.argv[1]?.endsWith('migrate.ts')) {
  migrateToLatest()
    .then(() => db.destroy())
    .catch(async (e) => {
      console.error(e)
      await db.destroy()
      process.exit(1)
    })
}
