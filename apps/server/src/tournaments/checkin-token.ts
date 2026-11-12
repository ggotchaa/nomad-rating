// Rotating check-in QR (R-22): TOTP-style HMAC of the 30-second window with the tournament secret.

import { createHmac, timingSafeEqual } from 'node:crypto'

export const CHECKIN_STEP_MS = 30_000

export function checkinToken(secret: string, tournamentId: number, now = Date.now()): string {
  const window = Math.floor(now / CHECKIN_STEP_MS)
  return createHmac('sha256', secret).update(`${tournamentId}:${window}`).digest('base64url').slice(0, 16)
}

/** Accepts the current and the previous window (a code shown just before rotation still works). */
export function verifyCheckinToken(secret: string, tournamentId: number, token: string, now = Date.now()): boolean {
  const given = Buffer.from(token)
  return [now, now - CHECKIN_STEP_MS].some((at) => {
    const expected = Buffer.from(checkinToken(secret, tournamentId, at))
    return expected.length === given.length && timingSafeEqual(expected, given)
  })
}
