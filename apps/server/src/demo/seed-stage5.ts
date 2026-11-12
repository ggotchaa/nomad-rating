// Stage 5 demo data through the real services: pairs and a finished doubles tournament, teams and a finished
// team tournament (line-ups, meeting games), a 3-division league with two applied tours and a planned one.

import { MEETING_SCHEMES, seededRandom, simulateMatch } from '@nomad/engine'
import type { Rng } from '@nomad/engine'
import { addDays, zonedToUtc } from '@nomad/shared'
import { db } from '../db/index.ts'
import type { Transaction } from '../db/index.ts'
import type { Database } from '../db/types.ts'
import { createTournament, publishTournament } from '../modules/tournaments.ts'
import { finishTournament, recordResult, startTournament } from '../tournaments/structure.ts'
import { addMember, createTeam, invite, registerTeam } from '../teams/service.ts'
import { recordGame, submitLineup } from '../teams/meeting.ts'
import { addParticipants, applyTour, createLeague, createSeason, createTour, setSeasonStatus } from '../leagues/service.ts'

type Trx = Transaction<Database>
const TZ = 'Asia/Almaty'

async function strength(trx: Trx, playerIds: number[]): Promise<number> {
  const rows = await trx.selectFrom('players as p').leftJoin('player_ratings as r', (j) => j.onRef('r.player_id', '=', 'p.id').on('r.kind', '=', 'singles')).select(['r.rating', 'p.start_level']).where('p.id', 'in', playerIds).execute()
  return rows.reduce((s, r) => s + (r.rating ?? r.start_level), 0) / Math.max(1, rows.length)
}

/** Plays every scheduled match until the tournament has nothing left; meetings go game by game. */
async function playAll(trx: Trx, tournamentId: number, actor: number, at: Date, rng: Rng) {
  const t = await trx.selectFrom('tournaments').selectAll().where('id', '=', tournamentId).executeTakeFirstOrThrow()
  for (let guard = 0; guard < 500; guard++) {
    const m = await trx.selectFrom('matches').selectAll().where('tournament_id', '=', tournamentId).where('status', 'in', ['scheduled', 'called', 'playing']).where('home_entry_id', 'is not', null).where('away_entry_id', 'is not', null).orderBy('number').executeTakeFirst()
    if (!m) break
    const entries = await trx.selectFrom('entries').select(['id', 'roster', 'player_id']).where('id', 'in', [m.home_entry_id!, m.away_entry_id!]).execute()
    const roster = (id: number) => {
      const e = entries.find((x) => x.id === id)!
      return e.roster ?? [e.player_id]
    }
    if (t.type === 'team') {
      const scheme = t.settings.meeting ?? MEETING_SCHEMES.wc
      for (const side of ['home', 'away'] as const) await submitLineup(trx, t, m, side, roster(side === 'home' ? m.home_entry_id! : m.away_entry_id!).slice(0, scheme.slots), { userId: actor, byOrganizer: true }, at)
      for (let i = 0; i < scheme.games.length; i++) {
        const g = await trx.selectFrom('meeting_games').selectAll().where('match_id', '=', m.id).where('game_index', '=', i).executeTakeFirstOrThrow()
        if (g.status !== 'scheduled') continue
        const r = simulateMatch(await strength(trx, g.home_players), await strength(trx, g.away_players), t.format.match, rng)
        const current = await trx.selectFrom('matches').selectAll().where('id', '=', m.id).executeTakeFirstOrThrow()
        const res = await recordGame(trx, t, current, i, r, actor)
        if (res.finished) break
      }
    } else {
      const r = simulateMatch(await strength(trx, roster(m.home_entry_id!)), await strength(trx, roster(m.away_entry_id!)), t.format.match, rng)
      await recordResult(trx, m.id, r, actor, at)
    }
  }
  await finishTournament(trx, tournamentId, actor, new Date(at.getTime() + 3 * 3600000))
}

const base = (hallId: number, title: string, startsAt: Date) => ({
  hallId,
  title,
  startsAt: startsAt.toISOString(),
  templateParams: {},
  minParticipants: 4,
  fee: 0,
  restrictions: {},
  prizes: 'Медали за 1–3 места',
  description: '',
  commentForPlayers: '',
  staffComment: '',
  isRated: true,
  settings: {},
})

export async function seedStage5(log: (s: string) => void): Promise<void> {
  const club = await db.selectFrom('clubs').select(['id']).where('slug', '=', 'smash-arena').executeTakeFirst()
  if (!club) return
  const organizer = (await db.selectFrom('club_members').select('user_id').where('club_id', '=', club.id).where('role', '=', 'organizer').executeTakeFirstOrThrow()).user_id
  const hall = await db.selectFrom('halls').select('id').where('club_id', '=', club.id).orderBy('id').executeTakeFirstOrThrow()
  const rng = seededRandom(5005)
  const pool = (
    await db
      .selectFrom('players as p')
      .innerJoin('player_ratings as r', (j) => j.onRef('r.player_id', '=', 'p.id').on('r.kind', '=', 'singles'))
      .select(['p.id', 'p.user_id'])
      .where('r.rating', 'is not', null)
      .orderBy('r.rating', 'desc')
      .limit(60)
      .execute()
  ).map((p) => p.id)
  const me = await db.selectFrom('users as u').innerJoin('players as p', 'p.user_id', 'u.id').select('p.id').where('u.email', '=', 'player@demo.nomad.kz').executeTakeFirst()
  const day = (offset: number, hour: number) => zonedToUtc(addDays(new Date().toISOString().slice(0, 10), offset), hour * 60, TZ)

  // Pairs + finished doubles tournament.
  await db.transaction().execute(async (trx) => {
    const players = pool.slice(0, 16)
    if (me && !players.includes(me.id)) players[15] = me.id
    const teams = []
    for (let i = 0; i < 8; i++) {
      const team = await createTeam(trx, players[i * 2]!, { kind: 'pair', name: `Пара ${i + 1}` }, null)
      await addMember(trx, team.id, players[i * 2 + 1]!, null)
      teams.push(team.id)
    }
    const startsAt = day(-9, 11)
    const t = await createTournament(trx, club.id, organizer, { ...base(hall.id, 'Парный турнир Smash Arena', startsAt), type: 'doubles', template: 'round_robin', maxParticipants: 8 })
    await publishTournament(trx, t.id, organizer)
    for (const id of teams) await registerTeam(trx, t.id, id, { userId: organizer, playerId: null }, { byClub: true })
    await trx.updateTable('tournaments').set({ status: 'registration_closed' }).where('id', '=', t.id).execute()
    await startTournament(trx, t.id, organizer, startsAt)
    await playAll(trx, t.id, organizer, startsAt, rng)
  })

  // Teams of three + finished team tournament (Формат ЧМ); one more team gathering with an open invitation.
  await db.transaction().execute(async (trx) => {
    const players = pool.slice(16, 28)
    const teams = []
    for (let i = 0; i < 4; i++) {
      const team = await createTeam(trx, players[i * 3]!, { kind: 'team', name: ['Алатау', 'Барыс', 'Номад', 'Тулпар'][i]! }, null)
      for (const p of players.slice(i * 3 + 1, i * 3 + 3)) await addMember(trx, team.id, p, null)
      teams.push(team.id)
    }
    const startsAt = day(-5, 11)
    const t = await createTournament(trx, club.id, organizer, { ...base(hall.id, 'Командный кубок (Формат ЧМ)', startsAt), type: 'team', template: 'round_robin', maxParticipants: 4, settings: { meeting: MEETING_SCHEMES.wc } })
    await publishTournament(trx, t.id, organizer)
    for (const id of teams) await registerTeam(trx, t.id, id, { userId: organizer, playerId: null }, { byClub: true })
    await trx.updateTable('tournaments').set({ status: 'registration_closed' }).where('id', '=', t.id).execute()
    await startTournament(trx, t.id, organizer, startsAt)
    await playAll(trx, t.id, organizer, startsAt, rng)
    if (me) {
      const gathering = await createTeam(trx, pool[28]!, { kind: 'team', name: 'Жетысу' }, null)
      await invite(trx, gathering.id, me.id, { userId: organizer, playerId: pool[28]! })
    }
  })

  // League: 3 divisions × 6, two applied tours, the next one planned.
  await db.transaction().execute(async (trx) => {
    const league = await createLeague(trx, club.id, organizer, { name: 'Лига Smash Arena', description: 'Три дивизиона, переходы после каждого тура: двое вверх, двое вниз.', format: 'divisions' })
    const today = new Date().toISOString().slice(0, 10)
    const season = await createSeason(trx, league.id, organizer, {
      name: 'Осень',
      startsOn: addDays(today, -20),
      endsOn: addDays(today, 60),
      divisions: ['Высший', 'Первый', 'Второй'],
      rules: { boundaries: [{ promote: 2, relegate: 2 }, { promote: 2, relegate: 2 }], missedRule: 'last', bestTours: 5, toursPlanned: 6 },
      payment: { mode: 'combined', seasonPrice: 1500000, tourPrice: 300000, topUp: 100000 },
    })
    await addParticipants(trx, season.id, pool.slice(30, 48), organizer)
    await setSeasonStatus(trx, season.id, 'active', organizer)
    for (const offset of [-14, -7]) {
      const startsAt = day(offset, 18)
      const { tour, tournaments } = await createTour(trx, season.id, organizer, { startsAt: startsAt.toISOString(), hallId: hall.id })
      for (const x of tournaments) {
        await trx.updateTable('tournaments').set({ status: 'registration_closed' }).where('id', '=', x.id).execute()
        await startTournament(trx, x.id, organizer, startsAt)
        await playAll(trx, x.id, organizer, startsAt, rng)
      }
      await applyTour(trx, tour.id, organizer)
    }
    await createTour(trx, season.id, organizer, { startsAt: day(7, 18).toISOString(), deadlineAt: day(7, 23).toISOString(), hallId: hall.id })
  })
  log('stage 5: 8 pairs + doubles tournament, 4 teams + team tournament, league with 3 divisions and 2 applied tours')
}
