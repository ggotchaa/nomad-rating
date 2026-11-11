import { ApiError } from '../api/client.ts'
import { ru } from './ru.ts'
import type { Messages } from './ru.ts'

// KK and EN dictionaries plug in here; RU is the only filled locale for the demo.
const dictionaries: Record<string, Messages> = { ru }

export const t: Messages = dictionaries.ru!

export function errorText(e: unknown): string {
  if (e instanceof ApiError) {
    const base = t.errors[e.code] ?? t.errorFallback
    if (e.code === 'entry.not_eligible' && Array.isArray(e.details)) return `${base}: ${e.details.map((c) => t.errors[String(c)] ?? c).join(', ')}`
    return base
  }
  return t.errorFallback
}
