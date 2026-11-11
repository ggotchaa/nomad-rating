import { describe, expect, it } from 'vitest'
import { commission, clubShare, tenge, zonedToUtc } from '@nomad/shared'
import { bookingPrice, tableSlots, validateBookingRequest, DEFAULT_BOOKING_SETTINGS } from './booking.ts'
import type { OpeningHours } from './booking.ts'
import { completeGame, validateGame, validateMatchScore } from './scoring.ts'

describe('score rules', () => {
  it('rejects impossible game scores (11:10, 13:10) and accepts deuce 12:10', () => {
    expect(validateGame({ home: 11, away: 10 })).not.toBeNull()
    expect(validateGame({ home: 13, away: 10 })).not.toBeNull()
    expect(validateGame({ home: 12, away: 10 })).toBeNull()
    expect(validateGame({ home: 11, away: 7 })).toBeNull()
  })

  it('quick entry fills the winner points', () => {
    expect(completeGame('home', 7)).toEqual({ home: 11, away: 7 })
    expect(completeGame('away', 12)).toEqual({ home: 12, away: 14 })
  })

  it('rejects an extra game after the match is won', () => {
    const errors = validateMatchScore({
      setsHome: 3,
      setsAway: 1,
      games: [
        { home: 11, away: 5 },
        { home: 11, away: 5 },
        { home: 11, away: 5 },
        { home: 5, away: 11 },
      ],
    })
    expect(errors.some((e) => e.startsWith('match.extra_game'))).toBe(true)
  })
})

describe('commission (spec 4.3)', () => {
  it('8% of 5000 ₸ is 400 ₸, club gets 4600 ₸', () => {
    expect(commission(tenge(5000))).toBe(tenge(400))
    expect(clubShare(tenge(5000))).toBe(tenge(4600))
  })
})

describe('booking', () => {
  const tz = 'Asia/Almaty'
  const hours: OpeningHours = { 1: { open: 8 * 60, close: 23 * 60 }, 6: { open: 10 * 60, close: 22 * 60 }, 7: null }
  const date = '2026-11-16' // Monday
  const now = zonedToUtc('2026-11-15', 12 * 60, tz)

  it('lists hourly slots within opening hours and marks booked ones', () => {
    const busy = [{ start: zonedToUtc(date, 19 * 60, tz), end: zonedToUtc(date, 21 * 60, tz) }]
    const slots = tableSlots({ date, timeZone: tz, hours, slotMinutes: 60, busy, blocked: [], now })
    expect(slots).toHaveLength(15)
    expect(slots.filter((s) => !s.free).map((s) => s.reason)).toEqual(['booked', 'booked'])
  })

  it('is closed on Sunday', () => {
    expect(tableSlots({ date: '2026-11-15', timeZone: tz, hours, slotMinutes: 60, busy: [], blocked: [], now })).toEqual([])
  })

  it('validates length, hours and horizon', () => {
    const rules = { settings: DEFAULT_BOOKING_SETTINGS, hours, timeZone: tz, now, date }
    expect(validateBookingRequest({ start: zonedToUtc(date, 19 * 60, tz), end: zonedToUtc(date, 20 * 60, tz) }, rules)).toEqual([])
    expect(validateBookingRequest({ start: zonedToUtc(date, 22 * 60, tz), end: zonedToUtc(date, 24 * 60, tz) }, rules)).toContain(
      'booking.outside_hours',
    )
    expect(validateBookingRequest({ start: zonedToUtc(date, 10 * 60, tz), end: zonedToUtc(date, 14 * 60, tz) }, rules)).toContain(
      'booking.too_long',
    )
  })

  it('prices by tariffs: evening is more expensive', () => {
    const tariffs = [{ name: 'Вечер', days: [1, 2, 3, 4, 5], from: 18 * 60, to: 23 * 60, pricePerHour: tenge(4000) }]
    const price = bookingPrice({
      date,
      startMinutes: 17 * 60,
      endMinutes: 19 * 60,
      slotMinutes: 60,
      tariffs,
      tablePricePerHour: null,
      defaultPricePerHour: tenge(3000),
    })
    expect(price).toBe(tenge(7000))
  })
})
