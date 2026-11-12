// Elo for closed tournaments (spec 5). Every rated match gives one event per player, every participant
// a snapshot with the full rating state before/after, so `recalculateFrom` can replay any suffix of history.

import { DEFAULT_ELO, emptyCalibration, isRatedResult, rateTournament } from '@nomad/engine'
import type { EloParams, PlayerRatingState, PlayerTournamentResult, RatedMatch } from '@nomad/engine'
import { sql } from 'kysely'
import type { Transaction } from '../db/index.ts'
import { json } from '../db/index.ts'
import type { Database, RatingStateJson } from '../db/types.ts'
import { notify } from '../notify/index.ts'

type Trx = Transaction<Database>
type States = Map<number, RatingStateJson>

const FINISHED = ['finished', 'finished_early'] as const

export async function eloParams(trx: Trx): Promise<EloParams> {
  const row = await trx.selectFrom('platform_settings').select('value').where('key', '=', 'elo').executeTakeFirst()
  return { ...DEFAULT_ELO, ...((row?.value as Partial<EloParams> | undefined) ?? {}) }
}

/** A tournament changes ratings only if it is marked rated, the club is verified and it had at least 4 players. */
export async function isRatingTournament(trx: Trx, tournamentId: number): Promise<boolean> {
  const t = await trx
    .selectFrom('tournaments as t')
    .innerJoin('clubs as c', 'c.id', 't.club_id')
    .select(['t.is_rated', 'c.status'])
    .where('t.id', '=', tournamentId)
    .executeTakeFirstOrThrow()
  const players = await trx
    .selectFrom('entries')
    .select((eb) => eb.fn.countAll<number>().as('n'))
    .where('tournament_id', '=', tournamentId)
    .where('final_place', 'is not', null)
    .executeTakeFirstOrThrow()
  return t.is_rated && t.status === 'active' && Number(players.n) >= 4
}

const emptyState = (): RatingStateJson => ({
  rating: null,
  source: null,
  rated_matches: 0,
  tournaments: 0,
  matches: 0,
  wins: 0,
  max_rating: null,
  calibration: emptyCalibration(),
  last_rated_at: null,
})

async function loadStates(trx: Trx, playerIds: number[], into: States = new Map()): Promise<States> {
  const missing = playerIds.filter((id) => !into.has(id))
  if (!missing.length) return into
  const rows = await trx.selectFrom('player_ratings').selectAll().where('kind', '=', 'singles').where('player_id', 'in', missing).execute()
  for (const id of missing) into.set(id, emptyState())
  for (const r of rows) {
    into.set(r.player_id, {
      rating: r.rating,
      source: r.source,
      rated_matches: r.rated_matches,
      tournaments: r.tournaments,
      matches: r.matches,
      wins: r.wins,
      max_rating: r.max_rating,
      calibration: { ...emptyCalibration(), ...r.calibration },
      last_rated_at: r.last_rated_at ? r.last_rated_at.toISOString() : null,
    })
  }
  return into
}

async function saveStates(trx: Trx, states: States): Promise<void> {
  const rows = [...states].map(([player_id, s]) => ({
    player_id,
    kind: 'singles' as const,
    rating: s.rating,
    source: s.source,
    rated_matches: s.rated_matches,
    tournaments: s.tournaments,
    matches: s.matches,
    wins: s.wins,
    max_rating: s.max_rating,
    calibration: json(s.calibration),
    last_rated_at: s.last_rated_at,
    updated_at: new Date(),
  }))
  for (let i = 0; i < rows.length; i += 2000) {
    await trx
      .insertInto('player_ratings')
      .values(rows.slice(i, i + 2000))
      .onConflict((oc) =>
        oc.columns(['player_id', 'kind']).doUpdateSet((eb) => ({
          rating: eb.ref('excluded.rating'),
          source: eb.ref('excluded.source'),
          rated_matches: eb.ref('excluded.rated_matches'),
          tournaments: eb.ref('excluded.tournaments'),
          matches: eb.ref('excluded.matches'),
          wins: eb.ref('excluded.wins'),
          max_rating: eb.ref('excluded.max_rating'),
          calibration: eb.ref('excluded.calibration'),
          last_rated_at: eb.ref('excluded.last_rated_at'),
          updated_at: eb.ref('excluded.updated_at'),
        })),
      )
      .execute()
  }
}

async function insertChunked<T extends 'rating_events' | 'rating_snapshots'>(trx: Trx, table: T, rows: Parameters<ReturnType<Trx['insertInto']>['values']>[0][]): Promise<void> {
  for (let i = 0; i < rows.length; i += 2000) await trx.insertInto(table).values(rows.slice(i, i + 2000) as never).execute()
}

type Calibrated = { playerId: number; rating: number; bestWin: number | null; worstLoss: number | null }

/** Rates one tournament against `states` (mutated), writes its events and snapshots. */
async function rateInto(trx: Trx, tournamentId: number, states: States, params: EloParams): Promise<Calibrated[]> {
  const t = await trx
    .selectFrom('tournaments')
    .select(['finished_at', 'starts_at', 'rating_coefficient'])
    .where('id', '=', tournamentId)
    .executeTakeFirstOrThrow()
  const at = t.finished_at ?? t.starts_at
  const rated = await isRatingTournament(trx, tournamentId)
  const entries = await trx
    .selectFrom('entries as e')
    .innerJoin('players as p', 'p.id', 'e.player_id')
    .select(['e.id', 'e.player_id', 'e.final_place', 'p.start_level'])
    .where('e.tournament_id', '=', tournamentId)
    .where('e.final_place', 'is not', null)
    .execute()
  const playerOf = new Map(entries.map((e) => [e.id, e.player_id]))
  const matches = await trx
    .selectFrom('matches')
    .select(['id', 'home_entry_id', 'away_entry_id', 'winner_entry_id', 'is_rated', 'result_type', 'games'])
    .where('tournament_id', '=', tournamentId)
    .where('status', 'in', ['finished', 'retired', 'walkover'])
    .execute()
  await loadStates(
    trx,
    entries.map((e) => e.player_id),
    states,
  )

  const engineStates = new Map<string, PlayerRatingState>()
  for (const e of entries) {
    const s = states.get(e.player_id)!
    engineStates.set(String(e.player_id), {
      rating: s.rating,
      source: s.source,
      ratedMatches: s.rated_matches,
      startLevel: e.start_level,
      calibration: { ...emptyCalibration(), ...s.calibration },
    })
  }
  const played = matches.filter((m) => m.home_entry_id != null && m.away_entry_id != null && m.result_type !== 'bye' && playerOf.has(m.home_entry_id) && playerOf.has(m.away_entry_id))
  const list: RatedMatch[] = played.map((m) => ({
    id: String(m.id),
    a: String(playerOf.get(m.home_entry_id!)),
    b: String(playerOf.get(m.away_entry_id!)),
    winner: m.winner_entry_id === m.home_entry_id ? 'a' : 'b',
    rated: rated && m.is_rated && isRatedResult(m.result_type, m.games),
  }))
  // «New city» bootstrap: nobody in the tournament has a rating yet, so start levels stand in for ratings.
  const bootstrap = rated && [...engineStates.values()].every((s) => s.rating == null)
  const results: Map<string, PlayerTournamentResult> = rateTournament(engineStates, list, { params, coefficient: Number(t.rating_coefficient), bootstrap })

  const stats = new Map<number, { matches: number; wins: number }>()
  for (const m of played) {
    if (m.result_type === 'walkover') continue
    for (const entryId of [m.home_entry_id!, m.away_entry_id!]) {
      const pid = playerOf.get(entryId)!
      const s = stats.get(pid) ?? { matches: 0, wins: 0 }
      s.matches++
      if (m.winner_entry_id === entryId) s.wins++
      stats.set(pid, s)
    }
  }

  const events = []
  const snapshots = []
  const calibrated: Calibrated[] = []
  for (const e of entries) {
    const result = results.get(String(e.player_id))
    const before = states.get(e.player_id)!
    const engineAfter = result?.after
    const s = stats.get(e.player_id) ?? { matches: 0, wins: 0 }
    const rating = engineAfter ? engineAfter.rating : before.rating
    const after: RatingStateJson = {
      rating,
      source: engineAfter ? engineAfter.source : before.source,
      rated_matches: engineAfter ? engineAfter.ratedMatches : before.rated_matches,
      tournaments: before.tournaments + 1,
      matches: before.matches + s.matches,
      wins: before.wins + s.wins,
      max_rating: Math.max(before.max_rating ?? 0, rating ?? 0) || null,
      calibration: engineAfter ? engineAfter.calibration : before.calibration,
      last_rated_at: rated ? at.toISOString() : before.last_rated_at,
    }
    for (const ev of result?.events ?? []) {
      events.push({
        tournament_id: tournamentId,
        match_id: Number(ev.matchId),
        player_id: e.player_id,
        opponent_id: Number(ev.opponentId),
        kind: 'singles' as const,
        rating_before: ev.ratingBefore,
        opponent_rating: ev.opponentRating,
        expected: ev.expected,
        k: ev.k,
        score: ev.score,
        delta: ev.delta,
        created_at: at,
      })
    }
    snapshots.push({
      player_id: e.player_id,
      kind: 'singles' as const,
      tournament_id: tournamentId,
      rating_before: before.rating,
      rating_after: after.rating,
      delta: result?.delta ?? 0,
      place: e.final_place,
      matches: s.matches,
      wins: s.wins,
      calibrated: Boolean(result?.calibrated),
      at,
      state_before: json(before),
      state_after: json(after),
    })
    if (result?.calibrated) calibrated.push({ playerId: e.player_id, ...result.calibrated })
    states.set(e.player_id, after)
  }
  await insertChunked(trx, 'rating_events', events)
  await insertChunked(trx, 'rating_snapshots', snapshots)
  return calibrated
}

export async function applyTournamentRatings(trx: Trx, tournamentId: number): Promise<void> {
  const states: States = new Map()
  const calibrated = await rateInto(trx, tournamentId, states, await eloParams(trx))
  await saveStates(trx, states)
  if (!calibrated.length) return
  const users = await trx
    .selectFrom('players')
    .select(['id', 'user_id'])
    .where(
      'id',
      'in',
      calibrated.map((c) => c.playerId),
    )
    .execute()
  for (const c of calibrated) {
    const userId = users.find((u) => u.id === c.playerId)?.user_id
    if (userId) await notify({ userId, type: 'calibration_done', data: { tournamentId, rating: c.rating, bestWin: c.bestWin, worstLoss: c.worstLoss } }, trx)
  }
}

/**
 * Replays every finished tournament from `tournamentId` forward (by finish time, then id): restores each
 * affected player's state from his first snapshot in that range, deletes the events and snapshots, rates again.
 */
export async function recalculateFrom(trx: Trx, tournamentId: number): Promise<{ tournaments: number; players: number }> {
  const start = await trx.selectFrom('tournaments').select(['id', 'finished_at', 'starts_at']).where('id', '=', tournamentId).executeTakeFirstOrThrow()
  const startAt = start.finished_at ?? start.starts_at
  const order = sql<Date>`coalesce(finished_at, starts_at)`
  const tournaments = await trx
    .selectFrom('tournaments')
    .select('id')
    .where('status', 'in', [...FINISHED])
    .where((eb) => eb.or([eb(order, '>', startAt), eb.and([eb(order, '=', startAt), eb('id', '>=', start.id)])]))
    .orderBy(order)
    .orderBy('id')
    .execute()
  const ids = tournaments.map((t) => t.id)
  if (!ids.length) return { tournaments: 0, players: 0 }

  const states: States = new Map()
  const first = await trx
    .selectFrom('rating_snapshots')
    .select(['player_id', 'state_before', 'rating_before'])
    .distinctOn('player_id')
    .where('kind', '=', 'singles')
    .where('tournament_id', 'in', ids)
    .orderBy('player_id')
    .orderBy('at')
    .orderBy('tournament_id')
    .execute()
  const legacy: number[] = []
  for (const s of first) {
    if (s.state_before) states.set(s.player_id, { ...s.state_before, calibration: { ...emptyCalibration(), ...s.state_before.calibration } })
    else legacy.push(s.player_id)
  }
  // Snapshots written before state columns existed: best effort from the rating before.
  for (const id of legacy) states.set(id, { ...emptyState(), rating: first.find((f) => f.player_id === id)!.rating_before })

  await trx.deleteFrom('rating_events').where('kind', '=', 'singles').where('tournament_id', 'in', ids).execute()
  await trx.deleteFrom('rating_snapshots').where('kind', '=', 'singles').where('tournament_id', 'in', ids).execute()
  const params = await eloParams(trx)
  for (const id of ids) await rateInto(trx, id, states, params)
  await saveStates(trx, states)
  return { tournaments: ids.length, players: states.size }
}
