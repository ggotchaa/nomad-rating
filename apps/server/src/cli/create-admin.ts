// `npm run admin:create -w @nomad/server -- <email>` with ADMIN_PASSWORD in the environment.
// Creates a platform admin, or promotes an existing user (and resets the password if given).

import { hashPassword } from '../auth/password.ts'
import { db } from '../db/index.ts'

const email = process.argv[2]?.trim().toLowerCase()
const password = process.env.ADMIN_PASSWORD

if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
  console.error('Usage: ADMIN_PASSWORD=... npm run admin:create -w @nomad/server -- <email>')
  process.exit(1)
}
if (password !== undefined && password.length < 8) {
  console.error('ADMIN_PASSWORD must be at least 8 characters')
  process.exit(1)
}

try {
  const existing = await db
    .selectFrom('users')
    .select('id')
    .where((eb) => eb(eb.fn('lower', ['email']), '=', email))
    .executeTakeFirst()
  if (existing) {
    await db
      .updateTable('users')
      .set({ platform_role: 'admin', blocked_at: null, ...(password ? { password_hash: await hashPassword(password) } : {}) })
      .where('id', '=', existing.id)
      .execute()
    console.log(`Promoted ${email} to admin${password ? ' and reset the password' : ''}`)
  } else {
    if (!password) throw new Error('New user: set ADMIN_PASSWORD')
    await db
      .insertInto('users')
      .values({ email, password_hash: await hashPassword(password), email_verified_at: new Date(), platform_role: 'admin' })
      .execute()
    console.log(`Created admin ${email}`)
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : e)
  process.exitCode = 1
} finally {
  await db.destroy()
}
