import { expect, test } from '@playwright/test'
import type { APIRequestContext } from '@playwright/test'
import { guestApi, json } from '../support/api'

type Point = { tournamentId: number; rating: number }
type Profile = { ratings: { kind: string; rating: number | null }[] }

const history = async (api: APIRequestContext, id: number, kind: string) => json<Point[]>(await api.get(`/api/players/${id}/rating-history?period=all&kind=${kind}`))
const profileRating = async (api: APIRequestContext, id: number, kind: string) => (await json<Profile>(await api.get(`/api/players/${id}`))).ratings.find((r) => r.kind === kind)?.rating ?? null

test.describe('ratings', () => {
  test('profile rating equals the last snapshot of its history', async ({ playwright }) => {
    const api = await guestApi(playwright)
    const list = (await json<{ items: { id: number }[] }>(await api.get('/api/players?limit=40'))).items
    expect(list.length).toBeGreaterThan(10)
    let checked = 0
    for (const { id } of list) {
      const h = await history(api, id, 'singles')
      if (!h.length) continue
      expect(await profileRating(api, id, 'singles'), `player ${id}`).toBe(h.at(-1)!.rating)
      checked++
    }
    expect(checked).toBeGreaterThan(10)
  })

  test('profile page shows the seeded rating', async ({ page, playwright }) => {
    const api = await guestApi(playwright)
    const [{ id }] = (await json<{ items: { id: number }[] }>(await api.get('/api/players?limit=1'))).items
    const rating = (await history(api, id, 'singles')).at(-1)!.rating
    await page.goto(`/players/${id}`)
    await expect(page.getByRole('main')).toContainText(String(rating))
  })

  test('a finished doubles tournament changes only doubles ratings', async ({ playwright }) => {
    const api = await guestApi(playwright)
    const list = await json<{ id: number; slug: string }[]>(await api.get('/api/tournaments?when=finished&type=doubles'))
    expect(list.length).toBeGreaterThan(0)
    const t = await json<{ id: number; participants: { roster: number[] }[] }>(await api.get(`/api/tournaments/${list[0]!.slug}`))
    const players = t.participants.flatMap((p) => p.roster)
    expect(players.length).toBeGreaterThanOrEqual(8)

    for (const id of players) {
      const doubles = await history(api, id, 'doubles')
      const singles = await history(api, id, 'singles')
      expect(doubles.map((x) => x.tournamentId), `player ${id} doubles`).toContain(t.id)
      expect(singles.map((x) => x.tournamentId), `player ${id} singles`).not.toContain(t.id)
      expect(await profileRating(api, id, 'doubles')).toBe(doubles.at(-1)!.rating)
      if (singles.length) expect(await profileRating(api, id, 'singles')).toBe(singles.at(-1)!.rating)
    }
  })
})
