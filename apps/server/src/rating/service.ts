// Elo for closed tournaments (spec 5). Every rated match gives one event per player, every participant
// a snapshot with the full rating state before/after, so `recalculateFrom` can replay any suffix of history.
// Two kinds: singles, and doubles (D-8) — doubles tournaments and doubles games of team meetings;
// singles games of team meetings go to the singles rating.

import { DEFAULT_ELO, doublesStart, emptyCalibration, isRatedResult, rateDoublesTournament, rateTournament } from '@nomad/engine'
import type { DoublesMatch, EloParams, PlayerRatingState, PlayerTournamentResult, RatedMatch } from '@nomad/engine'
import { sql } from 'kysely'
import type { Transaction } from '../db/index.ts'
import { json } from '../db/index.ts'
import type { Database, RatingStateJson } from '../db/types.ts'
import { notify } from '../notify/index.ts'

type Trx = Transaction<Database>
type States = Map<number, RatingStateJson>
type Kind = 'singles' | 'doubles'
type KindStates = Record<Kind, States>

const FINISHED = ['finished', 'finished_early'] as const
const KINDS: Kind[] = ['singles', 'doubles']

export async function eloParams(trx: Trx): Promise<EloParams> {
  const row = await trx.selectFrom('platform_settings').select('value').where('key', '=', 'elo').executeTakeFirst()
  return { ...DEFAULT_ELO, ...((row?.value as Partial<EloParams> | undefined) ?? {}) }
}

/** A tournament changes ratings only if it is marked rated, the club is verified and it had at least 4 participants. */
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

const rowToState = (r: { rating: number | null; source: RatingStateJson['source']; rated_matches: number; tournaments: number; matches: number; wins: number; max_rating: number | null; calibration: RatingStateJson['calibration']; last_rated_at: Date | null }): RatingStateJson => ({
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

/** Loads missing states; a doubles state without history starts from the player's current singles rating. */
async function loadStates(trx: Trx, kind: Kind, playerIds: number[], all: KindStates): Promise<void> {
  const into = all[kind]
  const missing = [...new Set(playerIds)].filter((id) => !into.has(id))
  if (!missing.length) return
  const rows = await trx.selectFrom('player_ratings').selectAll().where('kind', '=', kind).where('player_id', 'in', missing).execute()
  for (const r of rows) into.set(r.player_id, rowToState(r))
  const rest = missing.filter((id) => !into.has(id))
  if (kind === 'doubles' && rest.length) {
    await loadStates(trx, 'singles', rest, all)
    for (const id of rest) {
      const s = all.singles.get(id)!
      into.set(id, { ...emptyState(), rating: s.rating, source: s.rating != null ? s.source : null })
    }
  } else for (const id of rest) into.set(id, emptyState())
}

async function saveStates(trx: Trx, kind: Kind, states: States): Promise<void> {
  const rows = [...states].map(([player_id, s]) => ({
    player_id,
    kind,
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

type Calibrated = { playerId: number; kind: Kind; rating: number; bestWin: number | null; worstLoss: number | null }
type Played = { id: number; a: number[]; b: number[]; winnerA: boolean; rated: boolean; walkover: boolean }
type Plan = { participants: Map<number, { startLevel: number; place: number | null }>; matches: Played[] }

/** Matches of one tournament per rating kind, with player ids on both sides. */
async function tournamentPlan(trx: Trx, tournamentId: number, type: 'singles' | 'doubles' | 'team', rated: boolean): Promise<Record<Kind, Plan>> {
  const entries = await trx
    .selectFrom('entries as e')
    .select(['e.id', 'e.player_id', 'e.roster', 'e.final_place'])
    .where('e.tournament_id', '=', tournamentId)
    .where('e.final_place', 'is not', null)
    .execute()
  const members = (e: (typeof entries)[number]) => (type === 'singles' ? [e.player_id] : (e.roster ?? [e.player_id]))
  const ids = [...new Set(entries.flatMap(members))]
  const levels = new Map((ids.length ? await trx.selectFrom('players').select(['id', 'start_level']).where('id', 'in', ids).execute() : []).map((p) => [p.id, p.start_level]))
  const placeOf = new Map<number, number | null>()
  for (const e of entries) for (const p of members(e)) placeOf.set(p, e.final_place)
  const byEntry = new Map(entries.map((e) => [e.id, members(e)]))
  const plan = (): Plan => ({ participants: new Map(), matches: [] })
  const out: Record<Kind, Plan> = { singles: plan(), doubles: plan() }
  const add = (kind: Kind, m: Played) => {
    out[kind].matches.push(m)
    for (const p of [...m.a, ...m.b]) out[kind].participants.set(p, { startLevel: levels.get(p) ?? 1000, place: placeOf.get(p) ?? null })
  }
  const matches = await trx
    .selectFrom('matches')
    .select(['id', 'home_entry_id', 'away_entry_id', 'winner_entry_id', 'is_rated', 'result_type', 'games'])
    .where('tournament_id', '=', tournamentId)
    .where('status', 'in', ['finished', 'retired', 'walkover'])
    .execute()
  if (type === 'team') {
    const games = matches.length
      ? await trx.selectFrom('meeting_games').selectAll().where('match_id', 'in', matches.map((m) => m.id)).where('status', '=', 'finished').execute()
      : []
    for (const g of games) add(g.kind, { id: g.id, a: g.home_players, b: g.away_players, winnerA: g.winner === 'home', rated, walkover: false })
    return out
  }
  const kind: Kind = type === 'doubles' ? 'doubles' : 'singles'
  for (const e of entries) for (const p of byEntry.get(e.id)!) out[kind].participants.set(p, { startLevel: levels.get(p) ?? 1000, place: e.final_place })
  for (const m of matches) {
    if (m.home_entry_id == null || m.away_entry_id == null || m.result_type === 'bye') continue
    const a = byEntry.get(m.home_entry_id)
    const b = byEntry.get(m.away_entry_id)
    if (!a || !b || (kind === 'doubles' && (a.length !== 2 || b.length !== 2))) continue
    add(kind, { id: m.id, a, b, winnerA: m.winner_entry_id === m.home_entry_id, rated: rated && m.is_rated && isRatedResult(m.result_type, m.games), walkover: m.result_type === 'walkover' })
  }
  return out
}

/** Rates one kind of one tournament against `all[kind]` (mutated), writes its events and snapshots. */
async function rateKind(trx: Trx, tournamentId: number, kind: Kind, plan: Plan, all: KindStates, params: EloParams, ctx: { at: Date; rated: boolean; coefficient: number }): Promise<Calibrated[]> {
  if (!plan.participants.size) return []
  const states = all[kind]
  await loadStates(trx, kind, [...plan.participants.keys()], all)
  const engineStates = new Map<string, PlayerRatingState>()
  for (const [id, p] of plan.participants) {
    const s = states.get(id)!
    const base: PlayerRatingState = { rating: s.rating, source: s.source, ratedMatches: s.rated_matches, startLevel: p.startLevel, calibration: { ...emptyCalibration(), ...s.calibration } }
    engineStates.set(String(id), kind === 'doubles' && s.tournaments === 0 && s.rated_matches === 0 ? { ...doublesStart(base, p.startLevel), calibration: base.calibration } : base)
  }
  let results: Map<string, PlayerTournamentResult>
  if (kind === 'singles') {
    const list: RatedMatch[] = plan.matches.map((m) => ({ id: String(m.id), a: String(m.a[0]), b: String(m.b[0]), winner: m.winnerA ? 'a' : 'b', rated: m.rated }))
    // «New city» bootstrap: nobody in the tournament has a rating yet, so start levels stand in for ratings.
    const bootstrap = ctx.rated && [...engineStates.values()].every((s) => s.rating == null)
    results = rateTournament(engineStates, list, { params, coefficient: ctx.coefficient, bootstrap })
  } else {
    const list: DoublesMatch[] = plan.matches.map((m) => ({ id: String(m.id), a: [String(m.a[0]), String(m.a[1])], b: [String(m.b[0]), String(m.b[1])], winner: m.winnerA ? 'a' : 'b', rated: m.rated }))
    results = rateDoublesTournament(engineStates, list, { params, coefficient: ctx.coefficient })
  }

  const stats = new Map<number, { matches: number; wins: number }>()
  for (const m of plan.matches) {
    if (m.walkover) continue
    for (const [side, won] of [[m.a, m.winnerA], [m.b, !m.winnerA]] as const)
      for (const pid of side) {
        const s = stats.get(pid) ?? { matches: 0, wins: 0 }
        s.matches++
        if (won) s.wins++
        stats.set(pid, s)
      }
  }
  // Events reference matches for singles/doubles tournaments; meeting games use the parent match.
  const matchIds = new Map<number, number>()
  if (plan.matches.length) {
    const games = await trx.selectFrom('meeting_games').select(['id', 'match_id']).where('id', 'in', plan.matches.map((m) => m.id)).execute()
    const tournamentMatches = new Set((await trx.selectFrom('matches').select('id').where('tournament_id', '=', tournamentId).execute()).map((m) => m.id))
    for (const m of plan.matches) matchIds.set(m.id, tournamentMatches.has(m.id) ? m.id : (games.find((g) => g.id === m.id)?.match_id ?? m.id))
  }

  const events = []
  const snapshots = []
  const calibrated: Calibrated[] = []
  for (const [playerId, p] of plan.participants) {
    const result = results.get(String(playerId))
    const stored = states.get(playerId)!
    const engineBefore = engineStates.get(String(playerId))!
    const before: RatingStateJson = { ...stored, rating: engineBefore.rating, source: engineBefore.source }
    const engineAfter = result?.after
    const s = stats.get(playerId) ?? { matches: 0, wins: 0 }
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
      last_rated_at: ctx.rated ? ctx.at.toISOString() : before.last_rated_at,
    }
    for (const ev of result?.events ?? []) {
      events.push({
        tournament_id: tournamentId,
        match_id: matchIds.get(Number(ev.matchId)) ?? Number(ev.matchId),
        player_id: playerId,
        opponent_id: Number(ev.opponentId),
        kind,
        rating_before: ev.ratingBefore,
        opponent_rating: Math.round(ev.opponentRating),
        expected: ev.expected,
        k: ev.k,
        score: ev.score,
        delta: ev.delta,
        created_at: ctx.at,
      })
    }
    snapshots.push({
      player_id: playerId,
      kind,
      tournament_id: tournamentId,
      rating_before: before.rating,
      rating_after: after.rating,
      delta: result?.delta ?? 0,
      place: p.place,
      matches: s.matches,
      wins: s.wins,
      calibrated: Boolean(result?.calibrated),
      at: ctx.at,
      state_before: json(stored),
      state_after: json(after),
    })
    if (result?.calibrated) calibrated.push({ playerId, kind, ...result.calibrated })
    states.set(playerId, after)
  }
  await insertChunked(trx, 'rating_events', events)
  await insertChunked(trx, 'rating_snapshots', snapshots)
  return calibrated
}

async function rateInto(trx: Trx, tournamentId: number, all: KindStates, params: EloParams): Promise<Calibrated[]> {
  const t = await trx.selectFrom('tournaments').select(['finished_at', 'starts_at', 'rating_coefficient', 'type']).where('id', '=', tournamentId).executeTakeFirstOrThrow()
  const rated = await isRatingTournament(trx, tournamentId)
  const plans = await tournamentPlan(trx, tournamentId, t.type, rated)
  const ctx = { at: t.finished_at ?? t.starts_at, rated, coefficient: Number(t.rating_coefficient) }
  const calibrated: Calibrated[] = []
  for (const kind of KINDS) calibrated.push(...(await rateKind(trx, tournamentId, kind, plans[kind], all, params, ctx)))
  return calibrated
}

const emptyKinds = (): KindStates => ({ singles: new Map(), doubles: new Map() })

export async function applyTournamentRatings(trx: Trx, tournamentId: number): Promise<void> {
  const all = emptyKinds()
  const calibrated = await rateInto(trx, tournamentId, all, await eloParams(trx))
  // Only kinds rated in this tournament are written (singles states loaded to seed doubles stay untouched).
  const touched = new Set((await trx.selectFrom('rating_snapshots').select('kind').distinct().where('tournament_id', '=', tournamentId).execute()).map((r) => r.kind))
  for (const kind of KINDS) if (touched.has(kind)) await saveStates(trx, kind, all[kind])
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
    if (userId) await notify({ userId, type: 'calibration_done', data: { tournamentId, kind: c.kind, rating: c.rating, bestWin: c.bestWin, worstLoss: c.worstLoss } }, trx)
  }
}

/**
 * Replays every finished tournament from `tournamentId` forward (by finish time, then id): restores each
 * affected player's state per kind from his first snapshot in that range, deletes the events and snapshots, rates again.
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

  const all = emptyKinds()
  const touched = new Set<Kind>()
  for (const kind of KINDS) {
    const first = await trx
      .selectFrom('rating_snapshots')
      .select(['player_id', 'state_before', 'rating_before'])
      .distinctOn('player_id')
      .where('kind', '=', kind)
      .where('tournament_id', 'in', ids)
      .orderBy('player_id')
      .orderBy('at')
      .orderBy('tournament_id')
      .execute()
    if (first.length) touched.add(kind)
    for (const s of first) {
      // Snapshots written before state columns existed: best effort from the rating before.
      all[kind].set(s.player_id, s.state_before ? { ...s.state_before, calibration: { ...emptyCalibration(), ...s.state_before.calibration } } : { ...emptyState(), rating: s.rating_before })
    }
  }
  await trx.deleteFrom('rating_events').where('tournament_id', 'in', ids).execute()
  await trx.deleteFrom('rating_snapshots').where('tournament_id', 'in', ids).execute()
  const params = await eloParams(trx)
  for (const id of ids) {
    await rateInto(trx, id, all, params)
    const kinds = await trx.selectFrom('rating_snapshots').select('kind').distinct().where('tournament_id', '=', id).execute()
    for (const k of kinds) touched.add(k.kind)
  }
  for (const kind of touched) await saveStates(trx, kind, all[kind])
  return { tournaments: ids.length, players: all.singles.size + all.doubles.size }
}
