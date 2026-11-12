import { expect, test } from '@playwright/test'
import { apiAs, loginAs, refereeScope, smashIds } from '../support/api'

test('two helpers with different rights see different parts of the club cabinet', async ({ playwright }) => {
  const organizer = await apiAs(playwright, 'organizer')
  const [referee, hall] = await Promise.all([apiAs(playwright, 'referee'), apiAs(playwright, 'hall_admin')])
  const { clubId, hallId } = await smashIds(organizer)
  const date = new Date().toISOString().slice(0, 10)

  const { scoped, other } = await refereeScope(organizer, clubId)

  const conduct = (id: number) => `/api/tournaments/${id}/conduct`
  const desk = `/api/halls/${hallId}/bookings?date=${date}`
  const players = `/api/clubs/${clubId}/players`

  expect((await referee.get(conduct(scoped.id))).status()).toBe(200)
  expect((await referee.get(conduct(other.id))).status(), 'referee is limited to one tournament').toBe(403)
  expect((await referee.get(desk)).status()).toBe(403)
  expect((await referee.get(players)).status()).toBe(403)

  expect((await hall.get(desk)).status()).toBe(200)
  expect((await hall.get(players)).status()).toBe(200)
  expect((await hall.get(conduct(scoped.id))).status()).toBe(403)

  expect((await organizer.get(conduct(scoped.id))).status()).toBe(200)
})

test('the club cabinet shows each helper only what they may use', async ({ page, playwright }) => {
  const organizer = await apiAs(playwright, 'organizer')
  const { clubId } = await smashIds(organizer)
  const { scoped } = await refereeScope(organizer, clubId)

  await loginAs(page.request, 'referee')
  await page.goto(`/manage/tournaments/${scoped.id}/conduct`)
  await expect(page.getByRole('heading', { name: 'Проведение', exact: true })).toBeVisible()
  await page.goto('/manage/bookings')
  await expect(page.getByText('У вас нет прав на этот раздел.')).toBeVisible()

  await loginAs(page.request, 'hall_admin')
  await page.goto('/manage/bookings')
  await expect(page.getByRole('navigation').getByRole('link', { name: 'Игроки' })).toBeVisible()
  await expect(page.getByText('У вас нет прав на этот раздел.')).toHaveCount(0)
  await page.goto(`/manage/tournaments/${scoped.id}/conduct`)
  await expect(page.getByText('У вас нет прав на этот раздел.')).toBeVisible()
})
