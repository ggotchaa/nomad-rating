import { expect, test } from '@playwright/test'
import { apiAs, findFreeSlot, json, smashIds } from '../support/api'

test('two simultaneous bookings of the same slot: exactly one succeeds', async ({ playwright }) => {
  const [organizer, a, b] = await Promise.all([apiAs(playwright, 'organizer'), apiAs(playwright, 'player'), apiAs(playwright, 'newbie')])
  const { hallId } = await smashIds(organizer)
  const slot = await findFreeSlot(a, hallId, 6)
  const body = { hallId, tableId: slot.tableId, start: slot.start, minutes: slot.minutes }

  const [ra, rb] = await Promise.all([a.post('/api/bookings', { data: body }), b.post('/api/bookings', { data: body })])
  expect([ra.status(), rb.status()].sort()).toEqual([201, 409])
  const loser = ra.status() === 409 ? ra : rb
  expect((await loser.json()).error).toMatch(/^booking\./)

  const desk = await json(await organizer.get(`/api/halls/${hallId}/bookings?date=${slot.date}`))
  const taken = desk.bookings.filter((x: { tableId: number; start: string; status: string }) => x.tableId === slot.tableId && x.start === slot.start && x.status === 'confirmed')
  expect(taken).toHaveLength(1)
})
