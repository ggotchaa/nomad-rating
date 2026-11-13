// `npm run dev:reset`: drops all data, runs migrations and seeds development/e2e data. Refuses in production.

import { sql } from 'kysely'
import { config } from '../config.ts'
import { db } from '../db/index.ts'
import { migrateToLatest } from '../db/migrate.ts'
import { DEV_ACCOUNTS, DEV_PASSWORD } from './accounts.ts'
import { seedDevData } from './seed.ts'

if (config.NODE_ENV === 'production') {
  console.error('dev:reset wipes the database and never runs with NODE_ENV=production')
  process.exit(1)
}

try {
  await sql`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`.execute(db)
  await migrateToLatest()
  await seedDevData()
  console.log('\nDev accounts (password for all: %s):', DEV_PASSWORD)
  for (const a of DEV_ACCOUNTS) console.log(`  ${a.title.padEnd(26)} ${a.email}`)
} catch (e) {
  console.error(e)
  process.exitCode = 1
} finally {
  await db.destroy()
  process.exit(process.exitCode ?? 0)
}
