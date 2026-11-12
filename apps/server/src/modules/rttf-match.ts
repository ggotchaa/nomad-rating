// RTTF name matching (R-15): insensitive to case, «ё» and word order; best match first by name and birth year.

import { normalizeText, searchWords } from '@nomad/shared'

export const rttfSearchName = (fullName: string) => normalizeText(fullName)

export type RttfCandidate = { id: number; search_name: string; birth_year: number | null }

/** Score 0…1 for name (all query words must prefix-match some name word) plus a birth-year bonus. */
export function rttfScore(query: string, birthYear: number | null, c: RttfCandidate): number {
  const q = searchWords(query)
  if (!q.length) return 0
  const words = c.search_name.split(' ')
  let matched = 0
  let exact = 0
  for (const w of q) {
    if (words.includes(w)) {
      matched++
      exact++
    } else if (words.some((n) => n.startsWith(w))) matched++
  }
  if (matched < q.length) return 0
  const name = (exact + matched) / (2 * Math.max(q.length, words.length))
  const year = birthYear == null || c.birth_year == null ? 0 : c.birth_year === birthYear ? 0.5 : Math.abs(c.birth_year - birthYear) === 1 ? 0.2 : -0.3
  return name + year
}

export function rankRttf<T extends RttfCandidate>(query: string, birthYear: number | null, candidates: T[]): T[] {
  return candidates
    .map((c) => ({ c, s: rttfScore(query, birthYear, c) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.c.search_name.localeCompare(b.c.search_name))
    .map((x) => x.c)
}
