// Applies Elo for a closed tournament (spec 5): events per match, snapshots per player, current ratings.
// The current rating is always reproducible from events + snapshots (replay comes with stage 3).

import { DEFAULT_ELO, emptyCalibration, rateTournament } from '@nomad/engine'
import type { EloParams, PlayerRatingState, RatedMatch } from '@nomad/engine'
import type { Transaction } from '../db/index.ts'
import { json } from '../db/index.ts'
import type { Database } from '../db/types.ts'

type Trx = Transaction<Database>

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

export async function applyTournamentRatings(trx: Trx, tournamentId: number): Promise<void> {
  const t = await trx.selectFrom('tournaments').select(['id', 'finished_at', 'starts_at']).where('id', '=', tournamentId).executeTakeFirstOrThrow()
  const at = t.finished_at ?? t.starts_at
  const rated = await isRatingTournament(trx, tournamentId)
  const entries = await trx
    .selectFrom('entries')
    .select(['id', 'player_id', 'final_place'])
    .where('tournament_id', '=', tournamentId)
    .where('final_place', 'is not', null)
    .execute()
  const playerOf = new Map(entries.map((e) => [e.id, e.player_id]))
  const matches = await trx
    .selectFrom('matches')
    .select(['id', 'home_entry_id', 'away_entry_id', 'winner_entry_id', 'is_rated', 'result_type'])
    .where('tournament_id', '=', tournamentId)
    .where('status', 'in', ['finished', 'retired', 'walkover'])
    .execute()
  const playerIds = entries.map((e) => e.player_id)
  const ratingRows = playerIds.length
    ? await trx.selectFrom('player_ratings').selectAll().where('kind', '=', 'singles').where('player_id', 'in', playerIds).execute()
    : []
  const players = playerIds.length
    ? await trx.selectFrom('players').select(['id', 'start_level']).where('id', 'in', playerIds).execute()
    : []
  const startLevel = new Map(players.map((p) => [p.id, p.start_level]))
  const states = new Map<string, PlayerRatingState>()
  for (const id of playerIds) {
    const r = ratingRows.find((x) => x.player_id === id)
    states.set(String(id), {
      rating: r?.rating ?? null,
      source: r?.source ?? null,
      ratedMatches: r?.rated_matches ?? 0,
      startLevel: startLevel.get(id) ?? 1000,
      calibration: { ...emptyCalibration(), ...(r?.calibration ?? {}) },
    })
  }
  const list: RatedMatch[] = matches
    .filter((m) => m.home_entry_id != null && m.away_entry_id != null && m.result_type !== 'bye')
    .map((m) => ({
      id: String(m.id),
      a: String(playerOf.get(m.home_entry_id!)),
      b: String(playerOf.get(m.away_entry_id!)),
      winner: m.winner_entry_id === m.home_entry_id ? 'a' : 'b',
      rated: rated && m.is_rated,
    }))
  const params = await eloParams(trx)
  const results = rateTournament(states, list, { params })

  // Match statistics for every participant (also in unrated tournaments: they show in the history).
  const stats = new Map<number, { matches: number; wins: number }>()
  for (const m of matches) {
    if (m.result_type === 'bye' || m.home_entry_id == null || m.away_entry_id == null) continue
    for (const entryId of [m.home_entry_id, m.away_entry_id]) {
      const pid = playerOf.get(entryId)!
      const s = stats.get(pid) ?? { matches: 0, wins: 0 }
      if (m.result_type !== 'walkover') s.matches++
      if (m.winner_entry_id === entryId && m.result_type !== 'walkover') s.wins++
      stats.set(pid, s)
    }
  }

  for (const e of entries) {
    const result = results.get(String(e.player_id))
    const before = states.get(String(e.player_id))!
    const after = result?.after ?? before
    const s = stats.get(e.player_id) ?? { matches: 0, wins: 0 }
    for (const ev of result?.events ?? []) {
      await trx
        .insertInto('rating_events')
        .values({
          tournament_id: tournamentId,
          match_id: Number(ev.matchId),
          player_id: e.player_id,
          opponent_id: Number(ev.opponentId),
          kind: 'singles',
          rating_before: ev.ratingBefore,
          opponent_rating: ev.opponentRating,
          expected: ev.expected,
          k: ev.k,
          score: ev.score,
          delta: ev.delta,
          created_at: at,
        })
        .execute()
    }
    await trx
      .insertInto('rating_snapshots')
      .values({
        player_id: e.player_id,
        kind: 'singles',
        tournament_id: tournamentId,
        rating_before: before.rating,
        rating_after: after.rating,
        delta: result?.delta ?? 0,
        place: e.final_place,
        matches: s.matches,
        wins: s.wins,
        calibrated: Boolean(result?.calibrated),
        at,
      })
      .onConflict((oc) => oc.columns(['player_id', 'kind', 'tournament_id']).doNothing())
      .execute()
    const existing = ratingRows.find((x) => x.player_id === e.player_id)
    const maxRating = Math.max(existing?.max_rating ?? 0, after.rating ?? 0) || null
    const values = {
      rating: after.rating,
      source: after.source,
      rated_matches: after.ratedMatches,
      tournaments: (existing?.tournaments ?? 0) + 1,
      matches: (existing?.matches ?? 0) + s.matches,
      wins: (existing?.wins ?? 0) + s.wins,
      max_rating: maxRating,
      calibration: json(after.calibration),
      last_rated_at: rated ? at : (existing?.last_rated_at ?? null),
      updated_at: new Date(),
    }
    await trx
      .insertInto('player_ratings')
      .values({ player_id: e.player_id, kind: 'singles', ...values })
      .onConflict((oc) => oc.columns(['player_id', 'kind']).doUpdateSet(values))
      .execute()
  }
}
