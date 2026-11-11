// Table booking availability and price (spec 4.7, B-5 … B-10). Pure: the server passes
// opening hours, settings, existing bookings and blocks; the DB EXCLUDE constraint is the final guard.

import { isoWeekday, zonedToUtc } from '@nomad/shared'

/** Opening hours by ISO weekday (1 = Monday); null = closed that day. Minutes after local midnight. */
export type OpeningHours = Partial<Record<1 | 2 | 3 | 4 | 5 | 6 | 7, { open: number; close: number } | null>>

export type Tariff = {
  name: string
  days: number[]
  /** Local minutes; applies to the part of a slot inside [from, to). */
  from: number
  to: number
  pricePerHour: number // tiyn
}

export type BookingSettings = {
  slotMinutes: 30 | 60
  minMinutes: number
  maxMinutes: number
  horizonDays: number
  holdMinutes: number
  freeCancelHours: number
  defaultPricePerHour: number // tiyn
  tariffs: Tariff[]
}

export const DEFAULT_BOOKING_SETTINGS: BookingSettings = {
  slotMinutes: 60,
  minMinutes: 60,
  maxMinutes: 180,
  horizonDays: 14,
  holdMinutes: 10,
  freeCancelHours: 12,
  defaultPricePerHour: 300000,
  tariffs: [],
}

export type Interval = { start: Date; end: Date }

export type TableSlot = { start: Date; end: Date; free: boolean; reason?: 'booked' | 'blocked' | 'past' }

export const overlaps = (a: Interval, b: Interval): boolean => a.start < b.end && b.start < a.end

/** Opening interval of a local date in UTC, or null when the hall is closed. */
export function dayWindow(date: string, hours: OpeningHours, timeZone: string): Interval | null {
  const day = hours[isoWeekday(date) as 1] ?? null
  if (!day) return null
  return { start: zonedToUtc(date, day.open, timeZone), end: zonedToUtc(date, day.close, timeZone) }
}

/** Slots of one table for one local date with their state. */
export function tableSlots(input: {
  date: string
  timeZone: string
  hours: OpeningHours
  slotMinutes: number
  busy: readonly Interval[]
  blocked: readonly Interval[]
  now: Date
}): TableSlot[] {
  const window = dayWindow(input.date, input.hours, input.timeZone)
  if (!window) return []
  const slots: TableSlot[] = []
  const step = input.slotMinutes * 60000
  for (let t = window.start.getTime(); t + step <= window.end.getTime(); t += step) {
    const slot = { start: new Date(t), end: new Date(t + step) }
    let reason: TableSlot['reason']
    if (slot.start < input.now) reason = 'past'
    else if (input.blocked.some((b) => overlaps(b, slot))) reason = 'blocked'
    else if (input.busy.some((b) => overlaps(b, slot))) reason = 'booked'
    slots.push(reason ? { ...slot, free: false, reason } : { ...slot, free: true })
  }
  return slots
}

/** Validates a booking request against the club's rules; returns error codes. */
export function validateBookingRequest(
  request: Interval,
  rules: { settings: BookingSettings; hours: OpeningHours; timeZone: string; now: Date; date: string },
): string[] {
  const errors: string[] = []
  const { settings } = rules
  const minutes = (request.end.getTime() - request.start.getTime()) / 60000
  if (minutes <= 0) errors.push('booking.invalid_interval')
  if (minutes % settings.slotMinutes !== 0) errors.push('booking.not_slot_aligned')
  if (minutes < settings.minMinutes) errors.push('booking.too_short')
  if (minutes > settings.maxMinutes) errors.push('booking.too_long')
  if (request.start < rules.now) errors.push('booking.in_past')
  if (request.start.getTime() - rules.now.getTime() > settings.horizonDays * 86400000) errors.push('booking.beyond_horizon')
  const window = dayWindow(rules.date, rules.hours, rules.timeZone)
  if (!window) errors.push('booking.hall_closed')
  else {
    if (request.start < window.start || request.end > window.end) errors.push('booking.outside_hours')
    const offset = (request.start.getTime() - window.start.getTime()) / 60000
    if (offset % settings.slotMinutes !== 0) errors.push('booking.not_slot_aligned')
  }
  return [...new Set(errors)]
}

/**
 * Price of a booking in tiyn: every slot is priced by the first tariff covering its start
 * (by weekday and local time), otherwise by the table price or the default price.
 */
export function bookingPrice(input: {
  date: string
  startMinutes: number
  endMinutes: number
  slotMinutes: number
  tariffs: readonly Tariff[]
  tablePricePerHour: number | null
  defaultPricePerHour: number
}): number {
  const weekday = isoWeekday(input.date)
  let total = 0
  for (let t = input.startMinutes; t < input.endMinutes; t += input.slotMinutes) {
    const tariff = input.tariffs.find((x) => x.days.includes(weekday) && t >= x.from && t < x.to)
    const perHour = tariff?.pricePerHour ?? input.tablePricePerHour ?? input.defaultPricePerHour
    total += Math.round((perHour * input.slotMinutes) / 60)
  }
  return total
}

/** Free cancellation until `freeCancelHours` before the start (B-8). */
export const canCancelFree = (start: Date, now: Date, freeCancelHours: number): boolean =>
  start.getTime() - now.getTime() >= freeCancelHours * 3600000
