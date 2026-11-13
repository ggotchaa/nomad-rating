import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { loginAs } from '../support/api.ts'
import type { AccountKey } from '../support/api.ts'

const switchTo = async (page: Page, key: AccountKey) => {
  await loginAs(page.request, key)
  await page.reload()
}

test('main flow: guest, player, organiser', async ({ page }) => {
  let booked = ''
  await test.step('guest browses a finished tournament and a player profile', async () => {
    await page.goto('/tournaments')
    await expect(page.getByRole('link', { name: /Кубок Smash Arena \(открытый\)/ })).toBeVisible()
    await page.getByRole('button', { name: 'Завершённые' }).click()
    await page.getByRole('link', { name: /Субботний рейтинговый турнир/ }).first().click()
    await expect(page.getByRole('heading', { name: 'Итоги' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Группы' }).first()).toBeVisible()

    await page.locator('table a[href^="/players/"]').first().click()
    await expect(page.getByRole('heading', { name: 'График рейтинга' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'История турниров' })).toBeVisible()

    await page.goto('/rating')
    await expect(page.locator('table a[href^="/players/"]').first()).toBeVisible()
  })

  await test.step('player books a table and registers for a tournament', async () => {
    await switchTo(page, 'player')
    await page.goto('/club/smash-arena/booking')
    await page.getByRole('group', { name: 'Дата' }).getByRole('button').nth(4).click()
    await page.getByRole('button', { name: /^\d+$/ }).first().click()
    await page.locator('.slots button:enabled').first().click()
    await page.getByRole('button', { name: 'Забронировать', exact: true }).click()
    await expect(page.getByText('Бронь подтверждена')).toBeVisible()
    booked = (await page.getByRole('heading', { level: 2 }).filter({ hasText: /^Стол/ }).textContent())!.match(/(\d{2}:\d{2}.\d{2}:\d{2})/)![1]!
    await page.getByRole('link', { name: 'Мои брони' }).click()
    await expect(page.getByRole('button', { name: 'Отменить', exact: true }).first()).toBeVisible()

    await page.goto('/tournaments')
    await page.getByRole('link', { name: /Кубок Smash Arena \(открытый\)/ }).click()
    await page.getByRole('button', { name: 'Записаться', exact: true }).click()
    await expect(page.getByText(/Вы записаны/)).toBeVisible()
    await page.getByRole('button', { name: 'Отменить запись' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Да' }).click()
    await expect(page.getByRole('button', { name: 'Записаться', exact: true })).toBeVisible()
  })

  const title = `E2E турнир ${Date.now() % 100000}`
  await test.step('organiser creates a tournament and sees the booking grid', async () => {
    await switchTo(page, 'organizer')
    await page.goto('/manage/tournaments')
    await page.getByRole('link', { name: '+ Создать турнир' }).click()
    await page.getByLabel('Название').fill(title)
    await page.getByLabel('Макс. участников').fill('8')
    await page.getByRole('button', { name: 'Создать черновик' }).click()
    await page.getByRole('button', { name: 'Опубликовать' }).click()
    await expect(page.getByText('Турнир опубликован')).toBeVisible()

    await page.goto('/tournaments')
    await expect(page.getByRole('link', { name: new RegExp(title) })).toBeVisible()

    await page.goto('/manage/bookings')
    for (let i = 0; i < 4; i++) await page.getByRole('button', { name: 'Следующий день' }).click()
    await expect(page.locator('.bk', { hasText: 'Сейтов' }).filter({ hasText: booked })).toBeVisible()
  })
})
