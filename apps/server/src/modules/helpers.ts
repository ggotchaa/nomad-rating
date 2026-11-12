// Helpers and rights (spec 2): invitations by e-mail or link, rights, scope, templates,
// instant revoke, auto-revoke of tournament helpers, club audit log.

import { Router } from 'express'
import { z } from 'zod'
import { CLUB_RIGHTS, RIGHT_TEMPLATES } from '@nomad/shared'
import { db, json } from '../db/index.ts'
import type { Transaction } from '../db/index.ts'
import type { ClubScope, Database } from '../db/types.ts'
import { audit } from '../audit.ts'
import { requireClubRight, requireUser } from '../auth/access.ts'
import { newToken, tokenHash } from '../auth/tokens.ts'
import { badRequest, conflict, forbidden, handler, notFound } from '../http/errors.ts'
import { intParam, pageQuery, parseBody, parseQuery } from '../http/validate.ts'
import { mails, sendMail, siteLink } from '../mail/index.ts'
import { bus } from '../realtime/bus.ts'

export const helpersRouter = Router()
export const invitationsRouter = Router()

const INVITE_DAYS = 7

const scopeSchema = z.object({ kind: z.enum(['club', 'halls', 'tournaments', 'tables']), ids: z.array(z.number().int().positive()).max(200).optional() })
const rightsSchema = z.array(z.enum(CLUB_RIGHTS)).min(1)

/** Scope ids must belong to the club. */
async function checkScope(clubId: number, scope: ClubScope): Promise<ClubScope> {
  if (scope.kind === 'club') return { kind: 'club' }
  const ids = [...new Set(scope.ids ?? [])]
  if (!ids.length) throw badRequest('helpers.scope_empty')
  const found =
    scope.kind === 'halls'
      ? await db.selectFrom('halls').select('id').where('club_id', '=', clubId).where('id', 'in', ids).execute()
      : scope.kind === 'tournaments'
        ? await db.selectFrom('tournaments').select('id').where('club_id', '=', clubId).where('id', 'in', ids).execute()
        : await db.selectFrom('hall_tables as t').innerJoin('halls as h', 'h.id', 't.hall_id').select('t.id').where('h.club_id', '=', clubId).where('t.id', 'in', ids).execute()
  if (found.length !== ids.length) throw badRequest('helpers.scope_foreign')
  return { kind: scope.kind, ids }
}

helpersRouter.get(
  '/:id/helpers',
  handler(async (req, res) => {
    const clubId = intParam(req, 'id')
    await requireClubRight(req, clubId, 'organizer_only')
    const members = await db
      .selectFrom('club_members as m')
      .innerJoin('users as u', 'u.id', 'm.user_id')
      .leftJoin('players as p', 'p.user_id', 'u.id')
      .select(['m.user_id', 'm.role', 'm.rights', 'm.scope', 'm.created_at', 'u.email', 'p.first_name', 'p.last_name'])
      .where('m.club_id', '=', clubId)
      .orderBy('m.role', 'desc')
      .orderBy('m.created_at')
      .execute()
    await db.updateTable('club_invitations').set({ status: 'expired' }).where('club_id', '=', clubId).where('status', '=', 'sent').where('expires_at', '<', new Date()).execute()
    const invitations = await db
      .selectFrom('club_invitations')
      .select(['id', 'email', 'rights', 'scope', 'template', 'expires_at', 'created_at'])
      .where('club_id', '=', clubId)
      .where('status', '=', 'sent')
      .orderBy('created_at', 'desc')
      .execute()
    res.json({
      members: members.map((m) => ({
        userId: m.user_id,
        role: m.role,
        rights: m.rights,
        scope: m.scope,
        email: m.email,
        name: m.last_name ? `${m.last_name} ${m.first_name}` : null,
        since: m.created_at,
      })),
      invitations,
    })
  }),
)

const inviteSchema = z.object({
  email: z.email().optional(),
  template: z.enum(Object.keys(RIGHT_TEMPLATES) as [string, ...string[]]).optional(),
  rights: rightsSchema.optional(),
  scope: scopeSchema.default({ kind: 'club' }),
})

helpersRouter.post(
  '/:id/invitations',
  handler(async (req, res) => {
    const clubId = intParam(req, 'id')
    const user = await requireClubRight(req, clubId, 'organizer_only')
    const body = parseBody(inviteSchema, req)
    const rights = body.rights ?? (body.template ? RIGHT_TEMPLATES[body.template] : undefined)
    if (!rights?.length) throw badRequest('helpers.rights_empty')
    const scope = await checkScope(clubId, body.scope)
    const token = newToken()
    const inv = await db
      .insertInto('club_invitations')
      .values({
        club_id: clubId,
        email: body.email ?? null,
        token_hash: tokenHash(token),
        rights,
        scope: json(scope),
        template: body.template ?? null,
        expires_at: new Date(Date.now() + INVITE_DAYS * 86400000),
        invited_by: user.id,
      })
      .returning('id')
      .executeTakeFirstOrThrow()
    const club = await db.selectFrom('clubs').select('name').where('id', '=', clubId).executeTakeFirstOrThrow()
    if (body.email) await sendMail(mails.invitation(body.email, club.name, token))
    await audit({ actorUserId: user.id, clubId, entity: 'invitation', entityId: inv.id, action: 'create', after: { email: body.email, rights, scope } })
    res.status(201).json({ id: inv.id, link: siteLink(`/invite/${token}`) })
  }),
)

helpersRouter.delete(
  '/:id/invitations/:invId',
  handler(async (req, res) => {
    const clubId = intParam(req, 'id')
    const user = await requireClubRight(req, clubId, 'organizer_only')
    const invId = intParam(req, 'invId')
    const row = await db.updateTable('club_invitations').set({ status: 'revoked' }).where('id', '=', invId).where('club_id', '=', clubId).where('status', '=', 'sent').returning('id').executeTakeFirst()
    if (!row) throw notFound('invitation.not_found')
    await audit({ actorUserId: user.id, clubId, entity: 'invitation', entityId: invId, action: 'revoke' })
    res.status(204).end()
  }),
)

helpersRouter.patch(
  '/:id/helpers/:userId',
  handler(async (req, res) => {
    const clubId = intParam(req, 'id')
    const user = await requireClubRight(req, clubId, 'organizer_only')
    const helperId = intParam(req, 'userId')
    const body = parseBody(z.object({ rights: rightsSchema, scope: scopeSchema }), req)
    const scope = await checkScope(clubId, body.scope)
    const before = await db.selectFrom('club_members').select(['rights', 'scope', 'role']).where('club_id', '=', clubId).where('user_id', '=', helperId).executeTakeFirst()
    if (!before || before.role !== 'helper') throw notFound('helper.not_found')
    await db.updateTable('club_members').set({ rights: body.rights, scope: json(scope) }).where('club_id', '=', clubId).where('user_id', '=', helperId).execute()
    await audit({ actorUserId: user.id, clubId, entity: 'helper', entityId: helperId, action: 'rights', before, after: { rights: body.rights, scope } })
    bus.publish(`user:${helperId}`, 'club.rights', { clubId })
    res.json({ ok: true })
  }),
)

/** Instant revoke: rights are read from the database on every request. */
helpersRouter.delete(
  '/:id/helpers/:userId',
  handler(async (req, res) => {
    const clubId = intParam(req, 'id')
    const user = await requireClubRight(req, clubId, 'organizer_only')
    const helperId = intParam(req, 'userId')
    const row = await db.deleteFrom('club_members').where('club_id', '=', clubId).where('user_id', '=', helperId).where('role', '=', 'helper').returning(['rights', 'scope']).executeTakeFirst()
    if (!row) throw notFound('helper.not_found')
    await db.updateTable('sessions').set({ active_club_id: null }).where('user_id', '=', helperId).where('active_club_id', '=', clubId).execute()
    await audit({ actorUserId: user.id, clubId, entity: 'helper', entityId: helperId, action: 'revoke', before: row })
    bus.publish(`user:${helperId}`, 'club.rights', { clubId })
    res.status(204).end()
  }),
)

/** Removes tournament-scoped helpers of a finished tournament (called from finishTournament). */
export async function revokeTournamentHelpers(trx: Transaction<Database>, tournamentId: number): Promise<void> {
  const t = await trx.selectFrom('tournaments').select('club_id').where('id', '=', tournamentId).executeTakeFirst()
  if (!t) return
  const members = await trx.selectFrom('club_members').select(['user_id', 'scope']).where('club_id', '=', t.club_id).where('role', '=', 'helper').execute()
  for (const m of members) {
    if (m.scope.kind !== 'tournaments' || !m.scope.ids?.includes(tournamentId)) continue
    const ids = m.scope.ids.filter((id) => id !== tournamentId)
    if (ids.length) await trx.updateTable('club_members').set({ scope: json({ kind: 'tournaments', ids }) }).where('club_id', '=', t.club_id).where('user_id', '=', m.user_id).execute()
    else await trx.deleteFrom('club_members').where('club_id', '=', t.club_id).where('user_id', '=', m.user_id).execute()
    await audit({ actorUserId: null, clubId: t.club_id, entity: 'helper', entityId: m.user_id, action: 'auto_revoke', before: m.scope, after: ids.length ? { kind: 'tournaments', ids } : null }, trx)
  }
}

const auditQuery = z.object({
  entity: z.string().max(40).optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  ...pageQuery,
})

helpersRouter.get(
  '/:id/audit',
  handler(async (req, res) => {
    const clubId = intParam(req, 'id')
    await requireClubRight(req, clubId, 'organizer_only')
    const q = parseQuery(auditQuery, req)
    let base = db.selectFrom('audit_log as a').leftJoin('users as u', 'u.id', 'a.actor_user_id').where('a.club_id', '=', clubId)
    if (q.entity) base = base.where('a.entity', '=', q.entity)
    if (q.from) base = base.where('a.at', '>=', new Date(`${q.from}T00:00:00Z`))
    if (q.to) base = base.where('a.at', '<', new Date(new Date(`${q.to}T00:00:00Z`).getTime() + 86400000))
    const [items, total] = await Promise.all([
      base.select(['a.id', 'a.at', 'a.entity', 'a.entity_id', 'a.action', 'a.before', 'a.after', 'a.reason', 'u.email as actor']).orderBy('a.at', 'desc').limit(q.limit).offset(q.offset).execute(),
      base.select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirstOrThrow(),
    ])
    res.json({ total: Number(total.n), items })
  }),
)

// --- Invitation links -----------------------------------------------------------------

async function loadInvitation(token: string) {
  const inv = await db
    .selectFrom('club_invitations as i')
    .innerJoin('clubs as c', 'c.id', 'i.club_id')
    .select(['i.id', 'i.club_id', 'i.email', 'i.rights', 'i.scope', 'i.status', 'i.expires_at', 'c.name as club', 'c.slug'])
    .where('i.token_hash', '=', tokenHash(token))
    .executeTakeFirst()
  if (!inv) throw notFound('invitation.not_found')
  if (inv.status !== 'sent' || inv.expires_at < new Date()) throw conflict('invitation.inactive')
  return inv
}

invitationsRouter.get(
  '/:token',
  handler(async (req, res) => {
    const inv = await loadInvitation(String(req.params.token))
    res.json({ club: inv.club, slug: inv.slug, email: inv.email, rights: inv.rights, scope: inv.scope, expiresAt: inv.expires_at })
  }),
)

invitationsRouter.post(
  '/:token/accept',
  handler(async (req, res) => {
    const user = requireUser(req)
    const inv = await loadInvitation(String(req.params.token))
    if (inv.email && inv.email.toLowerCase() !== user.email.toLowerCase()) throw forbidden('invitation.other_email')
    await db.transaction().execute(async (trx) => {
      const existing = await trx.selectFrom('club_members').select('role').where('club_id', '=', inv.club_id).where('user_id', '=', user.id).executeTakeFirst()
      if (existing?.role === 'organizer') throw conflict('invitation.already_member')
      if (existing) await trx.updateTable('club_members').set({ rights: inv.rights, scope: json(inv.scope) }).where('club_id', '=', inv.club_id).where('user_id', '=', user.id).execute()
      else await trx.insertInto('club_members').values({ club_id: inv.club_id, user_id: user.id, role: 'helper', rights: inv.rights, scope: json(inv.scope) }).execute()
      await trx.updateTable('club_invitations').set({ status: 'accepted', accepted_by: user.id }).where('id', '=', inv.id).execute()
      await audit({ actorUserId: user.id, clubId: inv.club_id, entity: 'invitation', entityId: inv.id, action: 'accept', after: { rights: inv.rights, scope: inv.scope } }, trx)
    })
    await db.updateTable('sessions').set({ active_club_id: inv.club_id }).where('id', '=', user.sessionId).execute()
    res.json({ clubId: inv.club_id })
  }),
)
