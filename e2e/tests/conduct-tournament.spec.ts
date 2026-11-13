import { expect, test } from '@playwright/test'
import type { APIRequestContext } from '@playwright/test'
import { apiAs, createPublishedTournament, json, loginAs, smashIds } from '../support/api'

type Conduct = {
  tournament: { status: string }
  tables: { match: { id: number; status: string } | null }[]
  queue: { id: number }[]
}

const conduct = async (api: APIRequestContext, id: number) => json<Conduct>(await api.get(`/api/tournaments/${id}/conduct`))

test('a small round-robin tournament is run from the conduct screen and rated', async ({ page, playwright }) => {
  const organizer = await apiAs(playwright, 'organizer')
  const ids = await smashIds(organizer)
  const t = await createPublishedTournament(organizer, ids, { title: `E2E круговой ${Date.now() % 100000}`, maxParticipants: 4, startsInDays: 20 })
  const list = (await json<{ items: { id: number }[] }>(await organizer.get('/api/players?limit=30'))).items.slice(10, 14)
  for (const p of list) await json(await organizer.post(`/api/tournaments/${t.id}/entries/manual`, { data: { playerId: p.id } }), 201)

  await loginAs(page.request, 'organizer')
  await page.goto(`/manage/tournaments/${t.id}/conduct`)
  await page.getByRole('button', { name: /^Старт · 4$/ }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Да' }).click()
  await expect(page.getByRole('heading', { level: 2, name: 'Столы' })).toBeVisible()

  await page.getByRole('button', { name: /^Вызвать → \d+$/ }).first().click()
  const card = page.locator('.tablecard--called')
  await expect(card).toHaveCount(1)
  await card.getByRole('button', { name: 'Начали' }).click()
  await expect(page.locator('.tablecard--playing')).toHaveCount(1)

  await page.locator('.tablecard--playing').getByRole('button', { name: 'Счёт' }).click()
  const score = page.getByRole('dialog')
  const save = score.getByRole('button', { name: 'Сохранить счёт' })
  await expect(save).toBeDisabled()
  const home = score.locator('.score__big button').first()
  for (let i = 0; i < 3; i++) await home.click()
  await expect(score.locator('.score__board b')).toHaveText('3 : 0')
  await save.click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Последние результаты' }).locator('..').getByText('3:0')).toBeVisible()

  for (let guard = 0; guard < 10; guard++) {
    const d = await conduct(organizer, t.id)
    const open = [...d.queue.map((m) => m.id), ...d.tables.flatMap((x) => (x.match ? [x.match.id] : []))]
    if (!open.length) break
    for (const id of open) await json(await organizer.post(`/api/tournaments/${t.id}/matches/${id}/result`, { data: { setsHome: 3, setsAway: 1, games: [{ home: 11, away: 5 }, { home: 7, away: 11 }, { home: 11, away: 8 }, { home: 11, away: 9 }] } }))
  }

  await page.reload()
  await page.getByRole('button', { name: 'Закрыть турнир' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Да' }).click()
  await expect(page.getByText('Турнир закрыт: места и рейтинг подсчитаны.')).toBeVisible()

  const done = await json<{ status: string; participants: { place: number | null; ratingChange: { delta: number } | null }[] }>(await organizer.get(`/api/tournaments/${t.slug}`))
  expect(done.status).toBe('finished')
  expect(done.participants.map((p) => p.place).sort()).toEqual([1, 2, 3, 4])
  expect(done.participants.every((p) => p.ratingChange != null)).toBe(true)
})
