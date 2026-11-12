// Manual checks (not unit tests), everything inside a rolled-back transaction:
//   npx tsx --env-file=.env apps/server/src/rating/replay-check.ts          replay from the first tournament == incremental ratings
//   npx tsx --env-file=.env apps/server/src/rating/replay-check.ts --perf   generate 100 000 rated matches and time the replay

import { sql } from 'kysely'
import { db, json } from '../db/index.ts'
import type { Transaction } from '../db/index.ts'
import type { Database } from '../db/types.ts'
import { applyTournamentRatings, recalculateFrom } from './service.ts'

class Rollback extends Error {}

const snapshot = async (trx: Transaction<Database>) =>
  new Map(
    (await trx.selectFrom('player_ratings').select(['player_id', 'rating', 'rated_matches', 'tournaments', 'matches', 'wins', 'max_rating', 'calibration']).where('kind', '=', 'singles').execute()).map((r) => [
      r.player_id,
      JSON.stringify({ ...r, calibration: { tournaments: r.calibration.tournaments ?? 0, bestWin: r.calibration.bestWin ?? null, worstLoss: r.calibration.worstLoss ?? null } }),
    ]),
  )

async function verify(trx: Transaction<Database>) {
  const first = await trx.selectFrom('tournaments').select('id').where('status', 'in', ['finished', 'finished_early']).orderBy(sql`coalesce(finished_at, starts_at)`).orderBy('id').executeTakeFirstOrThrow()
  const before = await snapshot(trx)
  const events = await trx.selectFrom('rating_events').select((eb) => eb.fn.sum<number>('delta').as('s')).executeTakeFirstOrThrow()
  const started = Date.now()
  const result = await recalculateFrom(trx, first.id)
  const after = await snapshot(trx)
  const events2 = await trx.selectFrom('rating_events').select((eb) => eb.fn.sum<number>('delta').as('s')).executeTakeFirstOrThrow()
  const diff = [...before].filter(([id, v]) => after.get(id) !== v)
  console.log(`replayed ${result.tournaments} tournaments / ${result.players} players in ${Date.now() - started} ms`)
  console.log(`players compared: ${before.size}, differing: ${diff.length}, event delta sum ${Number(events.s).toFixed(6)} → ${Number(events2.s).toFixed(6)}`)
  for (const [id, v] of diff.slice(0, 5)) console.log(' ', v, '\n  →', after.get(id))
  if (diff.length) process.exitCode = 1
}

async function perf(trx: Transaction<Database>) {
  const TOURNAMENTS = 2223
  const PER = 10 // round robin of 10 → 45 matches; 2223 × 45 ≈ 100 000
  const club = await trx.selectFrom('clubs').select(['id']).where('status', '=', 'active').executeTakeFirstOrThrow()
  const hall = await trx.selectFrom('halls').select('id').where('club_id', '=', club.id).executeTakeFirstOrThrow()
  const format = (await trx.selectFrom('tournaments').select('format').executeTakeFirstOrThrow()).format
  const players = (await trx.selectFrom('players').select('id').limit(600).execute()).map((p) => p.id)
  const strength = new Map(players.map((id) => [id, Math.random()]))
  const base = Date.now() + 86400_000 * 400
  console.log(`generating ${TOURNAMENTS} tournaments…`)
  let firstId = 0
  let total = 0
  for (let i = 0; i < TOURNAMENTS; i++) {
    const at = new Date(base + i * 3600_000)
    const t = await trx
      .insertInto('tournaments')
      .values({ club_id: club.id, hall_id: hall.id, slug: `perf-${i}-${at.getTime()}`, title: `perf ${i}`, status: 'finished', starts_at: at, estimated_end_at: at, finished_at: at, max_participants: PER, format: json(format), is_rated: true })
      .returning('id')
      .executeTakeFirstOrThrow()
    firstId ||= t.id
    const stage = await trx.insertInto('stages').values({ tournament_id: t.id, stage_key: 'rr', kind: 'round_robin', name: 'RR', order_index: 0, status: 'finished' }).returning('id').executeTakeFirstOrThrow()
    const picked = [...players].sort(() => Math.random() - 0.5).slice(0, PER)
    const entries = await trx
      .insertInto('entries')
      .values(picked.map((player_id, k) => ({ tournament_id: t.id, player_id, status: 'completed' as const, final_place: k + 1 })))
      .returning(['id', 'player_id'])
      .execute()
    const matches = []
    let n = 0
    for (let a = 0; a < entries.length; a++)
      for (let b = a + 1; b < entries.length; b++) {
        const ea = entries[a]!
        const eb = entries[b]!
        const homeWins = Math.random() < 0.5 + (strength.get(ea.player_id)! - strength.get(eb.player_id)!) / 2
        matches.push({ tournament_id: t.id, stage_id: stage.id, number: ++n, round: 1, status: 'finished' as const, result_type: 'normal' as const, home_entry_id: ea.id, away_entry_id: eb.id, winner_entry_id: homeWins ? ea.id : eb.id, sets_home: homeWins ? 3 : 1, sets_away: homeWins ? 1 : 3 })
      }
    await trx.insertInto('matches').values(matches).execute()
    total += matches.length
    await applyTournamentRatings(trx, t.id)
  }
  const before = await snapshot(trx)
  console.log(`generated ${total} matches; replaying…`)
  const started = Date.now()
  const result = await recalculateFrom(trx, firstId)
  const ms = Date.now() - started
  const after = await snapshot(trx)
  const diff = [...before].filter(([id, v]) => after.get(id) !== v).length
  console.log(`replay: ${result.tournaments} tournaments, ${total} matches, ${result.players} players in ${(ms / 1000).toFixed(1)} s (target ≤ 300 s); differing players: ${diff}`)
}

try {
  await db.transaction().execute(async (trx) => {
    if (process.argv.includes('--perf')) await perf(trx)
    else await verify(trx)
    throw new Rollback()
  })
} catch (e) {
  if (!(e instanceof Rollback)) {
    console.error(e)
    process.exitCode = 1
  }
} finally {
  await db.destroy()
  setTimeout(() => process.exit(process.exitCode ?? 0), 500)
}
