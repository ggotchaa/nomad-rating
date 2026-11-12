// Match queue for the tables screen (spec 4.4 M-3, 3.3): which ready match goes to which free table.

export type QueueMatch = { id: number; players: number[]; order: number }

export type QueueInput = {
  /** Ready matches (both players known, not called yet), any order. */
  matches: readonly QueueMatch[]
  freeTables: readonly number[]
  /** Players now called or playing. */
  busy: ReadonlySet<number>
  /** Finish time of each player's last match. */
  lastFinished: ReadonlyMap<number, Date>
  restMinutes: number
  now: Date
}

export type QueueItem = { matchId: number; tableId: number | null; waitReason: 'busy' | 'rest' | 'no_table' | null; readyAt: Date | null }

/** Queue in match order; a match waits while a player is busy or resting, so later matches may go first. */
export function planQueue(input: QueueInput): QueueItem[] {
  const tables = [...input.freeTables]
  const taken = new Set<number>()
  const restMs = input.restMinutes * 60000
  return [...input.matches]
    .sort((a, b) => a.order - b.order)
    .map((m): QueueItem => {
      if (m.players.some((p) => input.busy.has(p) || taken.has(p))) return { matchId: m.id, tableId: null, waitReason: 'busy', readyAt: null }
      const readyAt = Math.max(0, ...m.players.map((p) => (input.lastFinished.get(p)?.getTime() ?? 0) + restMs))
      if (readyAt > input.now.getTime()) return { matchId: m.id, tableId: null, waitReason: 'rest', readyAt: new Date(readyAt) }
      const table = tables.shift()
      if (table == null) return { matchId: m.id, tableId: null, waitReason: 'no_table', readyAt: null }
      for (const p of m.players) taken.add(p)
      return { matchId: m.id, tableId: table, waitReason: null, readyAt: null }
    })
}
