// Check-in (R-22…R-26): rotating QR shown by staff, «Я в зале» by the player, manual fallback.

import { Router } from 'express'
import { z } from 'zod'
import { assertTransition, entryStatus } from '@nomad/shared'
import { config } from '../config.ts'
import { db } from '../db/index.ts'
import type { Tournament } from '../db/types.ts'
import { audit } from '../audit.ts'
import { requireClubRight, requireUser } from '../auth/access.ts'
import { conflict, forbidden, handler, notFound } from '../http/errors.ts'
import { intParam, parseBody } from '../http/validate.ts'
import { bus } from '../realtime/bus.ts'
import { CHECKIN_STEP_MS, checkinToken, verifyCheckinToken } from '../tournaments/checkin-token.ts'

export const checkinRouter = Router()

async function tournament(id: number) {
  const t = await db.selectFrom('tournaments').selectAll().where('id', '=', id).executeTakeFirst()
  if (!t) throw notFound('tournament.not_found')
  return t
}

function windowOpen(t: Tournament, now = new Date()): boolean {
  if (!['published', 'registration_closed', 'running'].includes(t.status)) return false
  const minutes = t.settings.checkinWindowMinutes ?? 60
  return now.getTime() >= t.starts_at.getTime() - minutes * 60000
}

async function checkIn(entryId: number, actorUserId: number, clubId: number, method: 'qr' | 'manual') {
  await db.transaction().execute(async (trx) => {
    const e = await trx.selectFrom('entries').select(['id', 'status']).where('id', '=', entryId).forUpdate().executeTakeFirstOrThrow()
    if (e.status === 'checked_in') return
    assertTransition('entry', entryStatus, e.status, 'checked_in')
    await trx.updateTable('entries').set({ status: 'checked_in', checked_in_at: new Date(), updated_at: new Date() }).where('id', '=', entryId).execute()
    await audit({ actorUserId, clubId, entity: 'entry', entityId: entryId, action: 'check_in', after: { method } }, trx)
  })
}

/** Staff «Показать QR»: token of the current 30-second window. */
checkinRouter.get(
  '/:id/checkin/qr',
  handler(async (req, res) => {
    const t = await tournament(intParam(req, 'id'))
    await requireClubRight(req, t.club_id, 'conduct', { tournamentId: t.id, hallId: t.hall_id })
    const now = Date.now()
    const token = checkinToken(t.checkin_secret, t.id, now)
    res.json({ token, url: `${config.SITE_URL}/t/${t.slug}/checkin?k=${token}`, refreshInMs: CHECKIN_STEP_MS - (now % CHECKIN_STEP_MS), open: windowOpen(t) })
  }),
)

checkinRouter.post(
  '/:id/checkin',
  handler(async (req, res) => {
    const user = requireUser(req)
    if (!user.playerId) throw forbidden('player.profile_required')
    const t = await tournament(intParam(req, 'id'))
    const { token } = parseBody(z.object({ token: z.string().min(8).max(64) }), req)
    if (!verifyCheckinToken(t.checkin_secret, t.id, token)) throw conflict('checkin.code_expired')
    if (!windowOpen(t)) throw conflict('checkin.window_closed')
    const entry = await db.selectFrom('entries').select(['id', 'status']).where('tournament_id', '=', t.id).where('player_id', '=', user.playerId).where('status', 'in', ['paid', 'checked_in', 'awaiting_payment']).executeTakeFirst()
    if (!entry) throw notFound('entry.not_found')
    if (entry.status === 'awaiting_payment') throw conflict('checkin.not_paid')
    await checkIn(entry.id, user.id, t.club_id, 'qr')
    bus.publish(`tournament:${t.id}`, 'tournament.entries_changed', { tournamentId: t.id })
    res.json({ ok: true })
  }),
)

/** Manual check-in from the participants list (no phone / QR not working). */
checkinRouter.post(
  '/:id/entries/:entryId/checkin',
  handler(async (req, res) => {
    const t = await tournament(intParam(req, 'id'))
    const user = await requireClubRight(req, t.club_id, 'conduct', { tournamentId: t.id, hallId: t.hall_id })
    const entryId = intParam(req, 'entryId')
    const entry = await db.selectFrom('entries').select('tournament_id').where('id', '=', entryId).executeTakeFirst()
    if (entry?.tournament_id !== t.id) throw notFound('entry.not_found')
    await checkIn(entryId, user.id, t.club_id, 'manual')
    bus.publish(`tournament:${t.id}`, 'tournament.entries_changed', { tournamentId: t.id })
    res.json({ ok: true })
  }),
)
