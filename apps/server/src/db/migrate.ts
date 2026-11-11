import { Migrator } from 'kysely/migration'
import type { Migration, MigrationProvider } from 'kysely/migration'
import { db } from './index.ts'
import * as m0001 from './migrations/0001_init.ts'

// Migrations are listed explicitly (works the same from sources and from a bundle).
const migrations: Record<string, Migration> = {
  '0001_init': m0001,
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
