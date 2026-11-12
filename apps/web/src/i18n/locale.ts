export type Locale = 'ru' | 'kk' | 'en'

export const LOCALES: Locale[] = ['ru', 'kk', 'en']
export const LOCALE_LABEL: Record<Locale, string> = { ru: 'RU', kk: 'KZ', en: 'EN' }
export const INTL_TAG: Record<Locale, string> = { ru: 'ru-RU', kk: 'kk-KZ', en: 'en-GB' }

const KEY = 'nomad.locale'
const SYNC_KEY = 'nomad.locale.sync'

export const isLocale = (v: unknown): v is Locale => v === 'ru' || v === 'kk' || v === 'en'

function resolve(): Locale {
  try {
    const stored = localStorage.getItem(KEY)
    if (isLocale(stored)) return stored
  } catch {
    // storage unavailable
  }
  const browser = (typeof navigator === 'undefined' ? '' : navigator.language).slice(0, 2).toLowerCase()
  return browser === 'kk' || browser === 'en' ? browser : 'ru'
}

export const locale: Locale = resolve()
export const intlTag = INTL_TAG[locale]
if (typeof document !== 'undefined') document.documentElement.lang = locale

export function storeLocale(next: Locale): void {
  try {
    localStorage.setItem(KEY, next)
  } catch {
    // storage unavailable
  }
}

/** Adopts the account locale once per tab session; returns true when a reload was started. */
export function adoptUserLocale(next: string): boolean {
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
