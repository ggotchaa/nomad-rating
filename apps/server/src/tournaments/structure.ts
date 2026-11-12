// Running a tournament on the server: start (seeding + first stage), results, automatic
// transitions between stages, finish (final places + rating). Uses @nomad/engine for all rules.

import {
  bracketPlaces,
  buildBracket,
  buildGroupStage,
  finalPlaces,
  groupStandings,
  resolveBracket,
  selectQualifiers,
  seedsFromQualifiers,
  validateMatchScore,
} from '@nomad/engine'
import type {
  Bracket,
  GameScore,
  GroupMatchResult,
  GroupOutcome,
  Participant,
  StageOutcome,
  StageSpec,
  TournamentFormat,
} from '@nomad/engine'
import { assertTransition, entryStatus, tournamentStatus } from '@nomad/shared'
import type { Transaction } from '../db/index.ts'
import { json } from '../db/index.ts'
import type { Database, Match } from '../db/types.ts'
import { audit } from '../audit.ts'
import { badRequest, conflict, unprocessable } from '../http/errors.ts'
import { applyTournamentRatings } from '../rating/service.ts'
import { revokeTournamentHelpers } from '../modules/helpers.ts'

type Trx = Transaction<Database>

const FINISHED_MATCH = ['finished', 'walkover', 'retired', 'annulled'] as const

async function loadTournament(trx: Trx, id: number) {
  return trx.selectFrom('tournaments').selectAll().where('id', '=', id).forUpdate().executeTakeFirstOrThrow()
}

async function nextMatchNumber(trx: Trx, tournamentId: number): Promise<number> {
  const row = await trx
    .selectFrom('matches')
    .select((eb) => eb.fn.max<number>('number').as('max'))
    .where('tournament_id', '=', tournamentId)
    .executeTakeFirst()
  return (row?.max ?? 0) + 1
}

/** Seeding by rating (or start level while calibrating), then the first stage of the format (M-1). */
export async function startTournament(
  trx: Trx,
  tournamentId: number,
  actorUserId: number | null,
  now = new Date(),
  options: { order?: number[] } = {},
): Promise<void> {
  const t = await loadTournament(trx, tournamentId)
  assertTransition('tournament', tournamentStatus, t.status, 'running')
  const present = t.settings.requireCheckin ? (['checked_in'] as const) : (['paid', 'checked_in'] as const)
  const entries = await trx
    .selectFrom('entries as e')
    .innerJoin('players as p', 'p.id', 'e.player_id')
    .leftJoin('player_ratings as r', (j) => j.onRef('r.player_id', '=', 'p.id').on('r.kind', '=', 'singles'))
    .select(['e.id', 'e.status', 'r.rating', 'p.start_level', 'p.added_by_club_id'])
    .where('e.tournament_id', '=', tournamentId)
    .where('e.status', 'in', [...present])
    .execute()
  if (entries.length < Math.max(2, t.min_participants)) throw unprocessable('tournament.too_few_players', { present: entries.length, min: t.min_participants })
  const seeded = entries
    .map((e) => ({ id: e.id, rating: e.rating ?? e.start_level, clubId: e.added_by_club_id }))
    .sort((a, b) => b.rating - a.rating || a.id - b.id)
  // Seeding confirmation (M-1): the organiser may reorder; unknown ids are ignored, missing ones keep rating order.
  if (options.order?.length) {
    const pos = new Map(options.order.map((id, i) => [id, i]))
    seeded.sort((a, b) => (pos.get(a.id) ?? 1e6) - (pos.get(b.id) ?? 1e6))
  }
  for (const [i, e] of seeded.entries()) {
    const current = entries.find((x) => x.id === e.id)!
    if (current.status === 'paid') assertTransition('entry', entryStatus, 'paid', 'checked_in')
    await trx
      .updateTable('entries')
      .set({ status: 'playing', seed: i + 1, rating_at_start: e.rating, updated_at: now })
      .where('id', '=', e.id)
      .execute()
  }
  const format = t.format
  for (const [index, spec] of format.stages.entries()) {
    await trx
      .insertInto('stages')
      .values({
        tournament_id: tournamentId,
        stage_key: spec.id,
        kind: spec.kind,
        name: spec.name,
        order_index: index,
        status: index === 0 ? 'running' : 'pending',
      })
      .execute()
  }
  await buildStage(
    trx,
    tournamentId,
    format.stages[0] as StageSpec,
    seeded.map((e) => String(e.id)),
    seeded.map((e) => ({ id: String(e.id), rating: e.rating, clubId: e.clubId == null ? null : String(e.clubId) })),
  )
  await trx.updateTable('tournaments').set({ status: 'running', started_at: now }).where('id', '=', tournamentId).execute()
  await audit({ actorUserId, clubId: t.club_id, entity: 'tournament', entityId: tournamentId, action: 'start', before: { status: t.status }, after: { status: 'running', players: seeded.length } }, trx)
}

/** Creates groups or a bracket of one stage for players given in seeding order. */
async function buildStage(trx: Trx, tournamentId: number, spec: StageSpec, seedIds: string[], participants: Participant[]): Promise<void> {
  const stage = await trx
    .selectFrom('stages')
    .selectAll()
    .where('tournament_id', '=', tournamentId)
    .where('stage_key', '=', spec.id)
    .executeTakeFirstOrThrow()
  let number = await nextMatchNumber(trx, tournamentId)
  if (spec.kind === 'groups' || spec.kind === 'round_robin') {
    const byId = new Map(participants.map((p) => [p.id, p]))
    const plan = buildGroupStage(spec, seedIds.map((id) => byId.get(id) ?? { id, rating: 0 }))
    const groupIds = new Map<string, number>()
    for (const [i, g] of plan.groups.entries()) {
      const row = await trx.insertInto('groups').values({ stage_id: stage.id, code: g.code, order_index: i }).returning('id').executeTakeFirstOrThrow()
      groupIds.set(g.code, row.id)
      await trx
        .insertInto('group_members')
        .values(g.members.map((m, k) => ({ group_id: row.id, entry_id: Number(m), seed_index: k + 1 })))
        .execute()
    }
    // Number group matches tour by tour across groups, so the queue goes «all first tours, then second…».
    const ordered = [...plan.matches].sort((a, b) => a.tour - b.tour || a.groupCode.localeCompare(b.groupCode))
    for (const m of ordered) {
      await trx
        .insertInto('matches')
        .values({
          tournament_id: tournamentId,
          stage_id: stage.id,
          group_id: groupIds.get(m.groupCode)!,
          number: number++,
          round: m.tour,
          tour: m.tour,
          stage_label: `group:${m.groupCode}`,
          home_entry_id: Number(m.home),
          away_entry_id: Number(m.away),
          status: 'scheduled',
        })
        .execute()
    }
  } else {
    const bracket = buildBracket(spec, seedIds.length)
    const seeds = [...seedIds.map(Number), ...Array<null>(bracket.size - seedIds.length).fill(null)]
    await trx.updateTable('stages').set({ bracket: json(bracket), seeds: json(seeds) }).where('id', '=', stage.id).execute()
    for (const m of bracket.matches) {
      await trx
        .insertInto('matches')
        .values({
          tournament_id: tournamentId,
          stage_id: stage.id,
          number: number + m.number - 1,
          bracket_number: m.number,
          round: m.round,
          stage_label: m.stageLabel,
          place_from: m.placeFrom,
          place_to: m.placeTo,
          home_source: json(m.home),
          away_source: json(m.away),
          status: 'waiting',
        })
        .execute()
    }
    await syncBracket(trx, stage.id)
  }
  await trx.updateTable('stages').set({ status: 'running' }).where('id', '=', stage.id).execute()
}

/** Fills bracket matches whose players became known; byes are passed without a game (not rated). */
async function syncBracket(trx: Trx, stageId: number): Promise<void> {
  const stage = await trx.selectFrom('stages').select(['bracket', 'seeds']).where('id', '=', stageId).executeTakeFirstOrThrow()
  const bracket = stage.bracket as Bracket
  const seeds = (stage.seeds ?? []).map((s) => (s == null ? null : String(s)))
  for (let pass = 0; pass < 8; pass++) {
    const rows = await trx.selectFrom('matches').selectAll().where('stage_id', '=', stageId).execute()
    const byNumber = new Map(rows.map((r) => [r.bracket_number as number, r]))
    const results = new Map<number, 'home' | 'away'>()
    for (const r of rows) {
      if (r.winner_entry_id != null && r.result_type !== 'bye') results.set(r.bracket_number as number, r.winner_entry_id === r.home_entry_id ? 'home' : 'away')
    }
    let changed = false
    for (const m of resolveBracket(bracket, seeds, results)) {
      const row = byNumber.get(m.number)!
      const home = m.homeSlot.kind === 'entry' ? Number(m.homeSlot.id) : null
      const away = m.awaySlot.kind === 'entry' ? Number(m.awaySlot.id) : null
      if (m.state === 'bye' && row.result_type !== 'bye') {
        const winner = m.winner.kind === 'entry' ? Number(m.winner.id) : null
        await trx
          .updateTable('matches')
          .set({ home_entry_id: home, away_entry_id: away, status: 'walkover', result_type: 'bye', winner_entry_id: winner, is_rated: false })
          .where('id', '=', row.id)
          .execute()
        changed = true
      } else if (m.state === 'ready' && row.status === 'waiting') {
        await trx.updateTable('matches').set({ home_entry_id: home, away_entry_id: away, status: 'scheduled' }).where('id', '=', row.id).execute()
        changed = true
      }
    }
    if (!changed) break
  }
}

export type ScoreInput = {
  setsHome: number
  setsAway: number
  games?: GameScore[]
  resultType?: 'normal' | 'walkover' | 'retired'
  /** For walkover / retired: who won. */
  winner?: 'home' | 'away'
}

/** Saves a match result (M-5); completes the stage and builds the next ones when everything is played (M-2). */
export async function recordResult(trx: Trx, matchId: number, input: ScoreInput, actorUserId: number | null, now = new Date()): Promise<Match> {
  const match = await trx.selectFrom('matches').selectAll().where('id', '=', matchId).forUpdate().executeTakeFirstOrThrow()
  const t = await trx.selectFrom('tournaments').select(['id', 'club_id', 'status', 'format', 'is_rated']).where('id', '=', match.tournament_id).executeTakeFirstOrThrow()
  if (t.status !== 'running') throw conflict('tournament.not_running')
  if (!['scheduled', 'called', 'playing'].includes(match.status)) throw conflict('match.not_playable')
  if (match.home_entry_id == null || match.away_entry_id == null) throw conflict('match.players_unknown')
  const type = input.resultType ?? 'normal'
  const games = input.games ?? []
  if (type === 'normal') {
    const errors = validateMatchScore({ setsHome: input.setsHome, setsAway: input.setsAway, games }, t.format.match)
    if (errors.length) throw unprocessable('match.invalid_score', errors)
  } else if (!input.winner) throw badRequest('match.winner_required')
  const winnerSide = type === 'normal' ? (input.setsHome > input.setsAway ? 'home' : 'away') : input.winner!
  const winnerEntry = winnerSide === 'home' ? match.home_entry_id : match.away_entry_id
  // Walkovers and no-shows are not rated; a retirement is rated if at least one full game was played (spec 4.4).
  const rated = t.is_rated && (type === 'normal' || (type === 'retired' && games.length > 0))
  const updated = await trx
    .updateTable('matches')
    .set({
      status: type === 'normal' ? 'finished' : type,
      result_type: type,
      sets_home: input.setsHome,
      sets_away: input.setsAway,
      games: json(games),
      winner_entry_id: winnerEntry,
      is_rated: rated,
      finished_at: now,
      version: match.version + 1,
      reported_score: null,
      reported_by: null,
      disputed: false,
    })
    .where('id', '=', matchId)
    .returningAll()
    .executeTakeFirstOrThrow()
  await audit({ actorUserId, clubId: t.club_id, entity: 'match', entityId: matchId, action: 'result', before: { status: match.status }, after: { setsHome: input.setsHome, setsAway: input.setsAway, games, type } }, trx)

  const stage = await trx.selectFrom('stages').selectAll().where('id', '=', match.stage_id).executeTakeFirstOrThrow()
  if (stage.bracket) await syncBracket(trx, stage.id)
  await autoWalkovers(trx, t.id, actorUserId, now)
  const open = await trx
    .selectFrom('matches')
    .select('id')
    .where('stage_id', '=', stage.id)
    .where('status', 'not in', [...FINISHED_MATCH])
    .executeTakeFirst()
  if (!open) await completeStage(trx, t.id, stage.id)
  return updated
}

async function groupOutcomes(trx: Trx, stageId: number, format: TournamentFormat, ratings: Record<string, number>): Promise<GroupOutcome[]> {
  const groups = await trx.selectFrom('groups').selectAll().where('stage_id', '=', stageId).orderBy('order_index').execute()
  const outcomes: GroupOutcome[] = []
  for (const g of groups) {
    const members = await trx.selectFrom('group_members').select('entry_id').where('group_id', '=', g.id).orderBy('seed_index').execute()
    const matches = await trx.selectFrom('matches').selectAll().where('group_id', '=', g.id).where('status', 'in', ['finished', 'walkover', 'retired']).execute()
    const results: GroupMatchResult[] = matches.map((m) => ({
      home: String(m.home_entry_id),
      away: String(m.away_entry_id),
      winner: m.winner_entry_id === m.home_entry_id ? 'home' : 'away',
      setsHome: m.sets_home ?? 0,
      setsAway: m.sets_away ?? 0,
      games: m.games,
      type: m.result_type === 'walkover' ? 'walkover' : m.result_type === 'retired' ? 'retired' : 'normal',
    }))
    const standings = groupStandings(
      members.map((m) => String(m.entry_id)),
      results,
      { points: format.groupPoints, tiebreaks: format.tiebreaks, ratings },
    )
    outcomes.push({ code: g.code, standings })
  }
  return outcomes
}

async function entryRatings(trx: Trx, tournamentId: number): Promise<Record<string, number>> {
  const rows = await trx
    .selectFrom('entries as e')
    .innerJoin('players as p', 'p.id', 'e.player_id')
    .select(['e.id', 'e.rating_at_start', 'p.start_level'])
    .where('e.tournament_id', '=', tournamentId)
    .execute()
  return Object.fromEntries(rows.map((r) => [String(r.id), r.rating_at_start ?? r.start_level]))
}

async function completeStage(trx: Trx, tournamentId: number, stageId: number): Promise<void> {
  const t = await trx.selectFrom('tournaments').select(['format']).where('id', '=', tournamentId).executeTakeFirstOrThrow()
  const stage = await trx.selectFrom('stages').selectAll().where('id', '=', stageId).executeTakeFirstOrThrow()
  const ratings = await entryRatings(trx, tournamentId)
  if (stage.kind === 'groups' || stage.kind === 'round_robin') {
    const outcomes = await groupOutcomes(trx, stageId, t.format, ratings)
    for (const o of outcomes) {
      await trx
        .updateTable('groups')
        .set({ standings: json(o.standings) })
        .where('stage_id', '=', stageId)
        .where('code', '=', o.code)
        .execute()
    }
    for (const transition of t.format.transitions.filter((x) => x.from === stage.stage_key)) {
      const qualifiers = selectQualifiers(transition.rule, outcomes, ratings)
      const target = t.format.stages.find((s) => s.id === transition.to)!
      const ids = target.kind === 'single_elim' || target.kind === 'all_places'
        ? seedsFromQualifiers(qualifiers).filter((x): x is string => x != null)
        : qualifiers.map((q) => q.id)
      if (ids.length >= 2) {
        // seedsFromQualifiers returns players in seed order with byes removed; keep that order as seeds.
        await buildStage(trx, tournamentId, target, ids, ids.map((id) => ({ id, rating: ratings[id] ?? 0 })))
      }
    }
  }
  await trx.updateTable('stages').set({ status: 'finished' }).where('id', '=', stageId).execute()
}

/** Closes the tournament (M-8): final places, entries completed, ratings, snapshot of the address. */
export async function finishTournament(trx: Trx, tournamentId: number, actorUserId: number | null, now = new Date(), options: { early?: boolean } = {}): Promise<void> {
  const t = await loadTournament(trx, tournamentId)
  const finalStatus = options.early ? 'finished_early' : 'finished'
  assertTransition('tournament', tournamentStatus, t.status, finalStatus)
  if (options.early) {
    // M-8: unplayed matches are annulled; players without a decided place get none.
    await trx.updateTable('matches').set({ status: 'annulled', is_rated: false, table_id: null }).where('tournament_id', '=', tournamentId).where('status', 'not in', [...FINISHED_MATCH]).execute()
  }
  const open = await trx
    .selectFrom('matches')
    .select('id')
    .where('tournament_id', '=', tournamentId)
    .where('status', 'not in', [...FINISHED_MATCH])
    .executeTakeFirst()
  if (open) throw conflict('tournament.matches_not_finished')
  const ratings = await entryRatings(trx, tournamentId)
  const stages = await trx.selectFrom('stages').selectAll().where('tournament_id', '=', tournamentId).orderBy('order_index').execute()
  const outcomes: StageOutcome[] = []
  const advanced = new Set<string>()
  for (const stage of stages) {
    if (stage.kind === 'groups' || stage.kind === 'round_robin') {
      outcomes.push({ stage: stage.stage_key, kind: 'groups', groups: await groupOutcomes(trx, stage.id, t.format, ratings) })
    } else if (stage.bracket) {
      const rows = await trx.selectFrom('matches').selectAll().where('stage_id', '=', stage.id).execute()
      const results = new Map<number, 'home' | 'away'>()
      for (const r of rows) if (r.winner_entry_id != null && r.result_type !== 'bye') results.set(r.bracket_number!, r.winner_entry_id === r.home_entry_id ? 'home' : 'away')
      const seeds = (stage.seeds ?? []).map((s) => (s == null ? null : String(s)))
      for (const s of seeds) if (s) advanced.add(s)
      outcomes.push({ stage: stage.stage_key, kind: 'bracket', places: bracketPlaces(resolveBracket(stage.bracket, seeds, results)) })
    }
  }
  const places = finalPlaces(t.format, outcomes, advanced, ratings)
  for (const p of places) {
    await trx
      .updateTable('entries')
      .set({ final_place: p.place, final_place_to: p.placeTo, updated_at: now })
      .where('id', '=', Number(p.id))
      .execute()
  }
  await trx.updateTable('entries').set({ status: 'completed', updated_at: now }).where('tournament_id', '=', tournamentId).where('status', '=', 'playing').execute()
  const hall = await trx.selectFrom('halls').select(['name', 'address', 'lat', 'lng']).where('id', '=', t.hall_id).executeTakeFirstOrThrow()
  await trx
    .updateTable('tournaments')
    .set({ status: finalStatus, finished_at: now, address_snapshot: json({ ...hall, tables: t.table_ids }) })
    .where('id', '=', tournamentId)
    .execute()
  await applyTournamentRatings(trx, tournamentId)
  await revokeTournamentHelpers(trx, tournamentId)
  await audit({ actorUserId, clubId: t.club_id, entity: 'tournament', entityId: tournamentId, action: 'finish', before: { status: t.status }, after: { status: finalStatus } }, trx)
}

/** Matches whose players are known and that are not played yet, in queue order. */
export async function playableMatches(trx: Trx, tournamentId: number) {
  return trx
    .selectFrom('matches')
    .selectAll()
    .where('tournament_id', '=', tournamentId)
    .where('status', 'in', ['scheduled', 'called', 'playing'])
    .orderBy('round')
    .orderBy('number')
    .execute()
}

/** Scheduled matches with a withdrawn player become walkovers for the opponent (M-4 «снялся»). */
async function autoWalkovers(trx: Trx, tournamentId: number, actorUserId: number | null, now: Date): Promise<void> {
  const withdrawn = await trx.selectFrom('entries').select('id').where('tournament_id', '=', tournamentId).where('status', '=', 'withdrew').execute()
  if (!withdrawn.length) return
  const ids = withdrawn.map((e) => e.id)
  const match = await trx
    .selectFrom('matches')
    .select(['id', 'home_entry_id', 'away_entry_id'])
    .where('tournament_id', '=', tournamentId)
    .where('status', 'in', ['scheduled', 'called', 'playing'])
    .where((eb) => eb.or([eb('home_entry_id', 'in', ids), eb('away_entry_id', 'in', ids)]))
    .orderBy('number')
    .executeTakeFirst()
  if (!match) return
  const homeOut = ids.includes(match.home_entry_id!)
  // recordResult calls back here, so the remaining matches are handled one by one.
  await recordResult(trx, match.id, { setsHome: 0, setsAway: 0, resultType: 'walkover', winner: homeOut ? 'away' : 'home' }, actorUserId, now)
}

/** Player leaves the running tournament: remaining matches go to opponents as walkovers. */
export async function withdrawEntry(trx: Trx, entryId: number, actorUserId: number | null, reason: string, now = new Date()): Promise<void> {
  const entry = await trx.selectFrom('entries').selectAll().where('id', '=', entryId).forUpdate().executeTakeFirstOrThrow()
  const t = await trx.selectFrom('tournaments').select(['club_id', 'status']).where('id', '=', entry.tournament_id).executeTakeFirstOrThrow()
  if (t.status !== 'running') throw conflict('tournament.not_running')
  assertTransition('entry', entryStatus, entry.status, 'withdrew')
  await trx.updateTable('entries').set({ status: 'withdrew', updated_at: now }).where('id', '=', entryId).execute()
  await audit({ actorUserId, clubId: t.club_id, entity: 'entry', entityId: entryId, action: 'withdraw', reason }, trx)
  await autoWalkovers(trx, entry.tournament_id, actorUserId, now)
}

const sourceMatch = (s: unknown): number | null => {
  const src = s as { kind: string; match?: number } | null
  return src && src.kind !== 'seed' ? (src.match ?? null) : null
}

const wasPlayed = (m: Match) => ['playing', 'finished', 'retired'].includes(m.status) || (m.status === 'walkover' && m.result_type !== 'bye')

/** Bracket matches fed (directly or further down) by match `number`. */
export function dependentMatches<M extends Pick<Match, 'bracket_number' | 'home_source' | 'away_source'>>(rows: readonly M[], number: number): M[] {
  const found = new Set<M>()
  const queue = [number]
  while (queue.length) {
    const n = queue.shift()!
    for (const r of rows) {
      if (found.has(r) || (sourceMatch(r.home_source) !== n && sourceMatch(r.away_source) !== n)) continue
      found.add(r)
      queue.push(r.bracket_number!)
    }
  }
  return [...found]
}

/**
 * Score correction with a reason (M-7). Dependent matches that have not started are rebuilt;
 * if one of them was already played the correction is refused.
 */
export async function correctResult(trx: Trx, matchId: number, input: ScoreInput, reason: string, actorUserId: number | null, now = new Date()): Promise<void> {
  const match = await trx.selectFrom('matches').selectAll().where('id', '=', matchId).forUpdate().executeTakeFirstOrThrow()
  const t = await trx.selectFrom('tournaments').select(['id', 'club_id', 'status', 'format', 'is_rated']).where('id', '=', match.tournament_id).executeTakeFirstOrThrow()
  if (t.status !== 'running') throw conflict('tournament.not_running')
  if (!['finished', 'walkover', 'retired'].includes(match.status) || match.result_type === 'bye') throw conflict('match.not_finished')
  const type = input.resultType ?? 'normal'
  const games = input.games ?? []
  if (type === 'normal') {
    const errors = validateMatchScore({ setsHome: input.setsHome, setsAway: input.setsAway, games }, t.format.match)
    if (errors.length) throw unprocessable('match.invalid_score', errors)
  } else if (!input.winner) throw badRequest('match.winner_required')
  const winnerSide = type === 'normal' ? (input.setsHome > input.setsAway ? 'home' : 'away') : input.winner!
  const winnerEntry = winnerSide === 'home' ? match.home_entry_id : match.away_entry_id
  const stage = await trx.selectFrom('stages').selectAll().where('id', '=', match.stage_id).executeTakeFirstOrThrow()
  const winnerChanged = winnerEntry !== match.winner_entry_id

  let affected: Match[] = []
  let laterStages: number[] = []
  if (stage.bracket) {
    if (winnerChanged) affected = dependentMatches(await trx.selectFrom('matches').selectAll().where('stage_id', '=', stage.id).execute(), match.bracket_number!)
  } else {
    // A group correction may change standings even with the same winner, so built later stages are rebuilt.
    laterStages = (
      await trx.selectFrom('stages').select('id').where('tournament_id', '=', t.id).where('order_index', '>', stage.order_index).where('status', '<>', 'pending').execute()
    ).map((s) => s.id)
    if (laterStages.length) affected = await trx.selectFrom('matches').selectAll().where('stage_id', 'in', laterStages).execute()
  }
  const played = affected.filter(wasPlayed)
  if (played.length) throw conflict('match.dependents_started', { matches: played.map((m) => m.number) })

  await trx
    .updateTable('matches')
    .set({
      status: type === 'normal' ? 'finished' : type,
      result_type: type,
      sets_home: input.setsHome,
      sets_away: input.setsAway,
      games: json(games),
      winner_entry_id: winnerEntry,
      is_rated: t.is_rated && (type === 'normal' || (type === 'retired' && games.length > 0)),
      version: match.version + 1,
    })
    .where('id', '=', matchId)
    .execute()
  await audit(
    {
      actorUserId,
      clubId: t.club_id,
      entity: 'match',
      entityId: matchId,
      action: 'correct',
      reason,
      before: { setsHome: match.sets_home, setsAway: match.sets_away, games: match.games, type: match.result_type },
      after: { setsHome: input.setsHome, setsAway: input.setsAway, games, type },
    },
    trx,
  )
  if (stage.bracket) {
    if (affected.length) {
      await trx
        .updateTable('matches')
        .set({ home_entry_id: null, away_entry_id: null, status: 'waiting', result_type: null, winner_entry_id: null, table_id: null, called_at: null, call_count: 0, call_responses: json({}) })
        .where('id', 'in', affected.map((m) => m.id))
        .execute()
      await syncBracket(trx, stage.id)
      await autoWalkovers(trx, t.id, actorUserId, now)
    }
    return
  }
  if (laterStages.length) {
    await trx.deleteFrom('matches').where('stage_id', 'in', laterStages).execute()
    await trx.deleteFrom('groups').where('stage_id', 'in', laterStages).execute()
    await trx.updateTable('stages').set({ status: 'pending', bracket: null, seeds: null }).where('id', 'in', laterStages).execute()
    await trx.updateTable('stages').set({ status: 'running' }).where('id', '=', stage.id).execute()
  }
  const open = await trx.selectFrom('matches').select('id').where('stage_id', '=', stage.id).where('status', 'not in', [...FINISHED_MATCH]).executeTakeFirst()
  if (!open) await completeStage(trx, t.id, stage.id)
}
