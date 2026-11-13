// R-28: a player takes part in one tournament at a time.

import { sql } from 'kysely'
import { buildBracket, buildGroupStage } from '@nomad/engine'
import { db } from '../db/index.ts'
import type { Db, Transaction } from '../db/index.ts'
import type { Database, Tournament } from '../db/types.ts'

/** Another running tournament where one of `playerIds` is checked in or playing. */
export async function busyTournament(executor: Db | Transaction<Database>, tournamentId: number, playerIds: number[]) {
  if (!playerIds.length) return null
  const ids = sql.join(playerIds.map((id) => sql`${id}`))
  return (
    (await executor
      .selectFrom('entries as e')
      .innerJoin('tournaments as t', 't.id', 'e.tournament_id')
      .select(['t.id', 't.title', 't.slug'])
      .where('t.status', '=', 'running')
      .where('t.id', '<>', tournamentId)
      .where('e.status', 'in', ['checked_in', 'playing'])
      .where((eb) => eb.or([eb('e.player_id', 'in', playerIds), sql<boolean>`e.roster && ARRAY[${ids}]::int[]`]))
      .executeTakeFirst()) ?? null
  )
}

/** Users who organise a tournament: club organisers and its creator. */
export async function organiserUserIds(t: Pick<Tournament, 'club_id' | 'created_by'>): Promise<number[]> {
  const rows = await db.selectFrom('club_members').select('user_id').where('club_id', '=', t.club_id).where('role', '=', 'organizer').execute()
  return [...new Set([...rows.map((r) => r.user_id), ...(t.created_by ? [t.created_by] : [])])]
}

/** Entries of a tournament whose player is busy in another running one: entry id → that tournament's title. */
export async function busyElsewhere(tournamentId: number): Promise<Record<number, string>> {
  const entries = await db
    .selectFrom('entries')
    .select(['id', 'player_id', 'roster'])
    .where('tournament_id', '=', tournamentId)
    .where('status', 'in', ['paid', 'checked_in', 'awaiting_payment'])
    .execute()
  const out: Record<number, string> = {}
  for (const e of entries) {
    const busy = await busyTournament(db, tournamentId, e.roster?.length ? e.roster : [e.player_id])
    if (busy) out[e.id] = busy.title
  }
  return out
}

/** F-6: group / bracket sizes of the first stage for the players present now (confirmed by the organiser at start). */
export async function structurePreview(t: Tournament) {
  const present = t.settings.requireCheckin ? (['checked_in'] as const) : (['paid', 'checked_in'] as const)
  const row = await db.selectFrom('entries').select((eb) => eb.fn.countAll<number>().as('n')).where('tournament_id', '=', t.id).where('status', 'in', [...present]).executeTakeFirstOrThrow()
  const players = Number(row.n)
  const spec = t.format.stages[0]
  if (!spec || players < 2) return { players, groups: null, bracket: null }
  if (spec.kind === 'groups' || spec.kind === 'round_robin') {
    const plan = buildGroupStage(spec, Array.from({ length: players }, (_, i) => ({ id: String(i), rating: players - i })))
    return { players, groups: plan.groups.map((g) => g.members.length), bracket: null }
  }
  return { players, groups: null, bracket: buildBracket(spec, players).size }
}
