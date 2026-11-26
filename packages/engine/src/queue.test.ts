import { describe, expect, it } from 'vitest'
import { planQueue } from './queue.ts'
import { separateClubs } from './groups.ts'

describe('match queue', () => {
  it('skips matches of busy players and lets later matches go first', () => {
    const plan = planQueue({
      matches: [
        { id: 1, players: [1, 2], order: 1 },
        { id: 2, players: [3, 4], order: 2 },
        { id: 3, players: [5, 6], order: 3 },
        { id: 4, players: [7, 8], order: 4 },
        { id: 5, players: [9, 10], order: 5 },
      ],
      freeTables: [101, 102],
      busy: new Set([2]),
    })
    expect(plan.map((p) => [p.matchId, p.tableId, p.waitReason])).toEqual([
      [1, null, 'busy'],
      [2, 101, null],
      [3, 102, null],
      [4, null, 'no_table'],
      [5, null, 'no_table'],
    ])
  })

  it('never puts one player on two tables', () => {
    const plan = planQueue({
      matches: [
        { id: 1, players: [1, 2], order: 1 },
        { id: 2, players: [1, 3], order: 2 },
      ],
      freeTables: [1, 2],
      busy: new Set(),
    })
    expect(plan[1]).toMatchObject({ tableId: null, waitReason: 'busy' })
  })
})

describe('separate clubs', () => {
  it('swaps within a seeding row so club mates land in different groups', () => {
    const club: Record<string, string> = { a1: 'X', b1: 'Y', a2: 'X', b2: 'Z' }
    // snake for 4 into 2 groups: [a1, b2], [b1, a2] — make a clash: [a1, a2], [b1, b2]
    const result = separateClubs(
      [
        ['a1', 'a2'],
        ['b1', 'b2'],
      ],
      (id) => club[id],
    )
    expect(result).toEqual([
      ['a1', 'b2'],
      ['b1', 'a2'],
    ])
  })
})
