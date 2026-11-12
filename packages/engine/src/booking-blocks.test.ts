import { describe, expect, it } from 'vitest'
import { expandRecurring, suggestMoves } from './booking-blocks.ts'
import { bookingPrice } from './booking.ts'

const TZ = 'Asia/Almaty' // UTC+5
const at = (iso: string) => new Date(iso)

describe('recurring blocks', () => {
  const training = { id: 1, tableIds: [3, 4], weekdays: [2, 4], startMinutes: 18 * 60, endMinutes: 20 * 60, validFrom: '2026-11-01', validUntil: '2026-11-19' }

  it('expands only matching weekdays inside the validity range, in hall time', () => {
    const list = expandRecurring([training], '2026-11-09', '2026-11-30', TZ)
    expect(list.map((o) => o.start.toISOString())).toEqual(['2026-11-10T13:00:00.000Z', '2026-11-12T13:00:00.000Z', '2026-11-17T13:00:00.000Z', '2026-11-19T13:00:00.000Z'])
    expect(list[0]!.end.toISOString()).toBe('2026-11-10T15:00:00.000Z')
    expect(list[0]!.tableIds).toEqual([3, 4])
  })

  it('a block ending after midnight runs into the next day', () => {
    const [o] = expandRecurring([{ ...training, weekdays: [1], startMinutes: 22 * 60, endMinutes: 60, validUntil: null }], '2026-11-09', '2026-11-10', TZ)
    expect(o!.end.getTime() - o!.start.getTime()).toBe(3 * 3600000)
  })
})

describe('conflict resolution', () => {
  const tables = [1, 2, 3, 4].map((n) => ({ id: n * 10, number: n }))
  const booking = { tableId: 20, start: at('2026-11-12T13:00:00Z'), end: at('2026-11-12T14:00:00Z') }
  const window = { start: at('2026-11-12T04:00:00Z'), end: at('2026-11-12T17:00:00Z') }

  it('prefers a free neighbour table at the same time, then later slots', () => {
    const busy = [
      { tableIds: [10, 20], start: at('2026-11-12T12:00:00Z'), end: at('2026-11-12T16:00:00Z') },
      { tableIds: [30], start: at('2026-11-12T13:00:00Z'), end: at('2026-11-12T13:30:00Z') },
    ]
    const options = suggestMoves({ booking, tables, busy, window, slotMinutes: 30, limit: 3 })
    expect(options[0]).toMatchObject({ tableId: 40, start: booking.start })
    expect(options[1]).toMatchObject({ tableId: 30, start: at('2026-11-12T13:30:00Z') })
  })

  it('offers nothing when the whole hall is closed until the end of the day', () => {
    const busy = [{ tableIds: [], start: at('2026-11-12T10:00:00Z'), end: at('2026-11-12T18:00:00Z') }]
    expect(suggestMoves({ booking, tables, busy, window, slotMinutes: 30 })).toEqual([])
  })
})

describe('tariffs', () => {
  it('prices slot by slot across tariffs and falls back to the table price', () => {
    const tariffs = [
      { name: 'Вечер выходных', days: [6, 7], from: 18 * 60, to: 23 * 60, pricePerHour: 500000 },
      { name: 'Выходные', days: [6, 7], from: 0, to: 1440, pricePerHour: 400000 },
    ]
    // Saturday 17:00–19:00: one hour at 4 000 ₸, one at 5 000 ₸.
    expect(bookingPrice({ date: '2026-11-14', startMinutes: 17 * 60, endMinutes: 19 * 60, slotMinutes: 30, tariffs, tablePricePerHour: 300000, defaultPricePerHour: 200000 })).toBe(900000)
    expect(bookingPrice({ date: '2026-11-09', startMinutes: 17 * 60, endMinutes: 18 * 60, slotMinutes: 60, tariffs, tablePricePerHour: 300000, defaultPricePerHour: 200000 })).toBe(300000)
  })
})
