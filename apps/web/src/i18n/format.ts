// Formatting in the hall's time zone and tenge (spec 1: UTC stored, shown in Asia/Almaty, KZT).

import { intlTag } from './locale.ts'
import { t } from './index.ts'

const TZ = 'Asia/Almaty'

export const formatDate = (iso: string, locale = intlTag) =>
  new Intl.DateTimeFormat(locale, { timeZone: TZ, day: 'numeric', month: 'long', weekday: 'short' }).format(new Date(iso))

export const formatDateShort = (iso: string, locale = intlTag) =>
  new Intl.DateTimeFormat(locale, { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(iso))

export const formatTime = (iso: string, locale = intlTag) =>
  new Intl.DateTimeFormat(locale, { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(new Date(iso))

export const formatDateTime = (iso: string) => `${formatDate(iso)}, ${formatTime(iso)}`

/** Local calendar date (YYYY-MM-DD) of an instant in the hall time zone. */
export const localDate = (d: Date = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d)

export const hhmm = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`

export const parseHhmm = (value: string) => {
  const [h, m] = value.split(':').map(Number)
  return (h ?? 0) * 60 + (m ?? 0)
}

export const formatDuration = (minutes: number) => {
  const h = Math.floor(minutes / 60)
  const m = Math.round(minutes % 60)
  return [h ? `${h} ${t.common.hoursShort}` : '', m ? `${m} ${t.common.minutesShort}` : ''].filter(Boolean).join(' ') || `0 ${t.common.minutesShort}`
}

/** Money comes from the API in tiyn. */
export const formatTenge = (tiyn: number, locale = intlTag) =>
  `${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(tiyn / 100)} ₸`

export const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`)

export function restrictionLabel(r: { ratingMin?: number | null; ratingMax?: number | null; gender?: 'm' | 'f' | null }): string | null {
  const parts: string[] = []
  if (r.ratingMin != null && r.ratingMax != null) parts.push(`${r.ratingMin}–${r.ratingMax}`)
  else if (r.ratingMax != null) parts.push(`${t.common.upTo} ${r.ratingMax}`)
  else if (r.ratingMin != null) parts.push(`${t.common.from} ${r.ratingMin}`)
  if (r.gender === 'f') parts.push(t.common.female)
  if (r.gender === 'm') parts.push(t.common.male)
  return parts.length ? parts.join(' · ') : null
}
