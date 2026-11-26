// Match queue for the tables screen (spec 4.4 M-3, 3.3): which ready match goes to which free table.

export type QueueMatch = { id: number; players: number[]; order: number }

export type QueueInput = {
  /** Ready matches (both players known, not called yet), any order. */
  matches: readonly QueueMatch[]
  freeTables: readonly number[]
  /** Players now called or playing. */
  busy: ReadonlySet<number>
}

export type QueueItem = { matchId: number; tableId: number | null; waitReason: 'busy' | 'no_table' | null }

/** Queue in match order; a match waits only while a player is busy or no table is free, so later matches may go first. */
export function planQueue(input: QueueInput): QueueItem[] {
  const tables = [...input.freeTables]
  const taken = new Set<number>()
  return [...input.matches]
    .sort((a, b) => a.order - b.order)
    .map((m): QueueItem => {
      if (m.players.some((p) => input.busy.has(p) || taken.has(p))) return { matchId: m.id, tableId: null, waitReason: 'busy' }
      const table = tables.shift()
      if (table == null) return { matchId: m.id, tableId: null, waitReason: 'no_table' }
      for (const p of m.players) taken.add(p)
      return { matchId: m.id, tableId: table, waitReason: null }
    })
}
