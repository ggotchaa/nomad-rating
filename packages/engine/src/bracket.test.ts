import { describe, expect, it } from 'vitest'
import { allPlaces, bracketMatchCount, bracketPlaces, resolveBracket, seedOrder, singleElimination } from './bracket.ts'
import type { Bracket, BracketMatch } from './bracket.ts'

const pairs = (order: number[]) => order.reduce<string[]>((acc, s, i) => (i % 2 ? [...acc.slice(0, -1), `${acc.at(-1)}–${s}`] : [...acc, `${s}`]), [])

/** Plays the whole bracket: the better (lower) seed always wins. */
function playBySeed(bracket: Bracket, players: number) {
  const seeds = Array.from({ length: bracket.size }, (_, i) => (i < players ? `P${i + 1}` : null))
  const results = new Map<number, 'home' | 'away'>()
  for (let pass = 0; pass < bracket.matches.length; pass++) {
    for (const m of resolveBracket(bracket, seeds, results)) {
      if (m.state === 'ready') {
        const h = Number((m.homeSlot as { id: string }).id.slice(1))
        const a = Number((m.awaySlot as { id: string }).id.slice(1))
        results.set(m.number, h < a ? 'home' : 'away')
      }
    }
  }
  return resolveBracket(bracket, seeds, results)
}

const label = (m: BracketMatch) => `${m.placeFrom}..${m.placeTo}`
const src = (s: BracketMatch['home']) => (s.kind === 'seed' ? `s${s.seed}` : s.kind === 'winner' ? `+${s.match}` : `−${s.match}`)

describe('seed order', () => {
  it('matches the spec first round for 16', () => {
    expect(pairs(seedOrder(16))).toEqual(['1–16', '9–8', '5–12', '13–4', '3–14', '11–6', '7–10', '15–2'])
  })
  it('keeps 1 and 2 in different halves for 8, 32 and 64', () => {
    for (const size of [8, 32, 64]) {
      const order = seedOrder(size)
      expect(order.indexOf(1) < size / 2).toBe(true)
      expect(order.indexOf(2) >= size / 2).toBe(true)
      expect(new Set(order).size).toBe(size)
    }
  })
})

describe('all-places bracket (сетка на все места)', () => {
  const b = allPlaces(16)

  it('has S/2 · log2 S matches: 32 for 16 players', () => {
    expect(b.matches).toHaveLength(32)
    expect(bracketMatchCount('all_places', 16)).toBe(32)
    expect(bracketMatchCount('all_places', 32)).toBe(80)
  })

  it('numbers the main draw 1–15 and then the blocks in the spec order', () => {
    expect(b.matches.slice(0, 15).every((m) => m.placeFrom === 1)).toBe(true)
    const blocks: string[] = []
    for (const m of b.matches.slice(15)) if (blocks.at(-1) !== label(m)) blocks.push(label(m))
    expect(blocks).toEqual(['3..4', '5..8', '5..6', '7..8', '9..16', '9..12', '9..10', '11..12', '13..16', '13..14', '15..16'])
  })

  it('feeds sub-blocks with losers («−13» = loser of match 13)', () => {
    const third = b.matches.find((m) => label(m) === '3..4')!
    expect([src(third.home), src(third.away)]).toEqual(['−13', '−14'])
    const final = b.matches.find((m) => m.number === 15)!
    expect([src(final.home), src(final.away)]).toEqual(['+13', '+14'])
  })

  it('gives every player an exact place 1–16 and log2 S matches each', () => {
    const resolved = playBySeed(b, 16)
    const places = bracketPlaces(resolved)
    expect(places).toHaveLength(16)
    expect(places.map((p) => `${p.id}:${p.place}`)).toEqual(Array.from({ length: 16 }, (_, i) => `P${i + 1}:${i + 1}`))
    const count = new Map<string, number>()
    for (const m of resolved) for (const s of [m.homeSlot, m.awaySlot]) if (s.kind === 'entry') count.set(s.id, (count.get(s.id) ?? 0) + 1)
    expect([...count.values()].every((c) => c === 4)).toBe(true)
  })

  it('gives byes to top seeds and places go 1…players without gaps', () => {
    const resolved = playBySeed(b, 13)
    const byes = resolved.filter((m) => m.state === 'bye' && m.round === 1)
    expect(byes.map((m) => (m.winner as { id: string }).id).sort()).toEqual(['P1', 'P2', 'P3'])
    const places = bracketPlaces(resolved)
    expect(places.map((p) => p.place)).toEqual(Array.from({ length: 13 }, (_, i) => i + 1))
  })
})

describe('olympic bracket', () => {
  it('has S − 1 + 1 matches with the third-place match', () => {
    expect(singleElimination(16, 'match').matches).toHaveLength(16)
    expect(singleElimination(16, 'shared').matches).toHaveLength(15)
  })

  it('places 1–4 exactly and shares the rest (5–8, 9–16)', () => {
    const places = bracketPlaces(playBySeed(singleElimination(16, 'match'), 16))
    const byId = new Map(places.map((p) => [p.id, `${p.place}-${p.placeTo}`]))
    expect(['P1', 'P2', 'P3', 'P4'].map((id) => byId.get(id))).toEqual(['1-1', '2-2', '3-3', '4-4'])
    expect(byId.get('P5')).toBe('5-8')
    expect(byId.get('P16')).toBe('9-16')
  })

  it('shares third place without a third-place match', () => {
    const places = bracketPlaces(playBySeed(singleElimination(8, 'shared'), 8))
    expect(places.filter((p) => p.place === 3).map((p) => p.id).sort()).toEqual(['P3', 'P4'])
  })
})
