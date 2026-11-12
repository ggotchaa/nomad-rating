// Stage 1 demo data: helpers with different rights, a club in review, club-added players with claim codes,
// an RTTF base (~200 profiles, a few matching seeded players), open admin queues.

import { seededRandom } from '@nomad/engine'
import { START_LEVELS, normalizeText, searchName } from '@nomad/shared'
import { db, json } from '../db/index.ts'
import { hashPassword } from '../auth/password.ts'
import { DEMO_PASSWORD } from './accounts.ts'
import { FEMALE_FIRST, MALE_FIRST, SURNAMES, surnameFor } from './names.ts'

const log = (...args: unknown[]) => console.log('[demo:stage1]', ...args)

/** Fixed claim codes so the presenter can type them. */
export const DEMO_CLAIM_CODES = ['111111001', '111111002', '111111003', '111111004', '111111005']

export async function seedStage1(): Promise<void> {
  const rng = seededRandom(20261112)
  const passwordHash = await hashPassword(DEMO_PASSWORD)
  await db.updateTable('users').set({ consent_at: new Date() }).execute()
  const almaty = (await db.selectFrom('cities').select('id').where('slug', '=', 'almaty').executeTakeFirstOrThrow()).id
  const smash = await db.selectFrom('clubs').select(['id', 'owner_user_id']).where('slug', '=', 'smash-arena').executeTakeFirstOrThrow()
  // Accounts listed in DEMO_ACCOUNTS are already created by seed.ts.
  const user = async (email: string) =>
    (await db.selectFrom('users').select('id').where('email', '=', email).executeTakeFirst())?.id ??
    (await db.insertInto('users').values({ email, password_hash: passwordHash, email_verified_at: new Date(), consent_at: new Date() }).returning('id').executeTakeFirstOrThrow()).id

  // Referee: only «Проведение», only for the next upcoming tournament of the club.
  const next = await db.selectFrom('tournaments').select('id').where('club_id', '=', smash.id).where('status', '=', 'published').orderBy('starts_at').executeTakeFirst()
  const referee = await user('referee@demo.nomad.kz')
  await db
    .insertInto('club_members')
    .values({ club_id: smash.id, user_id: referee, role: 'helper', rights: ['conduct'], scope: json(next ? { kind: 'tournaments', ids: [next.id] } : { kind: 'club' }), invited_by: smash.owner_user_id })
    .execute()

  // Second club owner whose club waits for verification.
  const owner = await user('newclub@demo.nomad.kz')
  const club = await db
    .insertInto('clubs')
    .values({ slug: 'ping-pong-lab', name: 'Ping Pong Lab', description: 'Новый клуб, ждёт проверки.', city_id: almaty, status: 'review', owner_user_id: owner, contact_email: 'lab@nomad.kz', requisites: json({ legalName: 'ИП Лаборатория', bin: '990101300123', iban: 'KZ12345678901234567A', bank: 'Демо-банк', bik: '' }) })
    .returning('id')
    .executeTakeFirstOrThrow()
  await db.insertInto('club_members').values({ club_id: club.id, user_id: owner, role: 'organizer' }).execute()
  await db.insertInto('halls').values({ club_id: club.id, name: 'Основной зал', address: 'ул. Демо, 1', is_default: true }).execute()

  // Club-added players with known claim codes.
  const clubPlayers = [
    ['Тестов', 'Бекжан', 'm', 1994],
    ['Каримова', 'Сауле', 'f', 2001],
    ['Орлов', 'Глеб', 'm', 1988],
    ['Жанатов', 'Ислам', 'm', 2006],
    ['Белова', 'Вера', 'f', 1979],
  ] as const
  for (const [i, [last, first, gender, year]] of clubPlayers.entries()) {
    const p = await db
      .insertInto('players')
      .values({ first_name: first, last_name: last, gender, birth_year: year, city_id: almaty, added_by_club_id: smash.id, claim_code: DEMO_CLAIM_CODES[i]!, search_name: searchName({ lastName: last, firstName: first }), start_level: START_LEVELS.amateur })
      .returning('id')
      .executeTakeFirstOrThrow()
    await db.insertInto('player_ratings').values({ player_id: p.id, kind: 'singles', rating: null, calibration: json({ tournaments: 0 }) }).execute()
  }

  // A player account without matches whose RTTF profile exists: «Это я» demo.
  const rttfUser = await user('rttf@demo.nomad.kz')
  const rttfPlayer = await db
    .insertInto('players')
    .values({ user_id: rttfUser, first_name: 'Тимур', last_name: 'Галиев', gender: 'm', birth_year: 1990, city_id: almaty, search_name: searchName({ lastName: 'Галиев', firstName: 'Тимур' }) })
    .returning('id')
    .executeTakeFirstOrThrow()
  await db.insertInto('player_ratings').values({ player_id: rttfPlayer.id, kind: 'singles', rating: null, calibration: json({ tournaments: 0 }) }).execute()

  // RTTF base: 6 profiles for real demo players + random fictional ones.
  const seeded = await db.selectFrom('players').select(['id', 'first_name', 'last_name', 'birth_year']).where('user_id', 'is not', null).where('id', '<>', rttfPlayer.id).orderBy('id').limit(5).execute()
  const profiles: { full_name: string; birth_year: number | null; city: string; rating: number; player_id?: number | null }[] = [
    { full_name: 'Галиев Тимур', birth_year: 1990, city: 'Алматы', rating: 312 },
    ...seeded.map((p) => ({ full_name: `${p.last_name} ${p.first_name}`, birth_year: p.birth_year, city: 'Алматы', rating: 150 + Math.round(rng() * 300) })),
  ]
  const cities = ['Алматы', 'Астана', 'Шымкент', 'Караганда', 'Москва', 'Новосибирск', 'Омск']
  while (profiles.length < 200) {
    const gender = rng() < 0.75 ? 'm' : 'f'
    const first = (gender === 'm' ? MALE_FIRST : FEMALE_FIRST)[Math.floor(rng() * (gender === 'm' ? MALE_FIRST.length : FEMALE_FIRST.length))]!
    const last = surnameFor(SURNAMES[Math.floor(rng() * SURNAMES.length)]!, gender)
    profiles.push({ full_name: `${last} ${first}`, birth_year: 1960 + Math.floor(rng() * 50), city: cities[Math.floor(rng() * cities.length)]!, rating: 50 + Math.round(rng() * 550) })
  }
  const inserted = await db
    .insertInto('rttf_profiles')
    .values(profiles.map((p, i) => ({ rttf_id: String(100000 + i * 7), full_name: p.full_name, search_name: normalizeText(p.full_name), birth_year: p.birth_year, city: p.city, rating: p.rating })))
    .returning(['id', 'full_name'])
    .execute()

  // Open queue items for the admin: a claim conflict and a merge request.
  const first = seeded[0]
  const second = seeded[1]
  if (first && second) {
    const firstProfile = inserted.find((r) => r.full_name === `${first.last_name} ${first.first_name}`)
    if (firstProfile) {
      await db.updateTable('rttf_profiles').set({ player_id: first.id }).where('id', '=', firstProfile.id).execute()
      await db.insertInto('rttf_claims').values({ kind: 'claim', rttf_profile_id: firstProfile.id, player_id: second.id, status: 'conflict', reason: 'taken' }).execute()
    }
    const dup = await db.selectFrom('players').select('id').where('claim_code', '=', DEMO_CLAIM_CODES[4]!).executeTakeFirstOrThrow()
    await db.insertInto('player_merge_requests').values({ club_id: smash.id, source_player_id: dup.id, target_player_id: second.id, reason: 'Похоже, это один человек', requested_by: smash.owner_user_id }).execute()
  }
  log(`helpers, review club, ${clubPlayers.length} club players (codes ${DEMO_CLAIM_CODES.join(', ')}), ${inserted.length} RTTF profiles`)
}
