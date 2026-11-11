// Times are stored in UTC and shown in the hall's time zone (spec 1).

export const DEFAULT_TIMEZONE = 'Asia/Almaty'

/** Offset of `timeZone` from UTC at `instant`, in minutes (e.g. +300 for UTC+5). */
export function zoneOffsetMinutes(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant)
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value)
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'))
  return Math.round((asUtc - instant.getTime()) / 60000)
}

/** Local wall time `date` (YYYY-MM-DD) + `minutes` after midnight in `timeZone` → UTC instant. */
export function zonedToUtc(date: string, minutes: number, timeZone: string): Date {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  const guess = new Date(Date.UTC(y, m - 1, d, 0, minutes))
  const offset = zoneOffsetMinutes(guess, timeZone)
  const result = new Date(guess.getTime() - offset * 60000)
  // Re-check once around DST changes (Kazakhstan has none, kept for other zones).
  const offset2 = zoneOffsetMinutes(result, timeZone)
  return offset2 === offset ? result : new Date(guess.getTime() - offset2 * 60000)
}

/** UTC instant → local date (YYYY-MM-DD) and minutes after midnight in `timeZone`. */
export function utcToZoned(instant: Date, timeZone: string): { date: string; minutes: number; weekday: number } {
  const shifted = new Date(instant.getTime() + zoneOffsetMinutes(instant, timeZone) * 60000)
  const date = shifted.toISOString().slice(0, 10)
  return { date, minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(), weekday: isoWeekday(date) }
}

/** ISO weekday of a YYYY-MM-DD date: 1 = Monday … 7 = Sunday. */
export function isoWeekday(date: string): number {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay()
  return day === 0 ? 7 : day
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export const hhmm = (minutes: number): string =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`

export function parseHhmm(value: string): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value)
  if (!match) throw new Error(`Invalid time ${value}`)
  return Number(match[1]) * 60 + Number(match[2])
}
