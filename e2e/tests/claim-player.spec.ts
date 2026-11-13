import { expect, test } from '@playwright/test'
import type { APIRequestContext } from '@playwright/test'
import type { Playwright } from '../support/api'
import { PASSWORD, addClubPlayer, apiAs, guestApi, json, loginAs, smashIds } from '../support/api'

/** Organisers of other seeded clubs have no player profile, so they can take a club-added profile. */
async function accountWithoutProfile(playwright: Playwright): Promise<APIRequestContext> {
  for (const email of ['karaganda', 'shymkent', 'astana', 'topspin']) {
    const api = await guestApi(playwright)
    await json(await api.post('/api/auth/login', { data: { email: `${email}@dev.nomad.test`, password: PASSWORD } }))
    if ((await json(await api.get('/api/auth/me'))).player === null) return api
  }
  throw new Error('no account without a profile left')
}

test('club adds a player without an account, the player claims the profile with the code', async ({ page, playwright }) => {
  const lastName = `Тестов${Date.now() % 100000}`
  await loginAs(page.request, 'organizer')
  await page.goto('/manage/players')
  await page.getByRole('button', { name: '+ Новый игрок' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Фамилия').fill(lastName)
  await dialog.getByLabel('Имя').fill('Айдар')
  await dialog.getByRole('button', { name: 'Сохранить' }).click()

  const note = page.getByText(/Код для привязки аккаунта: \d+/)
  await expect(note).toBeVisible()
  const code = (await note.textContent())!.match(/(\d{6,12})/)![1]!
  await expect(page.getByRole('row', { name: new RegExp(lastName) })).toContainText('нет — профиль клуба')

  const claimant = await accountWithoutProfile(playwright)
  const claimed = await json<{ claimed: number | null }>(await claimant.post('/api/my/claim', { data: { code } }))
  expect(claimed.claimed).not.toBeNull()
  expect((await json(await claimant.get('/api/auth/me'))).player.last_name).toBe(lastName)
  expect((await claimant.post('/api/my/claim', { data: { code } })).status(), 'the code works once').toBe(404)

  await page.reload()
  await expect(page.getByRole('row', { name: new RegExp(lastName) })).toContainText('есть')
})

test('a player who already has a profile entering a code sends a merge request', async ({ page, playwright }) => {
  const organizer = await apiAs(playwright, 'organizer')
  const { clubId } = await smashIds(organizer)
  const { claimCode } = await addClubPlayer(organizer, clubId, `Двойник${Date.now() % 100000}`)

  await loginAs(page.request, 'player')
  await page.goto('/me/profile')
  await page.locator('input[name=code]').fill(claimCode)
  await page.getByRole('button', { name: 'Привязать' }).click()
  await expect(page.getByText('заявка на объединение отправлена администратору')).toBeVisible()
})
