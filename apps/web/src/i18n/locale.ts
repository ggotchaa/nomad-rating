export type Locale = 'ru' | 'kk' | 'en'

export const LOCALES: Locale[] = ['ru', 'kk', 'en']
export const LOCALE_LABEL: Record<Locale, string> = { ru: 'RU', kk: 'KZ', en: 'EN' }
export const INTL_TAG: Record<Locale, string> = { ru: 'ru-RU', kk: 'kk-KZ', en: 'en-GB' }

const KEY = 'nomad.locale'
const SYNC_KEY = 'nomad.locale.sync'

export const DEFAULT_LOCALE: Locale = 'kk'

export const isLocale =(v: unknown): v is Locale => v === 'ru' || v === 'kk' || v === 'en'

function resolve(): Locale {
  try {
    const stored = localStorage.getItem(KEY)
    if (isLocale(stored)) return stored
  } catch {
    // storage unavailable
  }
  return DEFAULT_LOCALE
}

export const locale: Locale = resolve()
/** Engines without Kazakh ICU data fall back to ru-RU for numbers and times; dates are formatted by hand (format.ts). */
export const kkSupported = /[а-яә]/i.test(new Intl.DateTimeFormat('kk-KZ', { month: 'long' }).format(new Date(2026, 10, 15)))
export const intlTag = locale === 'kk' && !kkSupported ? 'ru-RU' : INTL_TAG[locale]
if (typeof document !== 'undefined') document.documentElement.lang = locale

export function storeLocale(next: Locale): void {
  try {
    localStorage.setItem(KEY, next)
  } catch {
    // storage unavailable
  }
}

/** Adopts the account locale once per tab session; returns true when a reload was started. */
export function adoptUserLocale(next: string | null): boolean {
  if (!isLocale(next) || next === locale) return false
  try {
    if (sessionStorage.getItem(SYNC_KEY) === next) return false
    sessionStorage.setItem(SYNC_KEY, next)
  } catch {
    return false
  }
  storeLocale(next)
  location.reload()
  return true
}

export function switchLocale(next: Locale): void {
  if (next === locale) return
  try {
    sessionStorage.setItem(SYNC_KEY, next)
  } catch {
    // storage unavailable
  }
  storeLocale(next)
  location.reload()
}
