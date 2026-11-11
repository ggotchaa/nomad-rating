// `npm run demo:reset`: drops all data, runs migrations and seeds the demo. Refuses outside DEMO_MODE.

import { sql } from 'kysely'
import { config } from '../config.ts'
import { db } from '../db/index.ts'
import { migrateToLatest } from '../db/migrate.ts'
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from './accounts.ts'
import { seedDemo } from './seed.ts'

if (!config.DEMO_MODE || config.NODE_ENV === 'production') {
  console.error('demo:reset runs only with DEMO_MODE=true and NODE_ENV != production')
  process.exit(1)
}

try {
  await sql`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`.execute(db)
  await migrateToLatest()
  await seedDemo()
  console.log('\nDemo accounts (password for all: %s):', DEMO_PASSWORD)
  for (const a of DEMO_ACCOUNTS) console.log(`  ${a.title.padEnd(26)} ${a.email}`)
} catch (e) {
  console.error(e)
  process.exitCode = 1
} finally {
  await db.destroy()
  process.exit(process.exitCode ?? 0)
}
