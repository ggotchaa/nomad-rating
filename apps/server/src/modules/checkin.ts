// Check-in (R-22…R-26): rotating QR shown by staff, «Я в зале» by the player, manual fallback.

import { Router } from 'express'
import { sql } from 'kysely'
import { z } from 'zod'
import { assertTransition, ENTRY_OCCUPYING, entryStatus } from '@nomad/shared'
import { config } from '../config.ts'
import { db } from '../db/index.ts'
import type { Transaction } from '../db/index.ts'
import type { Database, Tournament } from '../db/types.ts'
import { audit } from '../audit.ts'
import { requireClubRight, requireUser } from '../auth/access.ts'
import { conflict, forbidden, handler, HttpError, notFound } from '../http/errors.ts'
import { notify } from '../notify/index.ts'
import { busyTournament, organiserUserIds } from '../tournaments/busy.ts'
import { playerName } from './players.ts'
import { intParam, parseBody } from '../http/validate.ts'
import { bus } from '../realtime/bus.ts'
import { CHECKIN_STEP_MS, checkinToken, verifyCheckinToken } from '../tournaments/checkin-token.ts'
import { registerPlayer } from './tournaments.ts'

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

export type CheckinResult = { status: 'checked_in' | 'partial'; present: number; needed: number }

/**
 * Checks in an entry. For pairs/teams (R-26) `playerId` marks one member; the entry is checked in once
 * the minimum roster is present (pair: both, team: teams.min_size). Without `playerId` the whole roster is marked.
 */
async function checkIn(trx: Transaction<Database>, entryId: number, actorUserId: number, clubId: number, method: 'qr' | 'manual', playerId?: number): Promise<CheckinResult> {
  const e = await trx.selectFrom('entries').select(['id', 'tournament_id', 'player_id', 'status', 'team_id', 'roster', 'checked_in_players']).where('id', '=', entryId).forUpdate().executeTakeFirstOrThrow()
  if (e.status !== 'checked_in') {
    const busy = await busyTournament(trx, e.tournament_id, playerId != null ? [playerId] : e.roster?.length ? e.roster : [e.player_id])
    if (busy) throw conflict('checkin.busy_elsewhere', { tournament: busy.title })
  }
  let present = 1
  let needed = 1
  if (e.team_id && e.roster?.length) {
    const roster = e.roster
    const marked = playerId == null ? roster : [...new Set([...e.checked_in_players, playerId])]
    const team = await trx.selectFrom('teams').select(['kind', 'min_size']).where('id', '=', e.team_id).executeTakeFirstOrThrow()
    needed = team.kind === 'pair' ? roster.length : Math.min(team.min_size, roster.length)
    present = marked.filter((p) => roster.includes(p)).length
    if (e.status !== 'checked_in') assertTransition('entry', entryStatus, e.status, 'checked_in')
    await trx.updateTable('entries').set({ checked_in_players: marked, updated_at: new Date() }).where('id', '=', entryId).execute()
    if (playerId != null) await audit({ actorUserId, clubId, entity: 'entry', entityId: entryId, action: 'check_in_member', after: { method, playerId } }, trx)
  }
  if (e.status === 'checked_in') return { status: 'checked_in', present, needed }
  if (present < needed) return { status: 'partial', present, needed }
  assertTransition('entry', entryStatus, e.status, 'checked_in')
  await trx.updateTable('entries').set({ status: 'checked_in', checked_in_at: new Date(), updated_at: new Date() }).where('id', '=', entryId).execute()
  await audit({ actorUserId, clubId, entity: 'entry', entityId: entryId, action: 'check_in', after: { method } }, trx)
  return { status: 'checked_in', present, needed }
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

/**
 * Player «Я в зале». Without an entry and with same-day registration on (R-25), the first call reports
 * whether a place is free; the call with `register: true` registers (payment at the club) and checks in at once.
 */
checkinRouter.post(
  '/:id/checkin',
  handler(async (req, res) => {
    const user = requireUser(req)
    if (!user.playerId) throw forbidden('player.profile_required')
    const playerId = user.playerId
    const t = await tournament(intParam(req, 'id'))
    const { token, register } = parseBody(z.object({ token: z.string().min(8).max(64), register: z.boolean().default(false) }), req)
    if (!verifyCheckinToken(t.checkin_secret, t.id, token)) throw conflict('checkin.code_expired')
    if (!windowOpen(t)) throw conflict('checkin.window_closed')
    const entry = await db
      .selectFrom('entries')
      .select(['id', 'status'])
      .where('tournament_id', '=', t.id)
      .where((eb) => eb.or([eb('player_id', '=', playerId), sql<boolean>`${playerId} = ANY(roster)`]))
      .where('status', 'in', ['paid', 'checked_in', 'awaiting_payment', 'waitlist'])
      .orderBy('id', 'desc')
      .executeTakeFirst()
    if (entry?.status === 'waitlist') return void res.json({ status: 'waitlist' })
    if (entry?.status === 'awaiting_payment') throw conflict('checkin.not_paid')
    if (!entry) {
      const sameDay = t.settings.sameDayRegistration && t.type === 'singles' && ['published', 'registration_closed'].includes(t.status)
      if (!sameDay) throw notFound('entry.not_found')
      if (!register) {
        const taken = await db.selectFrom('entries').select((eb) => eb.fn.countAll<number>().as('n')).where('tournament_id', '=', t.id).where('status', 'in', [...ENTRY_OCCUPYING]).executeTakeFirstOrThrow()
        return void res.json({ status: 'needs_registration', full: Number(taken.n) >= t.max_participants, fee: t.fee })
      }
    }
    const result = await db
      .transaction()
      .execute(async (trx) => {
        if (entry) return checkIn(trx, entry.id, user.id, t.club_id, 'qr', playerId)
        const r = await registerPlayer(trx, t.id, playerId, user.id, { sameDay: true })
        if (r.status === 'waitlist') return { status: 'waitlist' as const }
        if (r.status !== 'paid') throw conflict('checkin.not_paid')
        return checkIn(trx, r.entryId, user.id, t.club_id, 'qr')
      })
      .catch(async (err: unknown) => {
        // R-28: the organiser of this tournament sees that the player is still busy in another one.
        if (err instanceof HttpError && err.code === 'checkin.busy_elsewhere') {
          const p = await db.selectFrom('players').select(['first_name', 'last_name']).where('id', '=', playerId).executeTakeFirstOrThrow()
          for (const userId of await organiserUserIds(t)) {
            await notify({ userId, type: 'player_busy', data: { tournamentId: t.id, slug: t.slug, title: t.title, player: playerName(p), other: (err.details as { tournament: string }).tournament } })
          }
        }
        throw err
      })
    bus.publish(`tournament:${t.id}`, 'tournament.entries_changed', { tournamentId: t.id })
    res.json(result)
  }),
)

/** Manual check-in from the participants list (no phone / QR not working); `playerId` marks one team member. */
checkinRouter.post(
  '/:id/entries/:entryId/checkin',
  handler(async (req, res) => {
    const t = await tournament(intParam(req, 'id'))
    const user = await requireClubRight(req, t.club_id, 'conduct', { tournamentId: t.id, hallId: t.hall_id })
    const entryId = intParam(req, 'entryId')
    const { playerId } = parseBody(z.object({ playerId: z.number().int().positive().optional() }).default({}), req)
    const entry = await db.selectFrom('entries').select('tournament_id').where('id', '=', entryId).executeTakeFirst()
    if (entry?.tournament_id !== t.id) throw notFound('entry.not_found')
    const result = await db.transaction().execute((trx) => checkIn(trx, entryId, user.id, t.club_id, 'manual', playerId))
    bus.publish(`tournament:${t.id}`, 'tournament.entries_changed', { tournamentId: t.id })
    res.json(result)
  }),
)
