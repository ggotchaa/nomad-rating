import type { Transaction } from '../db/index.ts'
import type { Database } from '../db/types.ts'

/** D-10 seeding: a pair by the sum of doubles ratings (singles / start level as fallback), a team by its top-3 singles sum. */
export async function teamSeedRating(trx: Transaction<Database>, kind: 'pair' | 'team', roster: readonly number[]): Promise<number> {
  if (!roster.length) return 0
  const rows = await trx
    .selectFrom('players as p')
    .leftJoin('player_ratings as s', (j) => j.onRef('s.player_id', '=', 'p.id').on('s.kind', '=', 'singles'))
    .leftJoin('player_ratings as d', (j) => j.onRef('d.player_id', '=', 'p.id').on('d.kind', '=', 'doubles'))
    .select(['p.start_level', 's.rating as singles', 'd.rating as doubles'])
    .where('p.id', 'in', [...roster])
    .execute()
  const values = rows.map((r) => (kind === 'pair' ? (r.doubles ?? r.singles ?? r.start_level) : (r.singles ?? r.start_level))).sort((a, b) => b - a)
  return values.slice(0, kind === 'pair' ? 2 : 3).reduce((a, b) => a + b, 0)
}
