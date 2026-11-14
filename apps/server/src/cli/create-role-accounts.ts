// `ROLE_PASSWORD=... npm run roles:create -w @nomad/server`: role test accounts on a real database.
// Idempotent: existing users, clubs and memberships are kept. Every account gets a player profile and recorded consent.
// ROLE_PASSWORD (re)sets every password; without it existing passwords are kept and only missing accounts fail.
// No tournaments or ratings are invented: players start without history.

import { DEFAULT_BOOKING_SETTINGS, emptyCalibration } from '@nomad/engine'
import { RIGHT_TEMPLATES, START_LEVELS, searchName } from '@nomad/shared'
import type { ClubRight } from '@nomad/shared'
import { hashPassword } from '../auth/password.ts'
import { db, json } from '../db/index.ts'
import type { Transaction } from '../db/index.ts'
import type { Database } from '../db/types.ts'

type Trx = Transaction<Database>
type Profile = { first: string; last: string; gender: 'm' | 'f'; year: number; level: number }

const DOMAIN = process.env.ROLE_DOMAIN ?? 'demo.nomad.kz'
const password = process.env.ROLE_PASSWORD
if (password !== undefined && password.length < 8) {
  console.error('ROLE_PASSWORD must be at least 8 characters')
  process.exit(1)
}
const mail = (local: string) => `${local}@${DOMAIN}`

const PROFILES: Record<string, Profile> = {
  player: { first: 'Арман', last: 'Сейтов', gender: 'm', year: 1991, level: START_LEVELS.amateur },
  newbie: { first: 'Дана', last: 'Ермекова', gender: 'f', year: 2001, level: START_LEVELS.novice },
  rttf: { first: 'Руслан', last: 'Ахметов', gender: 'm', year: 1987, level: START_LEVELS.amateur },
  organizer: { first: 'Ерлан', last: 'Касымов', gender: 'm', year: 1984, level: START_LEVELS.amateur },
  newclub: { first: 'Айгерим', last: 'Нурланова', gender: 'f', year: 1990, level: START_LEVELS.amateur },
  hall: { first: 'Марат', last: 'Жумабаев', gender: 'm', year: 1993, level: START_LEVELS.amateur },
  referee: { first: 'Ольга', last: 'Ким', gender: 'f', year: 1986, level: START_LEVELS.amateur },
  manager: { first: 'Тимур', last: 'Омаров', gender: 'm', year: 1989, level: START_LEVELS.amateur },
  accountant: { first: 'Сауле', last: 'Бекова', gender: 'f', year: 1985, level: START_LEVELS.novice },
  admin: { first: 'Данияр', last: 'Алиев', gender: 'm', year: 1988, level: START_LEVELS.amateur },
}

const HELPERS: { local: string; rights: ClubRight[] }[] = [
  { local: 'hall', rights: ['bookings', 'players'] },
  { local: 'referee', rights: ['conduct'] },
  { local: 'manager', rights: RIGHT_TEMPLATES.tournament_manager! },
  { local: 'accountant', rights: RIGHT_TEMPLATES.accountant! },
]

const HOURS = Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((d) => [d, { open: (d > 5 ? 10 : 8) * 60, close: (d > 5 ? 22 : 23) * 60 }]))

async function account(trx: Trx, local: string, hash: string | null, cityId: number, admin = false) {
  const email = mail(local)
  const found = await trx.selectFrom('users').select('id').where((eb) => eb(eb.fn('lower', ['email']), '=', email)).executeTakeFirst()
  let userId: number
  if (found) {
    await trx
      .updateTable('users')
      .set((eb) => ({
        blocked_at: null,
        consent_at: eb.fn.coalesce('consent_at', eb.val(new Date())),
        ...(hash ? { password_hash: hash } : {}),
        ...(admin ? { platform_role: 'admin' as const } : {}),
      }))
      .where('id', '=', found.id)
      .execute()
    userId = found.id
  } else {
    if (!hash) throw new Error(`${email} does not exist yet: set ROLE_PASSWORD`)
    const row = await trx.insertInto('users').values({ email, password_hash: hash, email_verified_at: new Date(), consent_at: new Date(), platform_role: admin ? 'admin' : 'user' }).returning('id').executeTakeFirstOrThrow()
    userId = row.id
  }

  const has = await trx.selectFrom('players').select('id').where('user_id', '=', userId).executeTakeFirst()
  if (!has) {
    const p = PROFILES[local]!
    const row = await trx
      .insertInto('players')
      .values({ user_id: userId, first_name: p.first, last_name: p.last, gender: p.gender, birth_year: p.year, city_id: cityId, start_level: p.level, search_name: searchName({ firstName: p.first, lastName: p.last }) })
      .returning('id')
      .executeTakeFirstOrThrow()
    await trx.insertInto('player_ratings').values({ player_id: row.id, kind: 'singles', rating: null, calibration: json(emptyCalibration()) }).execute()
  }
  return userId
}

async function club(trx: Trx, input: { slug: string; name: string; status: 'active' | 'review'; owner: number; cityId: number; tables: number }) {
  const found = await trx.selectFrom('clubs').select(['id', 'owner_user_id']).where('slug', '=', input.slug).executeTakeFirst()
  if (found) {
    if (found.owner_user_id !== input.owner) throw new Error(`Club ${input.slug} exists with another owner; not touching it`)
    return found.id
  }
  const c = await trx
    .insertInto('clubs')
    .values({
      slug: input.slug,
      name: input.name,
      description: 'Тестовый клуб для проверки ролей.',
      city_id: input.cityId,
      status: input.status,
      owner_user_id: input.owner,
      verified_at: input.status === 'active' ? new Date() : null,
      tournament_defaults: json({ settings: { checkinWindowMinutes: 60, avgMatchMinutes: 20 } }),
    })
    .returning('id')
    .executeTakeFirstOrThrow()
  await trx.insertInto('club_members').values({ club_id: c.id, user_id: input.owner, role: 'organizer' }).execute()
  const hall = await trx
    .insertInto('halls')
    .values({ club_id: c.id, name: 'Основной зал', address: 'Адрес уточняется', timezone: 'Asia/Almaty', opening_hours: json(HOURS), is_default: true })
    .returning('id')
    .executeTakeFirstOrThrow()
  for (let n = 1; n <= input.tables; n++) {
    await trx.insertInto('hall_tables').values({ hall_id: hall.id, number: n, x: 4 + ((n - 1) % 3) * 8, y: 3 + Math.floor((n - 1) / 3) * 5.5, rotation: 0, bookable: true }).execute()
  }
  await trx.insertInto('booking_settings').values({ hall_id: hall.id, settings: json(DEFAULT_BOOKING_SETTINGS) }).execute()
  return c.id
}

try {
  const hash = password ? await hashPassword(password) : null
  await db.transaction().execute(async (trx) => {
    const almaty = (await trx.selectFrom('cities').select('id').where('slug', '=', 'almaty').executeTakeFirstOrThrow()).id

    for (const local of ['player', 'newbie', 'rttf']) await account(trx, local, hash, almaty)

    const organizer = await account(trx, 'organizer', hash, almaty)
    const smash = await club(trx, { slug: 'smash-arena', name: 'Smash Arena', status: 'active', owner: organizer, cityId: almaty, tables: 6 })
    for (const h of HELPERS) {
      const userId = await account(trx, h.local, hash, almaty)
      const member = await trx.selectFrom('club_members').select('user_id').where('club_id', '=', smash).where('user_id', '=', userId).executeTakeFirst()
      if (member) await trx.updateTable('club_members').set({ rights: h.rights }).where('club_id', '=', smash).where('user_id', '=', userId).execute()
      else await trx.insertInto('club_members').values({ club_id: smash, user_id: userId, role: 'helper', rights: h.rights, scope: json({ kind: 'club' }), invited_by: organizer }).execute()
    }

    const newOwner = await account(trx, 'newclub', hash, almaty)
    await club(trx, { slug: 'ping-pong-lab', name: 'Ping Pong Lab', status: 'review', owner: newOwner, cityId: almaty, tables: 3 })

    await account(trx, 'admin', hash, almaty, true)
  })
  for (const l of Object.keys(PROFILES)) console.log(mail(l))
  if (!hash) console.log('Passwords unchanged')
} catch (e) {
  console.error(e instanceof Error ? e.message : e)
  process.exitCode = 1
} finally {
  await db.destroy()
}
