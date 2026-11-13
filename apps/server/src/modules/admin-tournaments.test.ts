import { describe, expect, it } from 'vitest'
import { seededShuffle } from './admin-tournaments.ts'

describe('re-draw seed', () => {
  it('the same seed gives the same order, another seed a permutation of the same ids', () => {
    const ids = Array.from({ length: 16 }, (_, i) => i + 1)
    const a = seededShuffle(ids, 12345)
    expect(seededShuffle(ids, 12345)).toEqual(a)
    expect([...seededShuffle(ids, 777)].sort((x, y) => x - y)).toEqual(ids)
    expect(a).not.toEqual(ids)
  })
})
