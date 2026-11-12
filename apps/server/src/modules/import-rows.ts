// Validation of player import rows (R-12). Pure: cities are passed in, duplicates are checked by the caller.

import { START_LEVELS, normalizeText } from '@nomad/shared'
import type { StartLevel } from '@nomad/shared'
import { headerIndex } from './table-text.ts'

export type ImportPlayer = {
  lastName: string
  firstName: string
  middleName: string | null
  gender: 'm' | 'f'
  birthYear: number
  cityId: number
  email: string | null
  startLevel: StartLevel
}

export type ImportRow = { row: number; data: ImportPlayer | null; errors: string[] }

const ALIASES = {
  lastName: ['фамилия', 'lastname', 'surname'],
  firstName: ['имя', 'firstname', 'name'],
  middleName: ['отчество', 'middlename'],
  gender: ['пол', 'gender', 'sex'],
  birthYear: ['годрождения', 'год', 'birthyear', 'year'],
  city: ['город', 'city'],
  email: ['email', 'e-mail', 'почта', 'электроннаяпочта'],
  startLevel: ['уровень', 'стартовыйуровень', 'level', 'startlevel'],
}

const GENDER: Record<string, 'm' | 'f'> = { м: 'm', муж: 'm', мужской: 'm', m: 'm', male: 'm', ж: 'f', жен: 'f', женский: 'f', f: 'f', female: 'f' }
const LEVEL_WORDS: Record<string, StartLevel> = { новичок: 'novice', любитель: 'amateur', опытный: 'experienced', сильный: 'advanced', разрядник: 'ranked' }

function level(value: string): StartLevel | null {
  if (!value) return 'amateur'
  const v = normalizeText(value)
  if (v in START_LEVELS) return v as StartLevel
  const byNumber = Object.entries(START_LEVELS).find(([, n]) => String(n) === v)
  if (byNumber) return byNumber[0] as StartLevel
  return Object.entries(LEVEL_WORDS).find(([w]) => v.startsWith(w))?.[1] ?? null
}

export function validateImportRows(table: string[][], cities: { id: number; names: string[] }[], year = new Date().getFullYear()): ImportRow[] {
  const [header, ...rows] = table
  if (!header) return []
  const col = headerIndex(header, ALIASES)
  const missing = (['lastName', 'firstName', 'gender', 'birthYear', 'city'] as const).filter((k) => col[k] == null)
  if (missing.length) return [{ row: 1, data: null, errors: missing.map((k) => `import.missing_column:${k}`) }]
  const cityByName = new Map(cities.flatMap((c) => c.names.map((n) => [normalizeText(n), c.id] as const)))
  return rows.map((cells, i) => {
    const get = (k: keyof typeof ALIASES) => (col[k] == null ? '' : (cells[col[k]] ?? '').trim())
    const errors: string[] = []
    const lastName = get('lastName')
    const firstName = get('firstName')
    if (!lastName) errors.push('import.last_name')
    if (!firstName) errors.push('import.first_name')
    const gender = GENDER[normalizeText(get('gender'))]
    if (!gender) errors.push('import.gender')
    const birthYear = Number(get('birthYear'))
    if (!Number.isInteger(birthYear) || birthYear < 1920 || birthYear > year - 5) errors.push('import.birth_year')
    const cityId = cityByName.get(normalizeText(get('city')))
    if (!cityId) errors.push('import.city')
    const email = get('email') || null
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push('import.email')
    const startLevel = level(get('startLevel'))
    if (!startLevel) errors.push('import.level')
    return {
      row: i + 2,
      errors,
      data: errors.length
        ? null
        : { lastName, firstName, middleName: get('middleName') || null, gender: gender!, birthYear, cityId: cityId!, email, startLevel: startLevel! },
    }
  })
}
