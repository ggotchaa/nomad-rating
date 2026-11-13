import { expect, test } from '@playwright/test'
import type { APIRequestContext } from '@playwright/test'
import { apiAs, json } from '../support/api'

type Point = { tournamentId: number; rating: number; delta: number }
type Match = { matchId: number; won: boolean; opponent: { id: number }; tournament: { id: number }; resultType: string }

const history = async (api: APIRequestContext, id: number) => json<Point[]>(await api.get(`/api/players/${id}/rating-history?period=all`))

async function recalculated(api: APIRequestContext) {
  await expect.poll(async () => (await json(await api.get('/api/rating/status'))).running, { timeout: 30_000 }).toBe(false)
}

test('platform admin corrects an old match: ratings are recalculated and the change is audited', async ({ playwright }) => {
  const admin = await apiAs(playwright, 'admin')
  const organizer = await apiAs(playwright, 'organizer')
  const player = await apiAs(playwright, 'player')
  const me = (await json(await player.get('/api/auth/me'))).player.id as number

  const [first] = await history(player, me)
  const all = await json<(Match & { games: { home: number; away: number }[] })[]>(await player.get(`/api/players/${me}/tournaments/${first!.tournamentId}/matches`))
  const target = all.find((m) => m.won && m.resultType === 'normal')!
  expect(target).toBeTruthy()
  const opponentId = target.opponent.id
  const before = { me: await history(admin, me), opponent: await history(admin, opponentId) }

  const attempt = { games: [{ home: 3, away: 11 }, { home: 5, away: 11 }, { home: 4, away: 11 }], reason: 'e2e: wrong score' }
  const denied = await organizer.post(`/api/rating/matches/${target.matchId}/correct`, { data: attempt })
  expect(denied.status()).toBe(403)

  const playerIsHome = target.games[0]!.home > target.games[0]!.away
  const games = playerIsHome ? attempt.games : attempt.games.map((g) => ({ home: g.away, away: g.home }))

  await json(await admin.post(`/api/rating/matches/${target.matchId}/correct`, { data: { games, reason: attempt.reason } }))
  await recalculated(admin)

  const after = { me: await history(admin, me), opponent: await history(admin, opponentId) }
  const pick = (h: Point[]) => h.find((p) => p.tournamentId === first!.tournamentId)!
  expect(pick(after.me).delta).toBeLessThan(pick(before.me).delta)
  expect(pick(after.opponent).delta).toBeGreaterThan(pick(before.opponent).delta)
  const profile = await json(await admin.get(`/api/players/${me}`))
  expect(profile.ratings.find((r: { kind: string }) => r.kind === 'singles').rating).toBe(after.me.at(-1)!.rating)

  const audit = await json<{ reason: string; actor: string; before: { sets_home: number }; after: { sets_home: number } }[]>(
    await admin.get(`/api/admin/audit?entity=match&action=correct_finished&entityId=${target.matchId}`),
  )
  expect(audit).toHaveLength(1)
  expect(audit[0]!.actor).toBe('admin@dev.nomad.test')
  expect(audit[0]!.reason).toContain(attempt.reason)
  expect(audit[0]!.before).not.toEqual(audit[0]!.after)
})
