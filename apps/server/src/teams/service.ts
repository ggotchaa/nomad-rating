// Pairs and teams (spec 4.11, D-1…D-10): roster, invitations (search / link, optional captain approval),
// 48-hour expiry, team entries that become registrable at the minimum roster, roster locks after close.

import { randomBytes } from 'node:crypto'
import { assertTransition, ENTRY_ACTIVE, ENTRY_OCCUPYING, entryStatus, invitationStatus } from '@nomad/shared'
import type { EntryStatus, InvitationStatus } from '@nomad/shared'
import type { Transaction } from '../db/index.ts'
import { config } from '../config.ts'
import type { Database, Tournament, TournamentRestrictions } from '../db/types.ts'
import { audit } from '../audit.ts'
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../http/errors.ts'
import { notify } from '../notify/index.ts'
import { startPayment } from '../payments/service.ts'
import { eligibility } from '../modules/tournaments.ts'
import { teamSeedRating } from './ratings.ts'

type Trx = Transaction<Database>

export const INVITE_HOURS = 48

export async function loadTeam(trx: Trx, teamId: number) {
  const team = await trx.selectFrom('teams').selectAll().where('id', '=', teamId).executeTakeFirst()
  if (!team) throw notFound('team.not_found')
  return team
}

export const activeMembers = async (trx: Trx, teamId: number): Promise<number[]> =>
  (await trx.selectFrom('team_members').select('player_id').where('team_id', '=', teamId).where('status', '=', 'active').orderBy('joined_at').execute()).map((r) => r.player_id)

export async function createTeam(
  trx: Trx,
  captainPlayerId: number,
  input: { kind: 'pair' | 'team'; name: string; minSize?: number; maxSize?: number; approveJoins?: boolean; payer?: 'captain' | 'each'; copiedFrom?: number },
  actorUserId: number | null,
) {
  const min = input.kind === 'pair' ? 2 : (input.minSize ?? 3)
  const max = input.kind === 'pair' ? 2 : Math.max(min, input.maxSize ?? 5)
  const team = await trx
    .insertInto('teams')
    .values({
      kind: input.kind,
      name: input.name,
      captain_player_id: captainPlayerId,
      min_size: min,
      max_size: max,
      join_token: randomBytes(12).toString('base64url'),
      approve_joins: input.approveJoins ?? false,
      payer: input.payer ?? 'captain',
      copied_from: input.copiedFrom ?? null,
    })
    .returningAll()
    .executeTakeFirstOrThrow()
  await trx.insertInto('team_members').values({ team_id: team.id, player_id: captainPlayerId, role: 'captain' }).execute()
  await audit({ actorUserId, entity: 'team', entityId: team.id, action: 'create', after: input }, trx)
  return team
}

async function userOfPlayer(trx: Trx, playerId: number) {
  return (await trx.selectFrom('players').select('user_id').where('id', '=', playerId).executeTakeFirst())?.user_id ?? null
}

export async function invite(trx: Trx, teamId: number, playerId: number, actor: { userId: number; playerId: number | null }, direction: 'invite' | 'request' = 'invite') {
  const team = await loadTeam(trx, teamId)
  if (direction === 'invite' && team.captain_player_id !== actor.playerId) throw forbidden('team.captain_only')
  const members = await activeMembers(trx, teamId)
  if (members.includes(playerId)) throw conflict('team.already_member')
  if (members.length >= team.max_size) throw conflict('team.full')
  const open = await trx.selectFrom('team_invitations').select('id').where('team_id', '=', teamId).where('player_id', '=', playerId).where('status', '=', 'sent').executeTakeFirst()
  if (open) throw conflict('team.invitation_exists')
  const inv = await trx
    .insertInto('team_invitations')
    .values({ team_id: teamId, player_id: playerId, direction, invited_by: actor.userId, expires_at: new Date(Date.now() + INVITE_HOURS * 3600000) })
    .returningAll()
    .executeTakeFirstOrThrow()
  const to = await userOfPlayer(trx, direction === 'invite' ? playerId : team.captain_player_id)
  if (to)
    await notify(
      { userId: to, type: direction === 'invite' ? 'team_invitation' : 'team_request', data: { teamId, invitationId: inv.id, title: team.name, text: direction === 'invite' ? `Приглашение в ${team.kind === 'pair' ? 'пару' : 'команду'} «${team.name}»` : `Заявка на вступление в «${team.name}»` } },
      trx,
    )
  await audit({ actorUserId: actor.userId, entity: 'team_invitation', entityId: inv.id, action: direction, after: { teamId, playerId } }, trx)
  return inv
}

/** Accept / decline / revoke. Invitee answers an invite, the captain answers a join request. */
export async function answerInvitation(trx: Trx, invitationId: number, to: InvitationStatus, actor: { userId: number | null; playerId: number | null; system?: boolean }) {
  const inv = await trx.selectFrom('team_invitations').selectAll().where('id', '=', invitationId).forUpdate().executeTakeFirst()
  if (!inv) throw notFound('team.invitation_not_found')
  const team = await loadTeam(trx, inv.team_id)
  if (!actor.system) {
    const captain = team.captain_player_id === actor.playerId
    const answerer = inv.direction === 'invite' ? inv.player_id === actor.playerId : captain
    if (to === 'revoked' ? !captain && inv.player_id !== actor.playerId : !answerer) throw forbidden('team.not_your_invitation')
  }
  if (inv.status === 'sent' && to !== 'expired' && inv.expires_at < new Date()) throw conflict('team.invitation_expired')
  assertTransition('invitation', invitationStatus, inv.status, to)
  await trx.updateTable('team_invitations').set({ status: to, responded_at: new Date() }).where('id', '=', inv.id).execute()
  if (to === 'accepted') await addMember(trx, team.id, inv.player_id, actor.userId)
  const back = await userOfPlayer(trx, inv.direction === 'invite' ? team.captain_player_id : inv.player_id)
  if (back && to !== 'revoked')
    await notify({ userId: back, type: 'team_invitation_answer', data: { teamId: team.id, title: team.name, status: to, text: `«${team.name}»: ${to === 'accepted' ? 'принято' : to === 'declined' ? 'отклонено' : 'истекло'}` } }, trx)
  await audit({ actorUserId: actor.userId, entity: 'team_invitation', entityId: inv.id, action: to, before: { status: inv.status }, after: { status: to } }, trx)
  return { status: to }
}

export async function addMember(trx: Trx, teamId: number, playerId: number, actorUserId: number | null) {
  const team = await loadTeam(trx, teamId)
  const members = await activeMembers(trx, teamId)
  if (members.length >= team.max_size) throw conflict('team.full')
  await assertRosterChangeAllowed(trx, teamId)
  await trx
    .insertInto('team_members')
    .values({ team_id: teamId, player_id: playerId })
    .onConflict((oc) => oc.columns(['team_id', 'player_id']).doUpdateSet({ status: 'active', joined_at: new Date() }))
    .execute()
  await syncTeamEntries(trx, teamId, actorUserId)
}

/** Joining by the share link: direct, or a request the captain approves (D-3). */
export async function joinByLink(trx: Trx, token: string, actor: { userId: number; playerId: number }) {
  const team = await trx.selectFrom('teams').selectAll().where('join_token', '=', token).executeTakeFirst()
  if (!team) throw notFound('team.not_found')
  if (team.approve_joins) return { status: 'requested' as const, invitation: await invite(trx, team.id, actor.playerId, actor, 'request'), teamId: team.id }
  const members = await activeMembers(trx, team.id)
  if (members.includes(actor.playerId)) throw conflict('team.already_member')
  await addMember(trx, team.id, actor.playerId, actor.userId)
  await audit({ actorUserId: actor.userId, entity: 'team', entityId: team.id, action: 'join_by_link', after: { playerId: actor.playerId } }, trx)
  return { status: 'joined' as const, teamId: team.id }
}

/** Entries of the team in tournaments that are not closed yet. */
async function openEntries(trx: Trx, teamId: number) {
  return trx
    .selectFrom('entries as e')
    .innerJoin('tournaments as t', 't.id', 'e.tournament_id')
    .select(['e.id', 'e.status', 'e.tournament_id', 't.status as t_status', 't.registration_closes_at'])
    .where('e.team_id', '=', teamId)
    .where('e.status', 'in', [...ENTRY_ACTIVE])
    .execute()
}

/** D-6: after registration closes the roster of a registered team is frozen (the organiser may still edit it). */
export async function assertRosterChangeAllowed(trx: Trx, teamId: number, byClub = false) {
  if (byClub) return
  const closed = (await openEntries(trx, teamId)).some((e) => e.t_status !== 'published' || (e.registration_closes_at != null && e.registration_closes_at < new Date()))
  if (closed) throw conflict('team.roster_locked')
}

export async function removeMember(trx: Trx, teamId: number, playerId: number, actor: { userId: number; playerId: number | null }, byClub = false) {
  const team = await loadTeam(trx, teamId)
  if (!byClub && actor.playerId !== playerId && actor.playerId !== team.captain_player_id) throw forbidden('team.captain_only')
  if (playerId === team.captain_player_id) throw conflict('team.captain_cannot_leave')
  await assertRosterChangeAllowed(trx, teamId, byClub)
  await trx.updateTable('team_members').set({ status: 'left' }).where('team_id', '=', teamId).where('player_id', '=', playerId).execute()
  await syncTeamEntries(trx, teamId, actor.userId)
  await audit({ actorUserId: actor.userId, entity: 'team', entityId: teamId, action: 'member_removed', after: { playerId } }, trx)
}

/** «Повторить состав»: a new team with the same captain; former members get fresh invitations. */
export async function repeatTeam(trx: Trx, teamId: number, actor: { userId: number; playerId: number }) {
  const old = await loadTeam(trx, teamId)
  if (old.captain_player_id !== actor.playerId) throw forbidden('team.captain_only')
  const team = await createTeam(trx, actor.playerId, { kind: old.kind, name: old.name, minSize: old.min_size, maxSize: old.max_size, approveJoins: old.approve_joins, payer: old.payer, copiedFrom: old.id }, actor.userId)
  for (const p of await activeMembers(trx, old.id)) if (p !== actor.playerId) await invite(trx, team.id, p, actor)
  return team
}

/** Keeps roster snapshots of open entries in sync; an assembling entry advances when the minimum is reached. */
export async function syncTeamEntries(trx: Trx, teamId: number, actorUserId: number | null) {
  const team = await loadTeam(trx, teamId)
  const members = await activeMembers(trx, teamId)
  for (const e of await openEntries(trx, teamId)) {
    if (!['published', 'registration_closed'].includes(e.t_status)) continue
    await trx.updateTable('entries').set({ roster: members, updated_at: new Date() }).where('id', '=', e.id).execute()
    if (e.status === 'assembling' && members.length >= team.min_size) await confirmTeamEntry(trx, e.id, actorUserId)
  }
}

/** D-9: every member passes the tournament restrictions; pairs/teams also respect the rating-sum cap. */
export async function teamEligibility(trx: Trx, t: Tournament, kind: 'pair' | 'team', roster: number[]): Promise<string[]> {
  const errors = new Set<string>()
  for (const p of roster) for (const e of await eligibility(trx, t, p)) errors.add(`${e}:${p}`)
  const cap = (t.restrictions as TournamentRestrictions).ratingSumMax
  if (cap != null && (await teamSeedRating(trx, kind, roster)) > cap) errors.add('entry.rating_sum_too_high')
  return [...errors]
}

async function overlappingMembers(trx: Trx, t: Tournament, roster: number[], teamId: number) {
  if (!roster.length) return []
  const rows = await trx
    .selectFrom('entries as e')
    .innerJoin('tournaments as o', 'o.id', 'e.tournament_id')
    .select(['o.id', 'o.slug', 'o.title', 'e.player_id', 'e.roster'])
    .where('e.status', 'in', [...ENTRY_ACTIVE])
    .where('o.id', '<>', t.id)
    .where('o.status', 'not in', ['cancelled', 'finished', 'finished_early'])
    .where('o.starts_at', '<', t.estimated_end_at)
    .where('o.estimated_end_at', '>', t.starts_at)
    .where((eb) => eb.or([eb('e.team_id', 'is', null), eb('e.team_id', '<>', teamId)]))
    .execute()
  return rows.filter((r) => (r.roster ?? [r.player_id]).some((p) => roster.includes(p)))
}

export type TeamRegisterResult = { entryId: number; status: EntryStatus }

/** Captain registers the pair/team. Below the minimum roster the entry waits in 'assembling' without a place. */
export async function registerTeam(trx: Trx, tournamentId: number, teamId: number, actor: { userId: number | null; playerId: number | null }, options: { byClub?: boolean } = {}): Promise<TeamRegisterResult> {
  const t = await trx.selectFrom('tournaments').selectAll().where('id', '=', tournamentId).forUpdate().executeTakeFirstOrThrow()
  const team = await loadTeam(trx, teamId)
  if (!options.byClub && team.captain_player_id !== actor.playerId) throw forbidden('team.captain_only')
  if ((t.type === 'doubles' ? 'pair' : t.type === 'team' ? 'team' : null) !== team.kind) throw badRequest('entry.wrong_team_kind')
  if (t.status !== 'published' && !(options.byClub && t.status === 'registration_closed')) throw conflict('entry.registration_closed')
  if (!options.byClub && t.registration_closes_at && t.registration_closes_at < new Date()) throw conflict('entry.registration_closed')
  const existing = await trx.selectFrom('entries').select('id').where('tournament_id', '=', t.id).where('team_id', '=', teamId).where('status', 'in', [...ENTRY_ACTIVE]).executeTakeFirst()
  if (existing) throw conflict('entry.already_registered')
  const roster = await activeMembers(trx, teamId)
  const row = await trx
    .insertInto('entries')
    .values({ tournament_id: t.id, player_id: team.captain_player_id, team_id: teamId, roster, status: 'assembling', registered_by: actor.userId })
    .returning('id')
    .executeTakeFirstOrThrow()
  await audit({ actorUserId: actor.userId, clubId: t.club_id, entity: 'entry', entityId: row.id, action: 'register_team', after: { tournamentId: t.id, teamId, roster } }, trx)
  if (roster.length < team.min_size) return { entryId: row.id, status: 'assembling' }
  return { entryId: row.id, status: await confirmTeamEntry(trx, row.id, actor.userId) }
}

/**
 * Minimum roster reached: eligibility and overlap per member, then a place (or the waiting list) and
 * payment exactly like singles — the at-club provider confirms at once (payer is only stored).
 */
export async function confirmTeamEntry(trx: Trx, entryId: number, actorUserId: number | null): Promise<EntryStatus> {
  const entry = await trx.selectFrom('entries').selectAll().where('id', '=', entryId).forUpdate().executeTakeFirstOrThrow()
  const t = await trx.selectFrom('tournaments').selectAll().where('id', '=', entry.tournament_id).executeTakeFirstOrThrow()
  const team = await loadTeam(trx, entry.team_id!)
  const roster = await activeMembers(trx, team.id)
  const errors = await teamEligibility(trx, t, team.kind, roster)
  if (errors.length) throw unprocessable('entry.not_eligible', errors)
  const clash = await overlappingMembers(trx, t, roster, team.id)
  if (clash.length) throw conflict('entry.overlapping_tournament', clash)
  const taken = await trx.selectFrom('entries').select((eb) => eb.fn.countAll<number>().as('n')).where('tournament_id', '=', t.id).where('status', 'in', [...ENTRY_OCCUPYING]).executeTakeFirstOrThrow()
  if (Number(taken.n) >= t.max_participants) {
    const last = await trx.selectFrom('entries').select((eb) => eb.fn.max<number>('waitlist_position').as('p')).where('tournament_id', '=', t.id).executeTakeFirst()
    await trx.updateTable('entries').set({ status: 'waitlist', waitlist_position: (last?.p ?? 0) + 1, roster, updated_at: new Date() }).where('id', '=', entryId).execute()
    return 'waitlist'
  }
  assertTransition('entry', entryStatus, entry.status, 'awaiting_payment')
  let status: EntryStatus = 'awaiting_payment'
  let paymentId: number | null = null
  if (t.fee > 0) {
    const payment = await startPayment(trx, {
      purpose: 'tournament_entry',
      amount: t.fee * (team.kind === 'pair' ? 2 : roster.length),
      clubId: t.club_id,
      userId: actorUserId,
      description: `${t.title} · ${team.name}`,
      returnUrl: `${config.SITE_URL}/t/${t.slug}`,
      metadata: { tournamentId: t.id, entryId, teamId: team.id, payer: team.payer },
    })
    paymentId = payment.paymentId
    if (payment.confirmed) status = 'paid'
  } else status = 'paid'
  await trx.updateTable('entries').set({ status, roster, payment_id: paymentId, hold_until: status === 'paid' ? null : new Date(Date.now() + 15 * 60000), updated_at: new Date() }).where('id', '=', entryId).execute()
  await audit({ actorUserId, clubId: t.club_id, entity: 'entry', entityId: entryId, action: 'team_confirmed', before: { status: entry.status }, after: { status, roster } }, trx)
  return status
}

/** Expires invitations older than 48 hours (worker). */
export async function expireInvitations(trx: Trx, now = new Date()): Promise<number> {
  const rows = await trx.selectFrom('team_invitations').select('id').where('status', '=', 'sent').where('expires_at', '<', now).execute()
  for (const r of rows) await answerInvitation(trx, r.id, 'expired', { userId: null, playerId: null, system: true })
  return rows.length
}
