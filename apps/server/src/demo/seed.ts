// Demo data for the client presentation (stage D). Everything goes through the real services:
// tournaments are created, published, filled, started, played match by match with simulated results,
// closed and rated by the same code the product uses; bookings go through createBooking.
// Only history that cannot be created "in the past" by the API (past bookings) is inserted directly.

import { DEFAULT_BOOKING_SETTINGS, DEFAULT_ELO, emptyCalibration, rttfToElo, seededRandom, simulateMatch } from '@nomad/engine'
import type { BookingSettings, FormatTemplateId, Rng } from '@nomad/engine'
import { START_LEVELS, addDays, searchName, tenge, utcToZoned, zonedToUtc } from '@nomad/shared'
import { db, json } from '../db/index.ts'
import type { Transaction } from '../db/index.ts'
import type { Database, TournamentRestrictions } from '../db/types.ts'
import { hashPassword } from '../auth/password.ts'
import { createBooking } from '../modules/bookings.ts'
import { createTournament, publishTournament, registerPlayer } from '../modules/tournaments.ts'
import { finishTournament, playableMatches, recordResult, startTournament } from '../tournaments/structure.ts'
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from './accounts.ts'
import { seedStage1 } from './seed-stage1.ts'
import { seedStage2 } from './seed-stage2.ts'
import { FEMALE_FIRST, GUEST_NAMES, MALE_FIRST, SURNAMES, surnameFor } from './names.ts'

type Trx = Transaction<Database>
const TZ = 'Asia/Almaty'

const log = (...args: unknown[]) => console.log('[demo]', ...args)

function pick<T>(list: readonly T[], rng: Rng): T {
  return list[Math.floor(rng() * list.length)] as T
}

function normal(rng: Rng, mean: number, sd: number): number {
  const u = 1 - rng()
  const v = rng()
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

const HOURS = {
  1: { open: 8 * 60, close: 23 * 60 },
  2: { open: 8 * 60, close: 23 * 60 },
  3: { open: 8 * 60, close: 23 * 60 },
  4: { open: 8 * 60, close: 23 * 60 },
  5: { open: 8 * 60, close: 23 * 60 },
  6: { open: 10 * 60, close: 22 * 60 },
  7: { open: 10 * 60, close: 22 * 60 },
}

const BOOKING: BookingSettings = {
  ...DEFAULT_BOOKING_SETTINGS,
  defaultPricePerHour: tenge(3000),
  tariffs: [
    { name: 'Утро и день', days: [1, 2, 3, 4, 5], from: 8 * 60, to: 17 * 60, pricePerHour: tenge(2500) },
    { name: 'Вечер', days: [1, 2, 3, 4, 5], from: 17 * 60, to: 23 * 60, pricePerHour: tenge(3500) },
    { name: 'Выходные', days: [6, 7], from: 10 * 60, to: 22 * 60, pricePerHour: tenge(4000) },
  ],
}

type ClubSeed = {
  slug: string
  name: string
  city: string
  description: string
  status: 'active' | 'review'
  organizerEmail: string
  hall: { name: string; address: string; lat: number; lng: number; howToFind: string; parking: string; comment: string; tables: number; cols: number; notBookable?: number[] }
}

const CLUBS: ClubSeed[] = [
  {
    slug: 'smash-arena',
    name: 'Smash Arena',
    city: 'almaty',
    description: 'Клуб настольного тенниса в центре Алматы: 10 столов Stiga, рейтинговые турниры каждую субботу, тренировки для взрослых и детей.',
    status: 'active',
    organizerEmail: 'organizer@demo.nomad.kz',
    hall: {
      name: 'Основной зал',
      address: 'Алматы, ул. Абая, 52, 2 этаж',
      lat: 43.2401,
      lng: 76.9286,
      howToFind: 'Вход со двора, синяя дверь, 2 этаж. На ресепшене назовите фамилию.',
      parking: 'Бесплатная парковка во дворе, 15 мест',
      comment: 'Сменная обувь обязательна. Есть раздевалки и душ, ракетки и мячи можно взять в аренду.',
      tables: 10,
      cols: 3,
      notBookable: [9, 10],
    },
  },
  {
    slug: 'topspin-club',
    name: 'Topspin Club',
    city: 'almaty',
    description: 'Камерный клуб на 6 столов для любителей. Воскресные турниры «до 1300» для тех, кто растёт.',
    status: 'active',
    organizerEmail: 'topspin@demo.nomad.kz',
    hall: {
      name: 'Зал Topspin',
      address: 'Алматы, пр. Сейфуллина, 410',
      lat: 43.2565,
      lng: 76.9452,
      howToFind: 'Цокольный этаж бизнес-центра, вход с торца здания.',
      parking: 'Городская парковка у здания',
      comment: 'Душа нет, раздевалка есть. Чай и вода бесплатно.',
      tables: 6,
      cols: 3,
    },
  },
  {
    slug: 'astana-ping-pong',
    name: 'Astana Ping Pong',
    city: 'astana',
    description: 'Крупнейший любительский клуб столицы: 8 столов, турниры по субботам, корпоративные лиги.',
    status: 'active',
    organizerEmail: 'astana@demo.nomad.kz',
    hall: {
      name: 'Зал на Кабанбай батыра',
      address: 'Астана, пр. Кабанбай батыра, 11',
      lat: 51.1282,
      lng: 71.4304,
      howToFind: 'Спорткомплекс, 3 этаж, зал №2.',
      parking: 'Подземный паркинг ТРЦ рядом',
      comment: 'Раздевалки и душ на этаже. Кафе на 1 этаже.',
      tables: 8,
      cols: 4,
    },
  },
  {
    slug: 'shymkent-tt',
    name: 'Shymkent TT Center',
    city: 'shymkent',
    description: 'Теннисный центр Шымкента: 6 столов, турниры раз в две недели.',
    status: 'active',
    organizerEmail: 'shymkent@demo.nomad.kz',
    hall: {
      name: 'Центральный зал',
      address: 'Шымкент, ул. Тауке хана, 35',
      lat: 42.3155,
      lng: 69.5869,
      howToFind: 'Вход со стороны парка.',
      parking: 'Парковка у входа',
      comment: 'Кондиционеры, раздевалки, вода.',
      tables: 6,
      cols: 3,
    },
  },
  {
    slug: 'spin-house',
    name: 'Spin House',
    city: 'karaganda',
    description: 'Новый клуб в Караганде. Ожидает проверки платформой.',
    status: 'review',
    organizerEmail: 'karaganda@demo.nomad.kz',
    hall: {
      name: 'Зал',
      address: 'Караганда, ул. Ерубаева, 20',
      lat: 49.8019,
      lng: 73.1021,
      howToFind: '',
      parking: '',
      comment: '',
      tables: 4,
      cols: 2,
    },
  },
]

type SeedPlayer = { id: number; city: string; strength: number; gender: 'm' | 'f' }

export async function seedDemo(): Promise<void> {
  const rng = seededRandom(20261109)
  const started = Date.now()
  const passwordHash = await hashPassword(DEMO_PASSWORD)

  // --- Reference data -------------------------------------------------------
  const cities = await db
    .insertInto('cities')
    .values([
      { slug: 'almaty', name_ru: 'Алматы', name_kk: 'Алматы', name_en: 'Almaty', region_ru: 'Алматы', sort_order: 1 },
      { slug: 'astana', name_ru: 'Астана', name_kk: 'Астана', name_en: 'Astana', region_ru: 'Астана', sort_order: 2 },
      { slug: 'shymkent', name_ru: 'Шымкент', name_kk: 'Шымкент', name_en: 'Shymkent', region_ru: 'Шымкент', sort_order: 3 },
      { slug: 'karaganda', name_ru: 'Караганда', name_kk: 'Қарағанды', name_en: 'Karaganda', region_ru: 'Карагандинская область', sort_order: 4 },
    ])
    .returning(['id', 'slug'])
    .execute()
  const cityId = Object.fromEntries(cities.map((c) => [c.slug, c.id])) as Record<string, number>
  await db
    .insertInto('platform_settings')
    .values([
      { key: 'commission', value: json({ percent: 8, minimum: null }) },
      { key: 'elo', value: json(DEFAULT_ELO) },
    ])
    .execute()

  // --- Accounts ---------------------------------------------------------------
  const userId: Record<string, number> = {}
  const emails = new Set<string>([...DEMO_ACCOUNTS.map((a) => a.email), ...CLUBS.map((c) => c.organizerEmail)])
  for (const email of emails) {
    const row = await db
      .insertInto('users')
      .values({ email, password_hash: passwordHash, email_verified_at: new Date(), platform_role: email.startsWith('admin@') ? 'admin' : 'user' })
      .returning('id')
      .executeTakeFirstOrThrow()
    userId[email] = row.id
  }

  // --- Clubs, halls, tables -------------------------------------------------------
  const clubs: { id: number; slug: string; city: string; hallId: number; tableIds: number[]; organizer: number; status: string }[] = []
  for (const c of CLUBS) {
    const club = await db
      .insertInto('clubs')
      .values({
        slug: c.slug,
        name: c.name,
        description: c.description,
        city_id: cityId[c.city]!,
        status: c.status,
        owner_user_id: userId[c.organizerEmail]!,
        contact_email: c.organizerEmail.replace('@demo.', '@'),
        contact_telegram: `@${c.slug.replace(/-/g, '_')}`,
        telegram_url: `https://t.me/${c.slug.replace(/-/g, '_')}`,
        requisites: json({ bin: '000000000000', iban: 'KZ00 0000 0000 0000 0000', note: 'демо-реквизиты' }),
        tournament_defaults: json({ fee: tenge(4000), refundRules: [{ hoursBefore: 24, percent: 100 }], settings: { checkinWindowMinutes: 60, avgMatchMinutes: 20 } }),
        verified_at: c.status === 'active' ? new Date() : null,
      })
      .returning('id')
      .executeTakeFirstOrThrow()
    await db.insertInto('club_members').values({ club_id: club.id, user_id: userId[c.organizerEmail]!, role: 'organizer' }).execute()
    const rows = Math.ceil(c.hall.tables / c.hall.cols)
    const width = c.hall.cols * 8
    const length = rows * 5.5 + 3
    const hall = await db
      .insertInto('halls')
      .values({
        club_id: club.id,
        name: c.hall.name,
        address: c.hall.address,
        lat: c.hall.lat,
        lng: c.hall.lng,
        how_to_find: c.hall.howToFind,
        parking: c.hall.parking,
        timezone: TZ,
        opening_hours: json(HOURS),
        comment_for_players: c.hall.comment,
        equipment: json({ tables: 'Stiga Expert Roller', balls: 'Nittaku Premium 40+ ***', floor: 'спортивный линолеум' }),
        plan: json({
          width,
          length,
          landmarks: [
            { kind: 'entrance', label: 'Вход', x: width / 2, y: length - 0.5 },
            { kind: 'locker', label: 'Раздевалка', x: 1.5, y: length - 1.5, w: 3, h: 2 },
            { kind: 'window', label: 'Окна', x: width / 2, y: 0.2, w: width - 2, h: 0.3 },
          ],
        }),
        is_default: true,
      })
      .returning('id')
      .executeTakeFirstOrThrow()
    const tableIds: number[] = []
    for (let n = 1; n <= c.hall.tables; n++) {
      const col = (n - 1) % c.hall.cols
      const row = Math.floor((n - 1) / c.hall.cols)
      const t = await db
        .insertInto('hall_tables')
        .values({
          hall_id: hall.id,
          number: n,
          x: 4 + col * 8,
          y: 3 + row * 5.5,
          rotation: 0,
          bookable: !(c.hall.notBookable ?? []).includes(n),
          label: (c.hall.notBookable ?? []).includes(n) ? `Стол ${n} (секция)` : null,
          model: 'Stiga Expert Roller',
        })
        .returning('id')
        .executeTakeFirstOrThrow()
      tableIds.push(t.id)
    }
    await db.insertInto('booking_settings').values({ hall_id: hall.id, settings: json(BOOKING) }).execute()
    clubs.push({ id: club.id, slug: c.slug, city: c.city, hallId: hall.id, tableIds, organizer: userId[c.organizerEmail]!, status: c.status })
  }
  const smash = clubs[0]!
  await db
    .insertInto('club_members')
    .values({ club_id: smash.id, user_id: userId['hall@demo.nomad.kz']!, role: 'helper', rights: ['bookings', 'players'], scope: json({ kind: 'club' }), invited_by: smash.organizer })
    .execute()
  log(`clubs: ${clubs.length}`)

  // --- Players -----------------------------------------------------------------
  const players: SeedPlayer[] = []
  const createPlayer = async (p: {
    first: string
    last: string
    gender: 'm' | 'f'
    birthYear: number
    city: string
    strength: number
    rttf: boolean
    user?: number
    hand?: 'right' | 'left'
  }) => {
    const levels = Object.values(START_LEVELS)
    const startLevel = levels.reduce((best, l) => (Math.abs(l - p.strength) < Math.abs(best - p.strength) ? l : best), levels[0]!)
    const row = await db
      .insertInto('players')
      .values({
        user_id: p.user ?? null,
        first_name: p.first,
        last_name: p.last,
        gender: p.gender,
        birth_year: p.birthYear,
        city_id: cityId[p.city]!,
        hand: p.hand ?? (rng() < 0.12 ? 'left' : 'right'),
        start_level: startLevel,
        search_name: searchName({ firstName: p.first, lastName: p.last }),
      })
      .returning('id')
      .executeTakeFirstOrThrow()
    // RTTF transfer (R-16): rating from our RTTF base, no calibration, K = 40 for 5 matches.
    const rttfRating = p.rttf ? rttfToElo(Math.round((p.strength + normal(rng, 0, 60) - 700) / 2)) : null
    await db
      .insertInto('player_ratings')
      .values({
        player_id: row.id,
        kind: 'singles',
        rating: rttfRating,
        source: p.rttf ? 'rttf' : null,
        max_rating: rttfRating,
        calibration: json(emptyCalibration()),
      })
      .execute()
    players.push({ id: row.id, city: p.city, strength: p.strength, gender: p.gender })
    return row.id
  }

  const arman = await createPlayer({ first: 'Арман', last: 'Сейтов', gender: 'm', birthYear: 1991, city: 'almaty', strength: 1270, rttf: true, user: userId['player@demo.nomad.kz'] })
  await createPlayer({ first: 'Ерлан', last: 'Ахметов', gender: 'm', birthYear: 1985, city: 'almaty', strength: 1380, rttf: true, user: userId['organizer@demo.nomad.kz'] })
  const newbie = await createPlayer({ first: 'Дана', last: 'Ермекова', gender: 'f', birthYear: 1999, city: 'almaty', strength: 1020, rttf: false, user: userId['newbie@demo.nomad.kz'] })
  const cityWeights: [string, number][] = [
    ['almaty', 0.5],
    ['astana', 0.32],
    ['shymkent', 0.15],
    ['karaganda', 0.03],
  ]
  const usedNames = new Set<string>()
  for (let i = 0; i < 175; i++) {
    const gender: 'm' | 'f' = rng() < 0.78 ? 'm' : 'f'
    let first: string
    let last: string
    do {
      first = pick(gender === 'm' ? MALE_FIRST : FEMALE_FIRST, rng)
      last = surnameFor(pick(SURNAMES, rng), gender)
    } while (usedNames.has(`${last} ${first}`))
    usedNames.add(`${last} ${first}`)
    let r = rng()
    const city = cityWeights.find(([, w]) => (r -= w) < 0)?.[0] ?? 'almaty'
    const strength = Math.round(Math.min(1900, Math.max(700, normal(rng, gender === 'm' ? 1180 : 1050, 200))))
    await createPlayer({ first, last, gender, birthYear: 1962 + Math.floor(rng() * 46), city, strength, rttf: rng() < 0.7 })
  }
  // Club-added player without an account (R-8): to show «добавлен клубом».
  const clubAdded = await db
    .insertInto('players')
    .values({ first_name: 'Виктор', last_name: 'Пак', gender: 'm', birth_year: 1956, city_id: cityId.almaty!, start_level: 1000, added_by_club_id: smash.id, claim_code: '480215001', search_name: searchName({ firstName: 'Виктор', lastName: 'Пак' }) })
    .returning('id')
    .executeTakeFirstOrThrow()
  await db.insertInto('player_ratings').values({ player_id: clubAdded.id, kind: 'singles', rating: null, calibration: json(emptyCalibration()) }).execute()
  players.push({ id: clubAdded.id, city: 'almaty', strength: 1000, gender: 'm' })
  const strength = new Map(players.map((p) => [p.id, p.strength]))
  log(`players: ${players.length}`)

  // --- Past tournaments --------------------------------------------------------
  const today = utcToZoned(new Date(), TZ).date
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay() // 0 = Sunday
  const lastSaturday = addDays(today, -((weekday + 1) % 7 || 7))
  const WEEKS = 16
  let tournamentsPlayed = 0

  type Plan = {
    club: (typeof clubs)[number]
    date: string
    hour: number
    title: string
    size: number
    template: FormatTemplateId
    restrictions: TournamentRestrictions
    fee: number
    include?: number[]
    gender?: 'm' | 'f'
  }

  const formatFor = (size: number, rngValue: number): FormatTemplateId => {
    if (size <= 8) return 'round_robin'
    if (size <= 14) return 'gs2'
    if (size >= 32) return rngValue < 0.5 ? 'groups_main_consolation' : 'gs1'
    return rngValue < 0.6 ? 'gs1' : 'gs2'
  }

  const plans: Plan[] = []
  for (let w = WEEKS; w >= 1; w--) {
    const saturday = addDays(lastSaturday, -(w - 1) * 7)
    const sunday = addDays(saturday, 1)
    const bigOne = w % 4 === 0
    const smashSize = bigOne ? 32 : 16 + 4 * Math.floor(rng() * 3)
    plans.push({
      club: smash,
      date: saturday,
      hour: 11,
      title: bigOne ? 'Кубок Smash Arena (открытый)' : 'Субботний рейтинговый турнир',
      size: smashSize,
      template: formatFor(smashSize, rng()),
      restrictions: {},
      fee: tenge(bigOne ? 6000 : 4000),
      include: rng() < 0.85 ? [arman] : [],
    })
    // The «newbie» account plays only the last weekend: she is still in calibration (2 of 3 tournaments).
    if (w === 1) plans[plans.length - 1]!.include!.push(newbie)
    plans.push({ club: clubs[1]!, date: sunday, hour: 12, title: 'Воскресный турнир до 1300', size: 8 + 4 * Math.floor(rng() * 2), template: 'round_robin', restrictions: { ratingMax: 1300 }, fee: tenge(3000), include: w === 1 ? [newbie] : [] })
    plans[plans.length - 1]!.template = formatFor(plans[plans.length - 1]!.size, rng())
    const astanaSize = 12 + 4 * Math.floor(rng() * 3)
    plans.push({ club: clubs[2]!, date: saturday, hour: 10, title: w % 2 ? 'Astana Open Weekend' : 'Турнир 1000–1500', size: astanaSize, template: formatFor(astanaSize, rng()), restrictions: w % 2 ? {} : { ratingMin: 1000, ratingMax: 1500 }, fee: tenge(4000) })
    if (w % 2 === 0) plans.push({ club: clubs[3]!, date: sunday, hour: 11, title: 'Shymkent Weekend Cup', size: 8 + 4 * Math.floor(rng() * 2), template: 'round_robin', restrictions: {}, fee: tenge(3000) })
    if (w === 6) plans.push({ club: smash, date: sunday, hour: 12, title: 'Женский турнир Smash Arena', size: 8, template: 'round_robin', restrictions: { gender: 'f' }, fee: tenge(3000), gender: 'f' })
  }
  for (const plan of plans) plan.template = plan.size <= 8 ? 'round_robin' : plan.template

  const effectiveRating = async (trx: Trx, playerId: number) => {
    const r = await trx
      .selectFrom('players as p')
      .leftJoin('player_ratings as r', (j) => j.onRef('r.player_id', '=', 'p.id').on('r.kind', '=', 'singles'))
      .select(['r.rating', 'p.start_level'])
      .where('p.id', '=', playerId)
      .executeTakeFirstOrThrow()
    return r.rating ?? r.start_level
  }

  const pickParticipants = async (trx: Trx, plan: Plan): Promise<number[]> => {
    const pool = players.filter((p) => p.city === plan.club.city && (!plan.gender || p.gender === plan.gender) && (p.id !== newbie || plan.include?.includes(newbie)))
    const chosen: number[] = []
    for (const id of plan.include ?? []) if (pool.some((p) => p.id === id)) chosen.push(id)
    const shuffled = [...pool].sort(() => rng() - 0.5)
    for (const p of shuffled) {
      if (chosen.length >= plan.size) break
      if (chosen.includes(p.id)) continue
      const rating = await effectiveRating(trx, p.id)
      const r = plan.restrictions
      if ((r.ratingMax != null && rating > r.ratingMax) || (r.ratingMin != null && rating < r.ratingMin)) continue
      chosen.push(p.id)
    }
    return chosen
  }

  /** Plays every ready match until the tournament has no playable matches (or `share` of them is played). */
  const playMatches = async (trx: Trx, tournamentId: number, startAt: Date, organizer: number, tableIds: number[], share = 1) => {
    const entries = await trx.selectFrom('entries').select(['id', 'player_id']).where('tournament_id', '=', tournamentId).execute()
    const playerOf = new Map(entries.map((e) => [e.id, e.player_id]))
    const total = await trx.selectFrom('matches').select((eb) => eb.fn.countAll<number>().as('n')).where('tournament_id', '=', tournamentId).executeTakeFirstOrThrow()
    let clock = startAt.getTime()
    let played = 0
    const limit = share >= 1 ? Infinity : Math.floor(Number(total.n) * share)
    for (let guard = 0; guard < 500; guard++) {
      const ready = await playableMatches(trx, tournamentId)
      if (!ready.length || played >= limit) return ready
      for (const m of ready) {
        if (played >= limit) return playableMatches(trx, tournamentId)
        const format = { winsNeeded: 3, pointsToWin: 11 }
        const home = strength.get(playerOf.get(m.home_entry_id!)!) ?? 1000
        const away = strength.get(playerOf.get(m.away_entry_id!)!) ?? 1000
        clock += (20 * 60000) / Math.max(tableIds.length, 1)
        if (rng() < 0.01) {
          await recordResult(trx, m.id, { setsHome: 3, setsAway: 0, resultType: 'walkover', winner: rng() < 0.5 ? 'home' : 'away' }, organizer, new Date(clock))
        } else {
          const result = simulateMatch(home, away, format, rng)
          // ~10% of matches are entered without game points (allowed: «по желанию»).
          const games = rng() < 0.1 ? [] : result.games
          await recordResult(trx, m.id, { setsHome: result.setsHome, setsAway: result.setsAway, games }, organizer, new Date(clock))
        }
        played++
      }
    }
    return []
  }

  for (const plan of plans) {
    const startsAt = zonedToUtc(plan.date, plan.hour * 60, TZ)
    await db.transaction().execute(async (trx) => {
      const ids = await pickParticipants(trx, plan)
      if (ids.length < 4) return
      const t = await createTournament(trx, plan.club.id, plan.club.organizer, {
        hallId: plan.club.hallId,
        title: plan.title,
        startsAt: startsAt.toISOString(),
        template: plan.template,
        templateParams: {},
        maxParticipants: plan.size,
        fee: plan.fee,
        restrictions: plan.restrictions,
        prizes: plan.size >= 24 ? 'Кубки и медали за 1–3 места, сертификаты в спортмагазин' : 'Медали за 1–3 места',
        description: 'Рейтинговый турнир для любителей. Формат и посев — по рейтингу Nomad.',
        commentForPlayers: 'Сбор участников за 30 минут до начала. Разминка на столах с 10:30.',
        staffComment: '',
        tableIds: undefined,
        isRated: true,
        settings: {},
      })
      await publishTournament(trx, t.id, plan.club.organizer)
      for (const pid of ids) await registerPlayer(trx, t.id, pid, plan.club.organizer, { byClub: true })
      await trx.updateTable('tournaments').set({ status: 'registration_closed' }).where('id', '=', t.id).execute()
      await startTournament(trx, t.id, plan.club.organizer, startsAt)
      await playMatches(trx, t.id, startsAt, plan.club.organizer, plan.club.tableIds)
      const end = await trx.selectFrom('matches').select((eb) => eb.fn.max('finished_at').as('at')).where('tournament_id', '=', t.id).executeTakeFirstOrThrow()
      await finishTournament(trx, t.id, plan.club.organizer, (end.at as Date | null) ?? startsAt)
      // Entry fees were collected at the club.
      await trx
        .updateTable('payments')
        .set({ status: 'succeeded', updated_at: startsAt })
        .where('id', 'in', trx.selectFrom('entries').select('payment_id').where('tournament_id', '=', t.id).where('payment_id', 'is not', null).$castTo<number>())
        .execute()
      tournamentsPlayed++
    })
  }
  log(`finished tournaments: ${tournamentsPlayed}`)

  // --- A tournament running right now (home «идут сейчас», live page) -----------
  const now = new Date()
  const liveStart = new Date(now.getTime() - 80 * 60000)
  await db.transaction().execute(async (trx) => {
    const t = await createTournament(trx, clubs[2]!.id, clubs[2]!.organizer, {
      hallId: clubs[2]!.hallId,
      title: 'Astana Weekday Cup (идёт сейчас)',
      startsAt: liveStart.toISOString(),
      template: 'gs1',
      templateParams: { advance: 8 },
      maxParticipants: 16,
      fee: tenge(4000),
      restrictions: {},
      prizes: 'Медали',
      description: 'Турнир идёт прямо сейчас — откройте live-страницу.',
      commentForPlayers: '',
      staffComment: '',
      isRated: true,
      settings: {},
    })
    await publishTournament(trx, t.id, clubs[2]!.organizer)
    const plan: Plan = { club: clubs[2]!, date: today, hour: 0, title: '', size: 16, template: 'gs1', restrictions: {}, fee: 0 }
    for (const pid of await pickParticipants(trx, plan)) await registerPlayer(trx, t.id, pid, clubs[2]!.organizer, { byClub: true })
    await trx.updateTable('tournaments').set({ status: 'registration_closed' }).where('id', '=', t.id).execute()
    await startTournament(trx, t.id, clubs[2]!.organizer, liveStart)
    const remaining = await playMatches(trx, t.id, liveStart, clubs[2]!.organizer, clubs[2]!.tableIds, 0.7)
    // Some of the next matches are on the tables right now.
    for (const [i, m] of remaining.slice(0, 4).entries()) {
      await trx
        .updateTable('matches')
        .set({ status: i < 2 ? 'playing' : 'called', table_id: clubs[2]!.tableIds[i]!, called_at: new Date(now.getTime() - (8 - i) * 60000) })
        .where('id', '=', m.id)
        .execute()
    }
  })

  // --- Upcoming tournaments with registrations --------------------------------------
  const nextSaturday = addDays(lastSaturday, 7)
  const upcoming: Plan[] = [
    { club: smash, date: nextSaturday, hour: 11, title: 'Субботний рейтинговый турнир', size: 24, template: 'gs1', restrictions: {}, fee: tenge(4000), include: [arman] },
    { club: clubs[1]!, date: addDays(nextSaturday, 1), hour: 12, title: 'Воскресный турнир до 1300', size: 12, template: 'gs2', restrictions: { ratingMax: 1300 }, fee: tenge(3000), include: [newbie] },
    { club: clubs[2]!, date: nextSaturday, hour: 10, title: 'Astana Open Weekend', size: 16, template: 'gs1', restrictions: {}, fee: tenge(4000) },
    { club: smash, date: addDays(nextSaturday, 7), hour: 11, title: 'Кубок Smash Arena (открытый)', size: 32, template: 'groups_main_consolation', restrictions: {}, fee: tenge(6000) },
    { club: smash, date: addDays(nextSaturday, 8), hour: 12, title: 'Турнир 1100–1400', size: 16, template: 'gs2', restrictions: { ratingMin: 1100, ratingMax: 1400 }, fee: tenge(4000) },
    { club: clubs[3]!, date: addDays(nextSaturday, 8), hour: 11, title: 'Shymkent Weekend Cup', size: 12, template: 'gs2', restrictions: {}, fee: tenge(3000) },
    { club: clubs[2]!, date: addDays(nextSaturday, 14), hour: 10, title: 'Турнир 1000–1500', size: 24, template: 'gs1', restrictions: { ratingMin: 1000, ratingMax: 1500 }, fee: tenge(4000) },
    { club: clubs[1]!, date: addDays(nextSaturday, 15), hour: 12, title: 'Воскресный турнир до 1300', size: 8, template: 'round_robin', restrictions: { ratingMax: 1300 }, fee: tenge(3000) },
  ]
  const fill = [1.15, 0.9, 0.6, 0.45, 0.7, 0.5, 0.3, 0.2]
  for (const [i, plan] of upcoming.entries()) {
    const t = await db.transaction().execute(async (trx) => {
      const t = await createTournament(trx, plan.club.id, plan.club.organizer, {
        hallId: plan.club.hallId,
        title: plan.title,
        startsAt: zonedToUtc(plan.date, plan.hour * 60, TZ).toISOString(),
        registrationClosesAt: zonedToUtc(addDays(plan.date, -1), 22 * 60, TZ).toISOString(),
        template: plan.template,
        templateParams: {},
        maxParticipants: plan.size,
        fee: plan.fee,
        restrictions: plan.restrictions,
        prizes: plan.size >= 24 ? 'Кубки и медали за 1–3 места, сертификаты в спортмагазин' : 'Медали за 1–3 места',
        description: 'Рейтинговый турнир для любителей. Посев по рейтингу, группы и сетка — по формату ниже.',
        commentForPlayers: 'Сбор за 30 минут до начала. Check-in по QR-коду на ресепшене.',
        staffComment: 'Проверить мячи и сетки до 10:00.',
        isRated: true,
        settings: {},
      })
      await publishTournament(trx, t.id, plan.club.organizer)
      return t
    })
    const target = Math.round(plan.size * (fill[i] ?? 0.5))
    const ids = await db.transaction().execute((trx) => pickParticipants(trx, { ...plan, size: target }))
    for (const pid of ids) {
      try {
        await db.transaction().execute((trx) => registerPlayer(trx, t.id, pid, plan.club.organizer, { byClub: true }))
      } catch {
        // R-28 overlaps (two tournaments at the same time) are expected for some players: skip them.
      }
    }
  }
  // A draft for the organiser's cabinet.
  await db.transaction().execute(async (trx) => {
    await createTournament(trx, smash.id, smash.organizer, {
      hallId: smash.hallId,
      title: 'Новогодний турнир (черновик)',
      startsAt: zonedToUtc(addDays(nextSaturday, 35), 11 * 60, TZ).toISOString(),
      template: 'gs1',
      templateParams: { advance: 16 },
      maxParticipants: 32,
      fee: tenge(7000),
      restrictions: {},
      prizes: 'Призовой фонд 300 000 ₸',
      description: 'Праздничный турнир года.',
      commentForPlayers: '',
      staffComment: 'Согласовать призы со спонсором.',
      isRated: true,
      settings: {},
    })
  })
  log('upcoming tournaments created')

  // --- Bookings ------------------------------------------------------------------------
  const smashTrainingDays = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13].map((d) => addDays(today, d)).filter((d) => [2, 4].includes(new Date(`${d}T00:00:00Z`).getUTCDay()))
  for (const d of smashTrainingDays) {
    await db
      .insertInto('table_blocks')
      .values({ hall_id: smash.hallId, table_ids: smash.tableIds.slice(0, 4), starts_at: zonedToUtc(d, 17 * 60, TZ), ends_at: zonedToUtc(d, 19 * 60, TZ), kind: 'training', note: 'Детская секция', created_by: smash.organizer })
      .execute()
  }
  let bookingsMade = 0
  for (const club of clubs.filter((c) => c.status === 'active')) {
    const cityPlayers = players.filter((p) => p.city === club.city)
    for (let day = 0; day < 7; day++) {
      const date = addDays(today, day)
      for (const tableId of club.tableIds) {
        for (let hour = 9; hour < 22; hour++) {
          const evening = hour >= 18
          if (rng() > (evening ? 0.33 : 0.08)) continue
          const start = zonedToUtc(date, hour * 60, TZ)
          if (start <= now) continue
          const phone = rng() < 0.3
          const playerId = phone && rng() < 0.5 ? null : pick(cityPlayers, rng).id
          try {
            await db.transaction().execute((trx) =>
              createBooking(trx, {
                hallId: club.hallId,
                tableId,
                start,
                minutes: rng() < 0.6 ? 60 : 120,
                playerId,
                guestName: playerId ? null : pick(GUEST_NAMES, rng),
                guestContact: playerId ? null : '+7 7xx xxx xx xx',
                source: phone ? 'phone' : 'online',
                actorUserId: phone ? club.organizer : null,
              }),
            )
            bookingsMade++
          } catch {
            // Taken, blocked by a tournament or a training, outside hours: skip.
          }
        }
      }
    }
  }
  // Arman's own upcoming bookings (his cabinet).
  for (const [d, hour] of [
    [1, 19],
    [4, 20],
  ] as const) {
    const date = addDays(today, d)
    try {
      await db.transaction().execute((trx) =>
        createBooking(trx, { hallId: smash.hallId, tableId: null, start: zonedToUtc(date, hour * 60, TZ), minutes: 60, playerId: arman, source: 'online', actorUserId: userId['player@demo.nomad.kz']! }),
      )
    } catch (e) {
      log('arman booking skipped', (e as Error).message)
    }
  }
  // History for the club's player cards: past bookings with arrival / no-show.
  for (let i = 0; i < 60; i++) {
    const club = pick(clubs.filter((c) => c.status === 'active'), rng)
    const date = addDays(today, -1 - Math.floor(rng() * 20))
    const start = zonedToUtc(date, (18 + Math.floor(rng() * 4)) * 60, TZ)
    const tableId = pick(club.tableIds, rng)
    try {
      await db
        .insertInto('bookings')
        .values({
          hall_id: club.hallId,
          table_id: tableId,
          club_id: club.id,
          player_id: pick(players.filter((p) => p.city === club.city), rng).id,
          starts_at: start,
          ends_at: new Date(start.getTime() + 3600000),
          status: rng() < 0.9 ? 'arrived' : 'no_show',
          price: tenge(3500),
          source: 'online',
          created_at: new Date(start.getTime() - 2 * 86400000),
        })
        .execute()
    } catch {
      // overlapping history row: skip
    }
  }
  log(`bookings: ${bookingsMade} upcoming`)
  await seedStage1()
  await (await import('./seed-stage3.ts')).seedStage3((s) => log(s))
  await seedStage2()
  log(`done in ${Math.round((Date.now() - started) / 1000)} s`)
}
