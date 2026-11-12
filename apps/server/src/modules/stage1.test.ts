import { describe, expect, it } from 'vitest'
import { scopeAllows } from '../auth/scope.ts'
import { validateImportRows } from './import-rows.ts'
import { rankRttf, rttfSearchName } from './rttf-match.ts'
import { parseCsv } from './table-text.ts'

describe('helper scope', () => {
  it('limits halls and tables only when the target names one', () => {
    expect(scopeAllows({ kind: 'halls', ids: [1] }, { hallId: 2 })).toBe(false)
    expect(scopeAllows({ kind: 'halls', ids: [1] }, {})).toBe(true)
    expect(scopeAllows({ kind: 'tables', ids: [5] }, { hallId: 1, tableId: 6 })).toBe(false)
    expect(scopeAllows({ kind: 'tables', ids: [5] }, { hallId: 1, tableId: 5 })).toBe(true)
  })
  it('requires an explicit tournament for tournament scope', () => {
    expect(scopeAllows({ kind: 'tournaments', ids: [3] }, {})).toBe(false)
    expect(scopeAllows({ kind: 'tournaments', ids: [3] }, { tournamentId: 3 })).toBe(true)
  })
})

describe('RTTF matching', () => {
  const base = [
    { id: 1, search_name: rttfSearchName('Сёмин Пётр Ильич'), birth_year: 1980 },
    { id: 2, search_name: rttfSearchName('Семин Петр'), birth_year: 1995 },
    { id: 3, search_name: rttfSearchName('Семенов Петр'), birth_year: 1995 },
  ]
  it('ignores case, ё and word order; birth year decides between namesakes', () => {
    expect(rankRttf('ПЕТР семин', 1995, base).map((c) => c.id)).toEqual([2, 1])
    expect(rankRttf('петр сёмин', 1980, base)[0]!.id).toBe(1)
  })
  it('prefers whole-word matches over prefixes', () => {
    expect(rankRttf('сем петр', null, base).map((c) => c.id)).toHaveLength(3)
    expect(rankRttf('семенов', null, base).map((c) => c.id)).toEqual([3])
  })
})

describe('player import', () => {
  const cities = [{ id: 1, names: ['Алматы', 'almaty'] }]
  it('parses ; CSV with quotes and reports row errors', () => {
    const table = parseCsv('Фамилия;Имя;Пол;Год рождения;Город\n"Ли; мл.";Ан;м;1990;алматы\nПак;Ю;x;1800;Тараз\n')
    const rows = validateImportRows(table, cities, 2026)
    expect(rows[0]!.data).toMatchObject({ lastName: 'Ли; мл.', gender: 'm', cityId: 1, startLevel: 'amateur' })
    expect(rows[1]!.errors).toEqual(['import.gender', 'import.birth_year', 'import.city'])
  })
  it('rejects a file without required columns', () => {
    expect(validateImportRows([['Имя'], ['Ан']], cities)[0]!.errors).toContain('import.missing_column:lastName')
  })
})
