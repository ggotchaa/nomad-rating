import { expect } from '@playwright/test'
import type { APIRequestContext, PlaywrightWorkerArgs } from '@playwright/test'

export type Playwright = PlaywrightWorkerArgs['playwright']

export type DemoKey = 'player' | 'newbie' | 'organizer' | 'hall_admin' | 'referee' | 'rttf' | 'new_club' | 'admin'

export const baseURL = 'http://127.0.0.1:5190'
export const PASSWORD = 'nomad-demo-2026'

export async function loginAs(request: APIRequestContext, key: DemoKey) {
  const res = await request.post('/api/demo/login-as', { data: { key } })
  expect(res.ok(), `login-as ${key}`).toBeTruthy()
  return res.json()
}

/** Separate cookie jar per call, signed in as the demo account. */
export async function apiAs(playwright: Playwright, key: DemoKey): Promise<APIRequestContext> {
  const ctx = await playwright.request.newContext({ baseURL })
  await loginAs(ctx, key)
  return ctx
}

export async function guestApi(playwright: Playwright): Promise<APIRequestContext> {
  return playwright.request.newContext({ baseURL })
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function json<T = any>(res: Awaited<ReturnType<APIRequestContext['get']>>, status?: number): Promise<T> {
  if (status != null) expect(res.status(), await res.text()).toBe(status)
  else expect(res.ok(), await res.text()).toBeTruthy()
  return (await res.json()) as T
}

export type SmashIds = { clubId: number; hallId: number }

export async function smashIds(organizer: APIRequestContext): Promise<SmashIds> {
  const clubs = await json<{ id: number; slug: string; halls: { id: number }[] }[]>(await organizer.get('/api/my/clubs'))
  const smash = clubs.find((c) => c.slug === 'smash-arena')!
  return { clubId: smash.id, hallId: smash.halls[0]!.id }
}

export type FreeSlot = { date: string; tableId: number; tableNumber: number; start: string; minutes: number }

/** First free slot of the hall from `fromDay` days ahead (a different offset per spec avoids sharing slots). */
export async function findFreeSlot(request: APIRequestContext, hallId: number, fromDay: number): Promise<FreeSlot> {
  for (let d = fromDay; d < fromDay + 12; d++) {
    const date = new Date(Date.now() + d * 86400000).toISOString().slice(0, 10)
    const av = await json(await request.get(`/api/halls/${hallId}/availability?date=${date}`))
    if (!av.open) continue
    for (const tb of av.tables) {
      const slot = tb.slots.find((s: { free: boolean }) => s.free)
      if (slot) return { date, tableId: tb.id, tableNumber: tb.number, start: slot.start, minutes: av.settings.minMinutes }
    }
  }
  throw new Error('no free slot found')
}

export async function searchPlayers(request: APIRequestContext, q: string): Promise<{ id: number; name: string }[]> {
  return json(await request.get(`/api/players/search?q=${encodeURIComponent(q)}`))
}

type NewTournament = { title: string; tableIds?: number[]; maxParticipants?: number; template?: string; startsInDays?: number; type?: 'singles' | 'doubles' }

/** Draft → published tournament of Smash Arena created by the organiser. */
export async function createPublishedTournament(organizer: APIRequestContext, ids: SmashIds, o: NewTournament) {
  const startsAt = new Date(Date.now() + (o.startsInDays ?? 30) * 86400000).toISOString()
  const created = await json<{ id: number; slug: string }>(
    await organizer.post(`/api/clubs/${ids.clubId}/tournaments`, {
      data: { hallId: ids.hallId, title: o.title, startsAt, template: o.template ?? 'round_robin', maxParticipants: o.maxParticipants ?? 4, minParticipants: 4, fee: 0, type: o.type ?? 'singles', ...(o.tableIds && { tableIds: o.tableIds }) },
    }),
    201,
  )
  await json(await organizer.post(`/api/tournaments/${created.id}/publish`))
  return created
}

/** The upcoming Saturday tournament the demo referee is scoped to, and another published one outside that scope. */
export async function refereeScope(organizer: APIRequestContext, clubId: number) {
  const list = await json<{ id: number; title: string; status: string }[]>(await organizer.get(`/api/clubs/${clubId}/tournaments`))
  const scoped = list.find((t) => t.status === 'published' && t.title === 'Субботний рейтинговый турнир')!
  const other = list.find((t) => t.status === 'published' && t.id !== scoped.id)!
  return { scoped, other }
}

/** Club-added player without an account; returns the claim code. */
export async function addClubPlayer(organizer: APIRequestContext, clubId: number, lastName: string, firstName = 'Айдар'): Promise<{ id: number; claimCode: string }> {
  return json(await organizer.post(`/api/clubs/${clubId}/players`, { data: { firstName, lastName, gender: 'm', birthYear: 1990, cityId: 1, startLevel: 'amateur' } }), 201)
}

export async function playerIdOf(request: APIRequestContext): Promise<number> {
  const me = await json(await request.get('/api/auth/me'))
  return me.player.id
}
