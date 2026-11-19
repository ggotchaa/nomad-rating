// Changing the draw by hand: draft of the first stage before the start (T-8), players added during the tournament (T-9),
// swaps (T-10). Played matches are never touched; unstarted ones are rebuilt. Every change is audited.

import { bracketSizeFor, bracketSizeWarnings, isBracketKind, planGroups } from '@nomad/engine'
import type { PlannedGroup, StageWarning } from '@nomad/engine'
import { assertTransition, entryStatus } from '@nomad/shared'
import type { Transaction } from '../db/index.ts'
import { json } from '../db/index.ts'
import type { Database, Match, Stage, Tournament, TournamentDraft } from '../db/types.ts'
import { audit } from '../audit.ts'
import { badRequest, conflict, unprocessable } from '../http/errors.ts'
import { playerName } from '../modules/players.ts'
import { teamSeedRating } from '../teams/ratings.ts'
import {
  dependentMatches,
  loadTournament,
  nextMatchNumber,
  recordResult,
  stageSeeds,
  syncBracket,
  wasPlayed,
} from './structure.ts'

type Trx = Transaction<Database>

const BEFORE_START = ['draft', 'published', 'registration_closed']

async function seededEntries(trx: Trx, t: Tournament, statuses: readonly string[]) {
  const entries = await trx
    .selectFrom('entries as e')
    .innerJoin('players as p', 'p.id', 'e.player_id')
    .leftJoin('player_ratings as r', (j) => j.onRef('r.player_id', '=', 'p.id').on('r.kind', '=', 'singles'))
    .select(['e.id', 'e.roster', 'r.rating', 'p.start_level', 'p.added_by_club_id'])
    .where('e.tournament_id', '=', t.id)
    .where('e.status', 'in', [...statuses] as never)
    .execute()
  if (t.type !== 'singles')
    for (const e of entries)
      e.rating = await teamSeedRating(trx, t.type === 'doubles' ? 'pair' : 'team', e.roster ?? [])
  return entries
    .map((e) => ({
      id: String(e.id),
      rating: e.rating ?? e.start_level,
      clubId: e.added_by_club_id == null ? null : String(e.added_by_club_id),
    }))
    .sort((a, b) => b.rating - a.rating || Number(a.id) - Number(b.id))
}

const presentStatuses = (t: Tournament) => (t.settings.requireCheckin ? ['checked_in'] : ['paid', 'checked_in'])

// ---------------------------------------------------------------------------
// Draft (T-8)

/** Groups or bracket of the first stage before registration and check-in close, marked «Черновик». */
export async function generateDraft(
  trx: Trx,
  tournamentId: number,
  actorUserId: number | null,
  options: { presentOnly?: boolean } = {},
): Promise<TournamentDraft> {
  const t = await loadTournament(trx, tournamentId)
  if (!BEFORE_START.includes(t.status)) throw conflict('draft.already_started')
  const seeded = await seededEntries(
    trx,
    t,
    options.presentOnly ? presentStatuses(t) : ['awaiting_payment', 'paid', 'checked_in'],
  )
  if (seeded.length < 2) throw unprocessable('draft.too_few_players', { players: seeded.length })
  const spec = t.format.stages[0]!
  let draft: TournamentDraft
  const base = { stage: spec.id, generatedAt: new Date().toISOString(), entries: seeded.map((p) => Number(p.id)) }
  if (spec.kind === 'groups' || spec.kind === 'round_robin') {
    if (seeded.length < 3 && spec.kind === 'groups')
      throw unprocessable('draft.too_few_players', { players: seeded.length })
    const plan = planGroups(spec, seeded)
    draft = {
      ...base,
      groups: plan.groups.map((g) => ({ code: g.code, members: g.members.map(Number) })),
      warnings: plan.warnings,
    }
  } else {
    const size = bracketSizeFor(seeded.length)
    draft = {
      ...base,
      seeds: Array.from({ length: size }, (_, i) => (seeded[i] ? Number(seeded[i]!.id) : null)),
      warnings: bracketSizeWarnings(seeded.length),
    }
  }
  await trx
    .updateTable('tournaments')
    .set({ draft: json(draft) })
    .where('id', '=', t.id)
    .execute()
  await audit(
    {
      actorUserId,
      clubId: t.club_id,
      entity: 'tournament',
      entityId: t.id,
      action: t.draft ? 'draft_rebuild' : 'draft_generate',
      after: { players: seeded.length, presentOnly: Boolean(options.presentOnly) },
    },
    trx,
  )
  return draft
}

async function draftOf(trx: Trx, tournamentId: number) {
  const t = await loadTournament(trx, tournamentId)
  if (!BEFORE_START.includes(t.status)) throw conflict('draft.already_started')
  if (!t.draft) throw conflict('draft.none')
  return { t, draft: structuredClone(t.draft) }
}

async function saveDraft(
  trx: Trx,
  t: Tournament,
  draft: TournamentDraft,
  action: string,
  after: Record<string, unknown>,
  actorUserId: number | null,
) {
  await trx
    .updateTable('tournaments')
    .set({ draft: json(draft) })
    .where('id', '=', t.id)
    .execute()
  await audit({ actorUserId, clubId: t.club_id, entity: 'tournament', entityId: t.id, action, after }, trx)
}

export async function publishDraft(
  trx: Trx,
  tournamentId: number,
  publish: boolean,
  actorUserId: number | null,
): Promise<void> {
  const { t } = await draftOf(trx, tournamentId)
  await trx
    .updateTable('tournaments')
    .set({ draft_published_at: publish ? new Date() : null })
    .where('id', '=', t.id)
    .execute()
  await audit(
    {
      actorUserId,
      clubId: t.club_id,
      entity: 'tournament',
      entityId: t.id,
      action: publish ? 'draft_publish' : 'draft_unpublish',
    },
    trx,
  )
}

export async function clearDraft(trx: Trx, tournamentId: number, actorUserId: number | null): Promise<void> {
  const { t } = await draftOf(trx, tournamentId)
  await trx.updateTable('tournaments').set({ draft: null, draft_published_at: null }).where('id', '=', t.id).execute()
  await audit({ actorUserId, clubId: t.club_id, entity: 'tournament', entityId: t.id, action: 'draft_clear' }, trx)
}

type DraftPosition = { group: number; index: number } | { seed: number }
const positionIn = (draft: TournamentDraft, entryId: number): DraftPosition | null => {
  const g = draft.groups?.findIndex((x) => x.members.includes(entryId)) ?? -1
  if (g >= 0) return { group: g, index: draft.groups![g]!.members.indexOf(entryId) }
  const seed = draft.seeds?.indexOf(entryId) ?? -1
  return seed >= 0 ? { seed } : null
}

/** Swaps two players of the draft (any position, before the start everything is free). */
export async function draftSwap(
  trx: Trx,
  tournamentId: number,
  a: number,
  b: number,
  actorUserId: number | null,
): Promise<void> {
  const { t, draft } = await draftOf(trx, tournamentId)
  const pa = positionIn(draft, a)
  const pb = positionIn(draft, b)
  if (!pa || !pb) throw badRequest('draft.unknown_entry')
  if ('seed' in pa && 'seed' in pb) {
    draft.seeds![pa.seed] = b
    draft.seeds![pb.seed] = a
  } else if ('group' in pa && 'group' in pb) {
    draft.groups![pa.group]!.members[pa.index] = b
    draft.groups![pb.group]!.members[pb.index] = a
  }
  await saveDraft(trx, t, draft, 'draft_swap', { a, b }, actorUserId)
}

/** Moves a player to another group, or to a bracket slot (swapping with whoever is there). */
export async function draftMove(
  trx: Trx,
  tournamentId: number,
  entryId: number,
  to: { group?: string; seed?: number },
  actorUserId: number | null,
): Promise<void> {
  const { t, draft } = await draftOf(trx, tournamentId)
  const from = positionIn(draft, entryId)
  if (!from) throw badRequest('draft.unknown_entry')
  if ('group' in from) {
    const target = draft.groups!.find((g) => g.code === to.group)
    if (!target) throw badRequest('draft.unknown_group')
    draft.groups![from.group]!.members.splice(from.index, 1)
    target.members.push(entryId)
  } else {
    const seed = (to.seed ?? 0) - 1
    if (seed < 0 || seed >= draft.seeds!.length) throw badRequest('draft.unknown_slot')
    draft.seeds![from.seed] = draft.seeds![seed] ?? null
    draft.seeds![seed] = entryId
  }
  await saveDraft(trx, t, draft, 'draft_move', { entryId, ...to }, actorUserId)
}

/** A new registration goes to a free place: the smallest group or the first empty bracket slot. */
export async function draftAddToFreeSlot(
  trx: Trx,
  tournamentId: number,
  entryId: number,
  actorUserId: number | null,
): Promise<void> {
  const { t, draft } = await draftOf(trx, tournamentId)
  if (positionIn(draft, entryId)) throw conflict('draft.already_in')
  const entry = await trx
    .selectFrom('entries')
    .select(['id', 'status'])
    .where('id', '=', entryId)
    .where('tournament_id', '=', t.id)
    .executeTakeFirst()
  if (!entry || !['awaiting_payment', 'paid', 'checked_in'].includes(entry.status))
    throw badRequest('draft.unknown_entry')
  if (draft.groups) {
    const smallest = [...draft.groups].sort((a, b) => a.members.length - b.members.length)[0]!
    smallest.members.push(entryId)
  } else {
    const free = draft.seeds!.lastIndexOf(null)
    if (free < 0) throw conflict('draft.no_free_slot')
    draft.seeds![free] = entryId
  }
  draft.entries.push(entryId)
  await saveDraft(trx, t, draft, 'draft_add', { entryId }, actorUserId)
}

/**
 * Layout of the first stage at the start: the draft without the players who did not come; newcomers take free places.
 * Returns null when the draft no longer fits (then the stage is built from the seeding as usual).
 */
export function layoutFromDraft(
  draft: TournamentDraft | null,
  presentIds: readonly string[],
): { groups?: PlannedGroup[]; seeds?: (string | null)[] } | null {
  if (!draft) return null
  const present = new Set(presentIds)
  const placed = new Set<string>()
  if (draft.groups) {
    const groups = draft.groups.map((g) => ({
      code: g.code,
      members: g.members.map(String).filter((id) => present.has(id)),
    }))
    for (const g of groups) for (const id of g.members) placed.add(id)
    for (const id of presentIds)
      if (!placed.has(id)) [...groups].sort((a, b) => a.members.length - b.members.length)[0]!.members.push(id)
    return groups.every((g) => g.members.length >= 2) ? { groups } : null
  }
  const drafted = (draft.seeds ?? []).map((id) => (id == null ? null : String(id)))
  const same =
    drafted.filter(Boolean).length === presentIds.length && drafted.every((id) => id == null || present.has(id))
  if (same) return { seeds: drafted }
  // Players left or came: keep the drafted order but close the gaps, so byes still go to the strongest.
  const order = [
    ...drafted.filter((id): id is string => id != null && present.has(id)),
    ...presentIds.filter((id) => !drafted.includes(id)),
  ]
  return { seeds: Array.from({ length: bracketSizeFor(order.length) }, (_, i) => order[i] ?? null) }
}

/** Draft for the tournament page: shown to players only when published. */
export async function draftView(trx: Pick<Trx, 'selectFrom'>, t: Tournament, staff: boolean) {
  const draft = t.draft
  if (!draft || !BEFORE_START.includes(t.status) || (!staff && !t.draft_published_at)) return null
  const ids = [
    ...new Set([
      ...(draft.groups?.flatMap((g) => g.members) ?? []),
      ...(draft.seeds?.filter((x): x is number => x != null) ?? []),
    ]),
  ]
  const rows = await trx
    .selectFrom('entries as e')
    .innerJoin('players as p', 'p.id', 'e.player_id')
    .leftJoin('teams as tm', 'tm.id', 'e.team_id')
    .leftJoin('player_ratings as r', (j) => j.onRef('r.player_id', '=', 'p.id').on('r.kind', '=', 'singles'))
    .select([
      'e.id',
      'e.status',
      'p.id as player_id',
      'p.first_name',
      'p.last_name',
      'p.start_level',
      'r.rating',
      'tm.name as team_name',
    ])
    .where('e.tournament_id', '=', t.id)
    .execute()
  const ref = (id: number | null) => {
    const e = rows.find((r) => r.id === id)
    return e
      ? {
          entryId: e.id,
          playerId: e.player_id,
          name: e.team_name ?? playerName(e),
          rating: e.rating ?? e.start_level,
          status: e.status,
        }
      : null
  }
  const active = rows.filter((r) => ['awaiting_payment', 'paid', 'checked_in'].includes(r.status))
  return {
    published: Boolean(t.draft_published_at),
    generatedAt: draft.generatedAt,
    stage: draft.stage,
    kind: t.format.stages.find((s) => s.id === draft.stage)?.kind ?? null,
    warnings: staff ? draft.warnings : [],
    groups: draft.groups?.map((g) => ({ code: g.code, members: g.members.map(ref).filter(Boolean) })) ?? null,
    seeds: draft.seeds?.map(ref) ?? null,
    // Registered after the draft was made: «Пересобрать» or «Добавить в свободный слот».
    newEntries: staff ? active.filter((r) => !ids.includes(r.id)).map((r) => ref(r.id)) : [],
    // In the draft but not coming any more (cancelled, or not checked in once check-in is required).
    absent: staff
      ? ids.filter(
          (id) =>
            !active.some((r) => r.id === id) ||
            (t.settings.requireCheckin && rows.find((r) => r.id === id)?.status !== 'checked_in'),
        )
      : [],
  }
}

// ---------------------------------------------------------------------------
// Locks (T-10): who can be moved after the stage started

export type LockReason = 'match_called' | 'match_played' | 'waiting_group' | 'not_in_stage'

/** Why an entry can't be moved in a running stage, or null when it can. */
export function lockReason(
  stage: Pick<Stage, 'kind' | 'seeds' | 'seed_slots'>,
  matches: readonly Match[],
  entryId: number,
): LockReason | null {
  if (isBracketKind(stage.kind)) {
    const seed = stageSeeds(stage).indexOf(String(entryId)) + 1
    if (!seed) return 'not_in_stage'
    const first = matches.find((m) =>
      [m.home_source, m.away_source].some(
        (s) => (s as { kind?: string; seed?: number } | null)?.kind === 'seed' && (s as { seed: number }).seed === seed,
      ),
    )
    if (!first) return null
    if (first.status === 'called' || first.status === 'playing') return 'match_called'
    if (wasPlayed(first) || dependentMatches(matches, first.bracket_number!).some(wasPlayed)) return 'match_played'
    return null
  }
  const own = matches.filter((m) => m.home_entry_id === entryId || m.away_entry_id === entryId)
  if (!own.length) return 'not_in_stage'
  if (own.some((m) => m.status === 'called' || m.status === 'playing')) return 'match_called'
  if (own.some((m) => wasPlayed(m))) return 'match_played'
  return null
}

async function stageByKey(trx: Trx, tournamentId: number, stageKey: string) {
  const stage = await trx
    .selectFrom('stages')
    .selectAll()
    .where('tournament_id', '=', tournamentId)
    .where('stage_key', '=', stageKey)
    .executeTakeFirst()
  if (!stage) throw badRequest('stage.not_found')
  return stage
}

const seedOf = (s: unknown) => {
  const src = s as { kind?: string; seed?: number } | null
  return src?.kind === 'seed' ? (src.seed ?? 0) : 0
}

/** Puts new seeds into a running bracket: first-round matches of changed seeds and what they feed are rebuilt. */
async function reseedBracket(trx: Trx, stage: Stage, seeds: (string | null | undefined)[]): Promise<void> {
  const current = stageSeeds(stage)
  const changed = new Set(current.flatMap((id, i) => (id !== seeds[i] ? [i + 1] : [])))
  if (!changed.size) return
  const rows = await trx.selectFrom('matches').selectAll().where('stage_id', '=', stage.id).execute()
  const direct = rows.filter((r) => changed.has(seedOf(r.home_source)) || changed.has(seedOf(r.away_source)))
  const affected = [...new Set(direct.flatMap((d) => [d, ...dependentMatches(rows, d.bracket_number!)]))]
  if (affected.some(wasPlayed)) throw conflict('swap.locked', { reason: 'match_played' })
  await trx
    .updateTable('stages')
    .set({ seeds: json(seeds.map((id) => (id == null ? null : Number(id)))) })
    .where('id', '=', stage.id)
    .execute()
  await trx
    .updateTable('matches')
    .set({
      home_entry_id: null,
      away_entry_id: null,
      status: 'waiting',
      result_type: null,
      winner_entry_id: null,
      table_id: null,
      called_at: null,
      call_count: 0,
      call_responses: json({}),
    })
    .where(
      'id',
      'in',
      affected.map((m) => m.id),
    )
    .execute()
  await syncBracket(trx, stage.id)
}

/** Swaps two players of a running stage (T-10): only players whose match is not called, playing or played. */
export async function swapEntries(
  trx: Trx,
  tournamentId: number,
  stageKey: string,
  a: number,
  b: number,
  reason: string,
  actorUserId: number | null,
): Promise<void> {
  const t = await loadTournament(trx, tournamentId)
  if (t.status !== 'running') throw conflict('tournament.not_running')
  const stage = await stageByKey(trx, tournamentId, stageKey)
  if (stage.status !== 'running') throw conflict('stage.not_running')
  const matches = await trx.selectFrom('matches').selectAll().where('stage_id', '=', stage.id).execute()
  for (const id of [a, b]) {
    const lock = lockReason(stage, matches, id)
    if (lock) throw conflict('swap.locked', { entryId: id, reason: lock })
  }
  if (isBracketKind(stage.kind)) {
    const seeds = stageSeeds(stage)
    const ia = seeds.indexOf(String(a))
    const ib = seeds.indexOf(String(b))
    seeds[ia] = String(b)
    seeds[ib] = String(a)
    await reseedBracket(trx, stage, seeds)
  } else {
    const groups = await trx
      .selectFrom('group_members as gm')
      .innerJoin('groups as g', 'g.id', 'gm.group_id')
      .select(['gm.group_id', 'gm.entry_id'])
      .where('g.stage_id', '=', stage.id)
      .where('gm.entry_id', 'in', [a, b])
      .execute()
    const ga = groups.find((g) => g.entry_id === a)!.group_id
    const gb = groups.find((g) => g.entry_id === b)!.group_id
    if (ga !== gb) {
      await trx
        .updateTable('group_members')
        .set({ group_id: gb })
        .where('group_id', '=', ga)
        .where('entry_id', '=', a)
        .execute()
      await trx
        .updateTable('group_members')
        .set({ group_id: ga })
        .where('group_id', '=', gb)
        .where('entry_id', '=', b)
        .execute()
      for (const [group, from, to] of [
        [ga, a, b],
        [gb, b, a],
      ] as const) {
        await trx
          .updateTable('matches')
          .set({ home_entry_id: to })
          .where('group_id', '=', group)
          .where('home_entry_id', '=', from)
          .execute()
        await trx
          .updateTable('matches')
          .set({ away_entry_id: to })
          .where('group_id', '=', group)
          .where('away_entry_id', '=', from)
          .execute()
      }
    }
  }
  await audit(
    { actorUserId, clubId: t.club_id, entity: 'stage', entityId: stage.id, action: 'swap', reason, after: { a, b } },
    trx,
  )
}

// ---------------------------------------------------------------------------
// Player added during the tournament (T-9)

export type LateEntryInput = {
  playerId: number
  stageKey: string
  group?: string
  seed?: number
  /** The bracket slot is taken: move its player to a free slot. */
  confirmSwap?: boolean
  payment: 'on_site' | 'waived'
  /** Group matches already missed: play them, technical results, or leave them out (never rated). */
  missed: 'play' | 'technical' | 'ignore'
}

export async function addLateEntry(
  trx: Trx,
  tournamentId: number,
  input: LateEntryInput,
  actorUserId: number | null,
  now = new Date(),
): Promise<number> {
  const t = await loadTournament(trx, tournamentId)
  if (t.status !== 'running') throw conflict('tournament.not_running')
  if (t.type !== 'singles') throw conflict('entry.late_singles_only')
  const stage = await stageByKey(trx, tournamentId, input.stageKey)
  if (stage.status !== 'running') throw conflict('stage.not_running')
  const busy = await trx
    .selectFrom('entries')
    .select('id')
    .where('tournament_id', '=', t.id)
    .where('player_id', '=', input.playerId)
    .where('status', 'in', ['awaiting_payment', 'paid', 'checked_in', 'playing'])
    .executeTakeFirst()
  if (busy) throw conflict('entry.already_registered')
  const player = await trx
    .selectFrom('players as p')
    .leftJoin('player_ratings as r', (j) => j.onRef('r.player_id', '=', 'p.id').on('r.kind', '=', 'singles'))
    .select(['p.id', 'p.start_level', 'r.rating'])
    .where('p.id', '=', input.playerId)
    .executeTakeFirst()
  if (!player) throw badRequest('player.not_found')
  const maxSeed = await trx
    .selectFrom('entries')
    .select((eb) => eb.fn.max<number>('seed').as('m'))
    .where('tournament_id', '=', t.id)
    .executeTakeFirst()
  const entry = await trx
    .insertInto('entries')
    .values({
      tournament_id: t.id,
      player_id: player.id,
      status: 'playing',
      seed: (maxSeed?.m ?? 0) + 1,
      rating_at_start: player.rating ?? player.start_level,
      registered_by: actorUserId,
      checked_in_at: now,
      late_payment: input.payment,
    })
    .returning('id')
    .executeTakeFirstOrThrow()

  if (isBracketKind(stage.kind)) {
    const seeds = stageSeeds(stage)
    const index = (input.seed ?? 0) - 1
    if (index < 0 || index >= seeds.length) throw badRequest('slot.unknown')
    if (seeds[index] === undefined) throw conflict('slot.waiting_group')
    const taken = seeds[index]
    if (taken) {
      if (!input.confirmSwap) throw conflict('slot.taken', { entryId: Number(taken) })
      const free = seeds.lastIndexOf(null)
      if (free < 0) throw conflict('slot.no_free')
      seeds[free] = taken
    }
    seeds[index] = String(entry.id)
    await reseedBracket(trx, stage, seeds)
  } else {
    const group = await trx
      .selectFrom('groups')
      .selectAll()
      .where('stage_id', '=', stage.id)
      .where('code', '=', input.group ?? '')
      .executeTakeFirst()
    if (!group) throw badRequest('group.not_found')
    const members = await trx
      .selectFrom('group_members as gm')
      .innerJoin('entries as e', 'e.id', 'gm.entry_id')
      .select(['gm.entry_id', 'gm.seed_index', 'e.status'])
      .where('gm.group_id', '=', group.id)
      .orderBy('gm.seed_index')
      .execute()
    await trx
      .insertInto('group_members')
      .values({ group_id: group.id, entry_id: entry.id, seed_index: (members.at(-1)?.seed_index ?? 0) + 1 })
      .execute()
    const lastTour = await trx
      .selectFrom('matches')
      .select((eb) => eb.fn.max<number>('tour').as('m'))
      .where('group_id', '=', group.id)
      .executeTakeFirst()
    let number = await nextMatchNumber(trx, t.id)
    const created: number[] = []
    for (const [i, m] of members.filter((x) => x.status !== 'withdrew').entries()) {
      const tour = (lastTour?.m ?? 0) + 1 + i
      const row = await trx
        .insertInto('matches')
        .values({
          tournament_id: t.id,
          stage_id: stage.id,
          group_id: group.id,
          number: number++,
          round: tour,
          tour,
          stage_label: `group:${group.code}`,
          home_entry_id: m.entry_id,
          away_entry_id: entry.id,
          status: input.missed === 'ignore' ? 'annulled' : 'scheduled',
          is_rated: input.missed === 'play',
          excluded: input.missed === 'ignore',
        })
        .returning('id')
        .executeTakeFirstOrThrow()
      created.push(row.id)
    }
    if (input.missed === 'technical')
      for (const id of created)
        await recordResult(
          trx,
          id,
          { setsHome: 0, setsAway: 0, resultType: 'walkover', winner: 'home' },
          actorUserId,
          now,
        )
  }
  await audit(
    {
      actorUserId,
      clubId: t.club_id,
      entity: 'entry',
      entityId: entry.id,
      action: 'late_add',
      after: {
        playerId: input.playerId,
        stage: input.stageKey,
        group: input.group,
        seed: input.seed,
        payment: input.payment,
        missed: input.missed,
      },
    },
    trx,
  )
  return entry.id
}

/** Removes a player who has not played yet (added by mistake, T-9). */
export async function removeUnplayedEntry(
  trx: Trx,
  entryId: number,
  reason: string,
  actorUserId: number | null,
  now = new Date(),
): Promise<void> {
  const entry = await trx
    .selectFrom('entries')
    .selectAll()
    .where('id', '=', entryId)
    .forUpdate()
    .executeTakeFirstOrThrow()
  const t = await loadTournament(trx, entry.tournament_id)
  if (t.status !== 'running') throw conflict('tournament.not_running')
  const own = await trx
    .selectFrom('matches')
    .selectAll()
    .where('tournament_id', '=', t.id)
    .where((eb) => eb.or([eb('home_entry_id', '=', entryId), eb('away_entry_id', '=', entryId)]))
    .execute()
  if (own.some((m) => wasPlayed(m))) throw conflict('entry.has_played_matches')
  const stages = await trx
    .selectFrom('stages')
    .selectAll()
    .where('tournament_id', '=', t.id)
    .where('status', '=', 'running')
    .execute()
  for (const stage of stages) {
    if (isBracketKind(stage.kind)) {
      const seeds = stageSeeds(stage)
      const i = seeds.indexOf(String(entryId))
      if (i >= 0) {
        seeds[i] = null
        await reseedBracket(trx, stage, seeds)
      }
    } else {
      await trx
        .deleteFrom('matches')
        .where('stage_id', '=', stage.id)
        .where((eb) => eb.or([eb('home_entry_id', '=', entryId), eb('away_entry_id', '=', entryId)]))
        .execute()
      await trx
        .deleteFrom('group_members')
        .where('entry_id', '=', entryId)
        .where('group_id', 'in', (eb) => eb.selectFrom('groups').select('id').where('stage_id', '=', stage.id))
        .execute()
    }
  }
  assertTransition('entry', entryStatus, entry.status, 'withdrew')
  await trx.updateTable('entries').set({ status: 'withdrew', updated_at: now }).where('id', '=', entryId).execute()
  await audit(
    { actorUserId, clubId: t.club_id, entity: 'entry', entityId: entryId, action: 'remove_unplayed', reason },
    trx,
  )
}

export type { StageWarning }
