// `ROLE_PASSWORD=... npm run roles:create -w @nomad/server`: role test accounts on a real database.
// Idempotent: existing users, clubs and memberships are kept; the password is (re)set for every account.
// No tournaments or ratings are invented: players start without history.

import { DEFAULT_BOOKING_SETTINGS, emptyCalibration } from '@nomad/engine'
import { RIGHT_TEMPLATES, START_LEVELS, searchName } from '@nomad/shared'
import type { ClubRight } from '@nomad/shared'
import { hashPassword } from '../auth/password.ts'
import { db, json } from '../db/index.ts'
import type { Transaction } from '../db/index.ts'
import type { Database } from '../db/types.ts'

type Trx = Transaction<Database>
const DOMAIN = process.env.ROLE_DOMAIN ?? 'demo.nomad.kz'
const password = process.env.ROLE_PASSWORD
if (!password || password.length < 8) {
  console.error('Set ROLE_PASSWORD (8+ characters)')
  process.exit(1)
}
const mail = (local: string) => `${local}@${DOMAIN}`

const PLAYERS = [
  { local: 'player', first: 'Арман', last: 'Сейтов', gender: 'm', year: 1991, level: START_LEVELS.amateur },
  { local: 'newbie', first: 'Дана', last: 'Ермекова', gender: 'f', year: 2001, level: START_LEVELS.novice },
  { local: 'rttf', first: 'Руслан', last: 'Ахметов', gender: 'm', year: 1987, level: START_LEVELS.amateur },
] as const

const HELPERS: { local: string; rights: ClubRight[] }[] = [
  { local: 'hall', rights: ['bookings', 'players'] },
  { local: 'referee', rights: ['conduct'] },
  { local: 'manager', rights: RIGHT_TEMPLATES.tournament_manager! },
  { local: 'accountant', rights: RIGHT_TEMPLATES.accountant! },
]

const HOURS = Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((d) => [d, { open: (d > 5 ? 10 : 8) * 60, close: (d > 5 ? 22 : 23) * 60 }]))

async function user(trx: Trx, email: string, hash: string, admin = false) {
  const found = await trx.selectFrom('users').select('id').where((eb) => eb(eb.fn('lower', ['email']), '=', email)).executeTakeFirst()
  if (found) {
    await trx.updateTable('users').set({ password_hash: hash, blocked_at: null, ...(admin ? { platform_role: 'admin' } : {}) }).where('id', '=', found.id).execute()
    return found.id
  }
  const row = await trx.insertInto('users').values({ email, password_hash: hash, email_verified_at: new Date(), platform_role: admin ? 'admin' : 'user' }).returning('id').executeTakeFirstOrThrow()
  return row.id
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
  const hash = await hashPassword(password)
  await db.transaction().execute(async (trx) => {
    const almaty = (await trx.selectFrom('cities').select('id').where('slug', '=', 'almaty').executeTakeFirstOrThrow()).id

    for (const p of PLAYERS) {
      const userId = await user(trx, mail(p.local), hash)
      const has = await trx.selectFrom('players').select('id').where('user_id', '=', userId).executeTakeFirst()
      if (has) continue
      const row = await trx
        .insertInto('players')
        .values({ user_id: userId, first_name: p.first, last_name: p.last, gender: p.gender, birth_year: p.year, city_id: almaty, start_level: p.level, search_name: searchName({ firstName: p.first, lastName: p.last }) })
        .returning('id')
        .executeTakeFirstOrThrow()
      await trx.insertInto('player_ratings').values({ player_id: row.id, kind: 'singles', rating: null, calibration: json(emptyCalibration()) }).execute()
    }

    const organizer = await user(trx, mail('organizer'), hash)
    const smash = await club(trx, { slug: 'smash-arena', name: 'Smash Arena', status: 'active', owner: organizer, cityId: almaty, tables: 6 })
    for (const h of HELPERS) {
      const userId = await user(trx, mail(h.local), hash)
      const member = await trx.selectFrom('club_members').select('user_id').where('club_id', '=', smash).where('user_id', '=', userId).executeTakeFirst()
      if (member) await trx.updateTable('club_members').set({ rights: h.rights }).where('club_id', '=', smash).where('user_id', '=', userId).execute()
      else await trx.insertInto('club_members').values({ club_id: smash, user_id: userId, role: 'helper', rights: h.rights, scope: json({ kind: 'club' }), invited_by: organizer }).execute()
    }

    const newOwner = await user(trx, mail('newclub'), hash)
    await club(trx, { slug: 'ping-pong-lab', name: 'Ping Pong Lab', status: 'review', owner: newOwner, cityId: almaty, tables: 3 })

    await user(trx, mail('admin'), hash, true)
  })
  for (const l of ['player', 'newbie', 'rttf', 'organizer', 'newclub', 'hall', 'referee', 'manager', 'accountant', 'admin']) console.log(mail(l))
} catch (e) {
  console.error(e instanceof Error ? e.message : e)
  process.exitCode = 1
} finally {
  await db.destroy()
}
