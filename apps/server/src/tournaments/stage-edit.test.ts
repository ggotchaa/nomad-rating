// Draft → start → early final → slot fill → swap → late player, against a real database (rolled back at the end).
// Runs only with DATABASE_URL pointing at a seeded database (`npm run dev:reset`).

import { afterAll, describe, expect, it } from 'vitest'

const enabled = Boolean(process.env.DATABASE_URL)
class Rollback extends Error {}

describe.skipIf(!enabled)('draw changes during a tournament (database)', () => {
  let close: (() => Promise<void>) | undefined
  afterAll(async () => close?.())

  it('groups → сетка −2 opened early, filled group by group', async () => {
    const { db } = await import('../db/index.ts')
    const { createSchema, createTournament } = await import('../modules/tournaments.ts')
    const { startTournament, recordResult, openStageEarly, stageSeeds } = await import('./structure.ts')
    const { generateDraft, draftSwap, swapEntries, addLateEntry } = await import('./stage-edit.ts')
    close = () => db.destroy()

    const hall = await db
      .selectFrom('halls as h')
      .innerJoin('clubs as c', 'c.id', 'h.club_id')
      .select(['h.id', 'h.club_id'])
      .where('c.status', '=', 'active')
      .where((eb) =>
        eb.exists(
          eb
            .selectFrom('hall_tables as t')
            .select('t.id')
            .whereRef('t.hall_id', '=', 'h.id')
            .where('t.status', '=', 'active'),
        ),
      )
      .executeTakeFirst()
    expect(hall, 'seeded hall').toBeTruthy()
    if (!hall) return
    const players = await db.selectFrom('players').select('id').orderBy('id').limit(17).execute()
    expect(players.length).toBe(17)

    await db
      .transaction()
      .execute(async (trx) => {
        const input = createSchema.parse({
          hallId: hall.id,
          title: 'Integration: groups → minus2',
          startsAt: new Date(Date.now() + 86400000).toISOString(),
          maxParticipants: 32,
          format: {
            stages: [
              { id: 'groups', kind: 'groups', name: 'Группы', groupSize: 4, seeding: 'snake' },
              { id: 'main', kind: 'minus2', name: 'Сетка −2' },
            ],
            transitions: [{ from: 'groups', to: 'main', rule: { by: 'places', places: [1, 2] } }],
            placement: [
              { stage: 'main', who: 'all' },
              { stage: 'groups', who: 'not_advanced' },
            ],
            match: { winsNeeded: 3, pointsToWin: 11, gamePoints: 'optional' },
            tiebreaks: ['h2h_points', 'h2h_sets_ratio', 'h2h_points_ratio', 'rating', 'lots'],
            restMinutes: 0,
          },
        })
        const t = await createTournament(trx, hall.club_id, null, input)
        await trx.updateTable('tournaments').set({ status: 'registration_closed' }).where('id', '=', t.id).execute()
        await trx
          .insertInto('entries')
          .values(players.slice(0, 16).map((p) => ({ tournament_id: t.id, player_id: p.id, status: 'paid' as const })))
          .execute()

        // Draft: 4 groups of 4; a swap between groups survives the start.
        const draft = await generateDraft(trx, t.id, null)
        expect(draft.groups?.map((g) => g.members.length)).toEqual([4, 4, 4, 4])
        const [a, b] = [draft.groups![0]!.members[1]!, draft.groups![1]!.members[1]!]
        await draftSwap(trx, t.id, a, b, null)
        await startTournament(trx, t.id, null)
        const groups = await trx
          .selectFrom('groups as g')
          .innerJoin('stages as s', 's.id', 'g.stage_id')
          .innerJoin('group_members as gm', 'gm.group_id', 'g.id')
          .select(['g.code', 'gm.entry_id'])
          .where('s.tournament_id', '=', t.id)
          .execute()
        expect(groups.find((g) => g.entry_id === b)?.code).toBe('A')
        expect(groups.find((g) => g.entry_id === a)?.code).toBe('B')

        const playGroup = async (code: string) => {
          const ms = await trx
            .selectFrom('matches')
            .select('id')
            .where('tournament_id', '=', t.id)
            .where('stage_label', '=', `group:${code}`)
            .orderBy('number')
            .execute()
          for (const m of ms) await recordResult(trx, m.id, { setsHome: 3, setsAway: 0 }, null)
        }
        await playGroup('A')

        // Final opened while B, C, D still play: A's seeds are in, the others wait.
        await openStageEarly(trx, t.id, 'main', null)
        const main = await trx
          .selectFrom('stages')
          .selectAll()
          .where('tournament_id', '=', t.id)
          .where('stage_key', '=', 'main')
          .executeTakeFirstOrThrow()
        const seeds = stageSeeds(main)
        expect(seeds.filter((s) => s === undefined)).toHaveLength(6)
        expect(seeds.filter((s) => typeof s === 'string')).toHaveLength(2)
        const first = await trx
          .selectFrom('matches')
          .selectAll()
          .where('stage_id', '=', main.id)
          .where('round', '=', 1)
          .orderBy('bracket_number')
          .execute()
        expect(
          first.some((m) => m.status === 'waiting' && (m.home_entry_id != null) !== (m.away_entry_id != null)),
        ).toBe(true)

        await playGroup('B')
        const ready = await trx
          .selectFrom('matches')
          .selectAll()
          .where('stage_id', '=', main.id)
          .where('status', '=', 'scheduled')
          .execute()
        expect(ready.length).toBeGreaterThan(0)

        // A finished bracket match puts its winner into the next match and its loser into the lower branch at once.
        const m = ready[0]!
        await recordResult(trx, m.id, { setsHome: 3, setsAway: 1 }, null)
        const after = await trx
          .selectFrom('matches')
          .select(['home_entry_id', 'away_entry_id', 'stage_label'])
          .where('stage_id', '=', main.id)
          .where('status', 'in', ['waiting', 'scheduled'])
          .execute()
        const filled = after.flatMap((x) => [x.home_entry_id, x.away_entry_id])
        expect(filled).toContain(m.home_entry_id)
        expect(filled).toContain(m.away_entry_id)

        // Swap two players of groups C and D who have not played yet.
        const cd = await trx
          .selectFrom('groups as g')
          .innerJoin('group_members as gm', 'gm.group_id', 'g.id')
          .select(['g.code', 'gm.entry_id'])
          .where('g.code', 'in', ['C', 'D'])
          .where(
            'g.stage_id',
            '=',
            groups.length
              ? (
                  await trx
                    .selectFrom('stages')
                    .select('id')
                    .where('tournament_id', '=', t.id)
                    .where('stage_key', '=', 'groups')
                    .executeTakeFirstOrThrow()
                ).id
              : 0,
          )
          .execute()
        const c1 = cd.find((x) => x.code === 'C')!.entry_id
        const d1 = cd.find((x) => x.code === 'D')!.entry_id
        await swapEntries(trx, t.id, 'groups', c1, d1, 'test', null)
        const cMatches = await trx
          .selectFrom('matches')
          .select(['home_entry_id', 'away_entry_id'])
          .where('stage_label', '=', 'group:C')
          .where('tournament_id', '=', t.id)
          .execute()
        expect(cMatches.some((x) => x.home_entry_id === d1 || x.away_entry_id === d1)).toBe(true)
        expect(cMatches.some((x) => x.home_entry_id === c1 || x.away_entry_id === c1)).toBe(false)

        // A late player in group C with technical losses for the missed matches.
        const late = await addLateEntry(
          trx,
          t.id,
          { playerId: players[16]!.id, stageKey: 'groups', group: 'C', payment: 'on_site', missed: 'technical' },
          null,
        )
        const lateMatches = await trx
          .selectFrom('matches')
          .select(['status', 'is_rated', 'winner_entry_id'])
          .where('tournament_id', '=', t.id)
          .where('away_entry_id', '=', late)
          .execute()
        expect(lateMatches).toHaveLength(4)
        expect(lateMatches.every((x) => x.status === 'walkover' && !x.is_rated && x.winner_entry_id !== late)).toBe(
          true,
        )
        throw new Rollback()
      })
      .catch((e) => {
        if (!(e instanceof Rollback)) throw e
      })
  })
})
