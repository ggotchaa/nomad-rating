import { ApiError } from '../api/client.ts'
import { en } from './en.ts'
import { kk } from './kk.ts'
import { locale } from './locale.ts'
import { ru } from './ru.ts'
import type { Messages } from './ru.ts'

const dictionaries: Record<string, Messages> = { ru, kk, en }

export const t: Messages = dictionaries[locale]!

export function errorText(e: unknown): string {
  if (e instanceof ApiError) {
    const base = t.errors[e.code] ?? t.errorFallback
    if (e.code === 'entry.not_eligible' && Array.isArray(e.details)) return `${base}: ${e.details.map((c) => t.errors[String(c)] ?? c).join(', ')}`
    return base
  }
  return t.errorFallback
}
