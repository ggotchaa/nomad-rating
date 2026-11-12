import { expect, test } from '@playwright/test'
import { loginAs } from '../support/api'

test('player books and cancels a table from a phone', async ({ page }) => {
  await loginAs(page.request, 'player')
  await page.goto('/club/smash-arena/booking')
  await page.getByRole('group', { name: 'Дата' }).getByRole('button').nth(7).click()

  await page.locator('.timeline__cell:enabled').first().click()
  await page.getByRole('button', { name: /^1 ч$/ }).click()
  await page.getByRole('button', { name: 'Забронировать', exact: true }).click()
  await expect(page.getByText('Бронь подтверждена')).toBeVisible()
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow).toBeLessThanOrEqual(0)

  await page.getByRole('link', { name: 'Мои брони' }).click()
  const cancel = page.getByRole('button', { name: 'Отменить', exact: true })
  await expect(cancel.first()).toBeVisible()
  const before = await cancel.count()
  expect(before).toBeGreaterThan(0)
  await cancel.first().click()
  await page.getByRole('dialog').getByRole('button', { name: 'Да' }).click()
  await expect(cancel).toHaveCount(before - 1)
})
