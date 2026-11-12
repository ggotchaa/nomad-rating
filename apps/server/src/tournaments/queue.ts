// Tables screen / live page state: tables with their current match and the queue of ready matches (M-3, M-6).

import { planQueue } from '@nomad/engine'
import { db } from '../db/index.ts'
import type { CallResponses, Tournament } from '../db/types.ts'
import { playerName } from '../modules/players.ts'

export type MatchSide = { entryId: number; playerId: number; userId: number | null; name: string; rating: number | null }

export async function conductState(t: Tournament, now = new Date()) {
  const tables = await db.selectFrom('hall_tables').select(['id', 'number']).where('id', 'in', t.table_ids.length ? t.table_ids : [0]).orderBy('number').execute()
  const entries = await db
    .selectFrom('entries as e')
    .innerJoin('players as p', 'p.id', 'e.player_id')
    .leftJoin('player_ratings as r', (j) => j.onRef('r.player_id', '=', 'p.id').on('r.kind', '=', 'singles'))
    .select(['e.id', 'e.status', 'e.seed', 'e.checked_in_at', 'e.rating_at_start', 'p.id as player_id', 'p.user_id', 'p.first_name', 'p.last_name', 'p.start_level', 'r.rating'])
    .where('e.tournament_id', '=', t.id)
    .execute()
  const side = new Map<number, MatchSide>(
    entries.map((e) => [e.id, { entryId: e.id, playerId: e.player_id, userId: e.user_id, name: playerName(e), rating: e.rating_at_start ?? e.rating }]),
  )
  const matches = await db.selectFrom('matches').selectAll().where('tournament_id', '=', t.id).orderBy('number').execute()
  const tableNumber = new Map(tables.map((x) => [x.id, x.number]))
  const view = (m: (typeof matches)[number]) => ({
    id: m.id,
    number: m.number,
    round: m.round,
    label: m.stage_label,
    placeFrom: m.place_from,
    placeTo: m.place_to,
    status: m.status,
    resultType: m.result_type,
    home: m.home_entry_id ? (side.get(m.home_entry_id) ?? null) : null,
    away: m.away_entry_id ? (side.get(m.away_entry_id) ?? null) : null,
    tableId: m.table_id,
    table: m.table_id ? (tableNumber.get(m.table_id) ?? null) : null,
    calledAt: m.called_at,
    startedAt: m.started_at,
    finishedAt: m.finished_at,
    callCount: m.call_count,
    callResponses: m.call_responses as CallResponses,
    setsHome: m.sets_home,
    setsAway: m.sets_away,
    games: m.games,
    winnerEntryId: m.winner_entry_id,
    version: m.version,
    reportedScore: m.reported_score,
    reportedBy: m.reported_by,
    disputed: m.disputed,
  })
  const active = matches.filter((m) => m.status === 'called' || m.status === 'playing')
  const busy = new Set(active.flatMap((m) => [m.home_entry_id!, m.away_entry_id!]))
  const lastFinished = new Map<number, Date>()
  for (const m of matches) {
    if (!m.finished_at || m.result_type === 'bye') continue
    for (const id of [m.home_entry_id, m.away_entry_id]) {
      if (id == null) continue
      const prev = lastFinished.get(id)
      if (!prev || prev < m.finished_at) lastFinished.set(id, m.finished_at)
    }
  }
  const usedTables = new Set(active.map((m) => m.table_id))
  const ready = matches.filter((m) => m.status === 'scheduled' && m.home_entry_id && m.away_entry_id)
  const plan = planQueue({
    matches: ready.map((m) => ({ id: m.id, players: [m.home_entry_id!, m.away_entry_id!], order: m.round * 100000 + m.number })),
    freeTables: tables.filter((x) => !usedTables.has(x.id)).map((x) => x.id),
    busy,
    lastFinished,
    restMinutes: t.settings.restMinutes ?? t.format.restMinutes ?? 0,
    now,
  })
  const byId = new Map(matches.map((m) => [m.id, m]))
  return {
    tables: tables.map((x) => {
      const m = active.find((a) => a.table_id === x.id)
      return { id: x.id, number: x.number, match: m ? view(m) : null }
    }),
    queue: plan.map((p) => ({ ...view(byId.get(p.matchId)!), suggestedTableId: p.tableId, suggestedTable: p.tableId ? tableNumber.get(p.tableId) : null, waitReason: p.waitReason, readyAt: p.readyAt })),
    attention: matches.filter((m) => m.disputed || m.reported_score).map(view),
    recent: matches
      .filter((m) => m.finished_at && m.result_type !== 'bye')
      .sort((a, b) => b.finished_at!.getTime() - a.finished_at!.getTime())
      .slice(0, 20)
      .map(view),
    entries: entries
      .map((e) => ({ entryId: e.id, playerId: e.player_id, name: playerName(e), status: e.status, seed: e.seed, checkedInAt: e.checked_in_at, rating: e.rating_at_start ?? e.rating ?? e.start_level, calibrating: e.rating == null }))
      .sort((a, b) => (a.seed ?? 1e6) - (b.seed ?? 1e6) || b.rating - a.rating),
  }
}
