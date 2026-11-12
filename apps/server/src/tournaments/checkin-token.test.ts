import { describe, expect, it } from 'vitest'
import { checkinToken, verifyCheckinToken } from './checkin-token.ts'

describe('check-in token', () => {
  const t0 = 1_700_000_010_000
  const token = checkinToken('secret', 7, t0)

  it('accepts the current and the previous 30-second window only', () => {
    expect(verifyCheckinToken('secret', 7, token, t0)).toBe(true)
    expect(verifyCheckinToken('secret', 7, token, t0 + 30_000)).toBe(true)
    expect(verifyCheckinToken('secret', 7, token, t0 + 60_000)).toBe(false)
  })

  it('is bound to the tournament and its secret', () => {
    expect(verifyCheckinToken('secret', 8, token, t0)).toBe(false)
    expect(verifyCheckinToken('other', 7, token, t0)).toBe(false)
    expect(verifyCheckinToken('secret', 7, 'short', t0)).toBe(false)
  })
})
