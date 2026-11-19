// Player cards: photos (T-20), claiming an unclaimed card from a list (T-18), profile disputes (T-19).

import express, { Router } from 'express'
import type { Request } from 'express'
import { z } from 'zod'
import { searchWords } from '@nomad/shared'
import { db, json } from '../db/index.ts'
import { audit } from '../audit.ts'
import { requireClubRight, requirePlatformAdmin, requireUser } from '../auth/access.ts'
import { badRequest, conflict, forbidden, handler, notFound } from '../http/errors.ts'
import { intParam, parseBody, parseQuery } from '../http/validate.ts'
import { IMAGE_MAX_BYTES, IMAGE_TYPES, UPLOADS_URL, removeFile, saveFile } from '../storage/index.ts'
import { mergePlayers } from './club-players.ts'
import { playerName } from './players.ts'

export const myCardsRouter = Router()
export const clubPhotoRouter = Router()
export const adminDisputesRouter = Router()

const imageBody = express.raw({ type: Object.keys(IMAGE_TYPES), limit: IMAGE_MAX_BYTES })

function uploadedImage(req: Request) {
  const ext = IMAGE_TYPES[req.get('content-type')?.split(';')[0]?.trim() ?? '']
  if (!ext || !Buffer.isBuffer(req.body) || req.body.length === 0) throw badRequest('upload.invalid_type')
  if (req.body.length > IMAGE_MAX_BYTES) throw badRequest('upload.too_large')
  return { data: req.body, ext }
}

/** Replaces (or with `null` removes) a player's photo and drops the old file. */
export async function setPlayerPhoto(playerId: number, image: { data: Buffer; ext: string } | null, actorUserId: number, clubId: number | null = null) {
  const before = await db.selectFrom('players').select('photo_url').where('id', '=', playerId).executeTakeFirst()
  if (!before) throw notFound('player.not_found')
  const url = image ? await saveFile('photos', image.data, image.ext) : null
  await db.updateTable('players').set({ photo_url: url, updated_at: new Date() }).where('id', '=', playerId).execute()
  if (before.photo_url) await removeFile(before.photo_url)
  await audit({ actorUserId, clubId, entity: 'player', entityId: playerId, action: url ? 'photo' : 'photo_removed', after: { url } })
  return url
}

myCardsRouter.post(
  '/photo',
  imageBody,
  handler(async (req, res) => {
    const user = requireUser(req)
    if (!user.playerId) throw forbidden('player.profile_required')
    res.json({ photoUrl: await setPlayerPhoto(user.playerId, uploadedImage(req), user.id) })
  }),
)

myCardsRouter.delete(
  '/photo',
  handler(async (req, res) => {
    const user = requireUser(req)
    if (!user.playerId) throw forbidden('player.profile_required')
    res.json({ photoUrl: await setPlayerPhoto(user.playerId, null, user.id) })
  }),
)

/** The club sets a photo only for its own cards without an account. */
async function clubCard(req: Request) {
  const clubId = intParam(req, 'id')
  const user = await requireClubRight(req, clubId, 'players')
  const playerId = intParam(req, 'playerId')
  const p = await db.selectFrom('players').select(['added_by_club_id', 'user_id']).where('id', '=', playerId).executeTakeFirst()
  if (!p) throw notFound('player.not_found')
  if (p.added_by_club_id !== clubId || p.user_id != null) throw forbidden('player.photo_not_club_card')
  return { clubId, user, playerId }
}

clubPhotoRouter.post(
  '/:id/players/:playerId/photo',
  imageBody,
  handler(async (req, res) => {
    const { clubId, user, playerId } = await clubCard(req)
    res.json({ photoUrl: await setPlayerPhoto(playerId, uploadedImage(req), user.id, clubId) })
  }),
)

clubPhotoRouter.delete(
  '/:id/players/:playerId/photo',
  handler(async (req, res) => {
    const { clubId, user, playerId } = await clubCard(req)
    res.json({ photoUrl: await setPlayerPhoto(playerId, null, user.id, clubId) })
  }),
)

// --- Claim an unclaimed card by picking it from a list ---------------------------------

myCardsRouter.get(
  '/claimable',
  handler(async (req, res) => {
    requireUser(req)
    const q = parseQuery(z.object({ q: z.string().trim().min(2).max(100), clubId: z.coerce.number().int().positive().optional() }), req)
    let query = db
      .selectFrom('players as p')
      .leftJoin('cities as c', 'c.id', 'p.city_id')
      .leftJoin('clubs as cl', 'cl.id', 'p.added_by_club_id')
      .select(['p.id', 'p.first_name', 'p.last_name', 'p.birth_year', 'p.photo_url', 'c.name_ru as city', 'cl.name as club'])
      .where('p.user_id', 'is', null)
      .where('p.claim_code', 'is not', null)
    if (q.clubId) query = query.where('p.added_by_club_id', '=', q.clubId)
    for (const word of searchWords(q.q)) query = query.where('p.search_name', 'like', `%${word}%`)
    const rows = await query.orderBy('p.last_name').limit(20).execute()
    res.json(rows.map((r) => ({ id: r.id, name: playerName(r), birthYear: r.birth_year, city: r.city, club: r.club, photoUrl: r.photo_url })))
  }),
)

/** Without own history the account takes the card at once (an empty own profile is merged into it); otherwise the admin merges. */
myCardsRouter.post(
  '/claim-card',
  handler(async (req, res) => {
    const user = requireUser(req)
    const { playerId } = parseBody(z.object({ playerId: z.number().int().positive() }), req)
    const result = await db.transaction().execute(async (trx) => {
      const card = await trx.selectFrom('players').select(['id', 'user_id', 'claim_code', 'added_by_club_id']).where('id', '=', playerId).forUpdate().executeTakeFirst()
      if (!card) throw notFound('player.not_found')
      if (card.user_id != null) throw conflict('claim.card_taken')
      if (!card.claim_code) throw conflict('claim.card_unavailable')
      if (!user.playerId) {
        await trx.updateTable('players').set({ user_id: user.id, claim_code: null, updated_at: new Date() }).where('id', '=', card.id).execute()
        await audit({ actorUserId: user.id, clubId: card.added_by_club_id, entity: 'player', entityId: card.id, action: 'claim_from_list' }, trx)
        return { claimed: card.id, mergeRequest: null }
      }
      const own = user.playerId
      const used = await Promise.all([
        trx.selectFrom('entries').select('id').where('player_id', '=', own).executeTakeFirst(),
        trx.selectFrom('rating_events').select('id').where('player_id', '=', own).executeTakeFirst(),
        trx.selectFrom('team_members').select('team_id').where('player_id', '=', own).executeTakeFirst(),
        trx.selectFrom('bookings').select('id').where('player_id', '=', own).executeTakeFirst(),
      ])
      await trx.updateTable('players').set({ claim_code: null }).where('id', '=', card.id).execute()
      if (used.every((r) => !r)) {
        const photo = await trx.selectFrom('players').select('photo_url').where('id', '=', own).executeTakeFirst()
        await mergePlayers(trx, own, card.id)
        if (photo?.photo_url) await trx.updateTable('players').set({ photo_url: photo.photo_url }).where('id', '=', card.id).where('photo_url', 'is', null).execute()
        await audit({ actorUserId: user.id, clubId: card.added_by_club_id, entity: 'player', entityId: card.id, action: 'claim_from_list', before: { ownPlayerId: own } }, trx)
        return { claimed: card.id, mergeRequest: null }
      }
      const mr = await trx
        .insertInto('player_merge_requests')
        .values({ club_id: card.added_by_club_id, source_player_id: card.id, target_player_id: own, reason: 'claim_from_list', requested_by: user.id })
        .returning('id')
        .executeTakeFirstOrThrow()
      await audit({ actorUserId: user.id, entity: 'merge_request', entityId: mr.id, action: 'create_by_claim' }, trx)
      return { claimed: null, mergeRequest: mr.id }
    })
    res.json(result)
  }),
)

// --- Profile disputes (T-19) -------------------------------------------------------------

const DOC_TYPES: Record<string, string> = { ...IMAGE_TYPES, 'application/pdf': 'pdf' }
const DOC_FOLDER = 'claim-docs'

myCardsRouter.post(
  '/profile-disputes/documents',
  express.raw({ type: Object.keys(DOC_TYPES), limit: 10 * 1024 * 1024 }),
  handler(async (req, res) => {
    requireUser(req)
    const ext = DOC_TYPES[req.get('content-type')?.split(';')[0]?.trim() ?? '']
    if (!ext || !Buffer.isBuffer(req.body) || req.body.length === 0) throw badRequest('upload.invalid_type')
    res.status(201).json({ url: await saveFile(DOC_FOLDER, req.body, ext) })
  }),
)

myCardsRouter.post(
  '/profile-disputes',
  handler(async (req, res) => {
    const user = requireUser(req)
    const body = parseBody(
      z.object({
        playerId: z.number().int().positive(),
        reason: z.string().trim().min(5).max(2000),
        documents: z.array(z.object({ name: z.string().trim().min(1).max(200), url: z.string().startsWith(`${UPLOADS_URL}/${DOC_FOLDER}/`) })).min(1).max(10),
      }),
      req,
    )
    const card = await db.selectFrom('players').select(['id', 'user_id']).where('id', '=', body.playerId).executeTakeFirst()
    if (!card) throw notFound('player.not_found')
    if (card.user_id == null) throw conflict('profile_dispute.card_free')
    if (card.user_id === user.id) throw conflict('profile_dispute.own_card')
    const open = await db.selectFrom('profile_claim_disputes').select('id').where('player_id', '=', card.id).where('claimant_user_id', '=', user.id).where('status', '=', 'open').executeTakeFirst()
    if (open) throw conflict('profile_dispute.already_open')
    const row = await db
      .insertInto('profile_claim_disputes')
      .values({ player_id: card.id, claimant_user_id: user.id, holder_user_id: card.user_id, reason: body.reason, documents: json(body.documents) })
      .returning('id')
      .executeTakeFirstOrThrow()
    await audit({ actorUserId: user.id, entity: 'profile_claim_dispute', entityId: row.id, action: 'create', after: { playerId: card.id, documents: body.documents.length } })
    res.status(201).json({ id: row.id })
  }),
)

myCardsRouter.get(
  '/profile-disputes',
  handler(async (req, res) => {
    const user = requireUser(req)
    const rows = await db
      .selectFrom('profile_claim_disputes')
      .select(['id', 'player_id', 'status', 'decision_note', 'created_at'])
      .where('claimant_user_id', '=', user.id)
      .orderBy('created_at', 'desc')
      .execute()
    res.json(rows.map((r) => ({ id: r.id, playerId: r.player_id, status: r.status, decisionNote: r.decision_note, createdAt: r.created_at })))
  }),
)

adminDisputesRouter.get(
  '/profile-disputes',
  handler(async (req, res) => {
    requirePlatformAdmin(req)
    const { status } = parseQuery(z.object({ status: z.enum(['open', 'approved', 'rejected']).default('open') }), req)
    const rows = await db
      .selectFrom('profile_claim_disputes as d')
      .innerJoin('players as p', 'p.id', 'd.player_id')
      .innerJoin('users as c', 'c.id', 'd.claimant_user_id')
      .leftJoin('users as h', 'h.id', 'p.user_id')
      .leftJoin('players as cp', 'cp.user_id', 'd.claimant_user_id')
      .select(['d.id', 'd.reason', 'd.documents', 'd.status', 'd.decision_note', 'd.created_at', 'p.id as player_id', 'p.first_name', 'p.last_name', 'p.birth_year', 'c.email as claimant_email', 'cp.id as claimant_player_id', 'h.email as holder_email'])
      .where('d.status', '=', status)
      .orderBy('d.created_at')
      .execute()
    res.json(
      rows.map((r) => ({
        id: r.id,
        reason: r.reason,
        documents: r.documents,
        status: r.status,
        decisionNote: r.decision_note,
        createdAt: r.created_at,
        player: { id: r.player_id, name: playerName(r), birthYear: r.birth_year },
        claimant: { email: r.claimant_email, playerId: r.claimant_player_id },
        holder: { email: r.holder_email },
      })),
    )
  }),
)

/** Approval rebinds the card to the claimant (their own profile, if any, is merged into it); the old holder loses it. */
adminDisputesRouter.post(
  '/profile-disputes/:id',
  handler(async (req, res) => {
    const admin = requirePlatformAdmin(req)
    const id = intParam(req, 'id')
    const body = parseBody(z.object({ decision: z.enum(['approve', 'reject']), note: z.string().trim().max(1000).default('') }), req)
    if (body.decision === 'reject' && !body.note) throw badRequest('profile_dispute.note_required')
    await db.transaction().execute(async (trx) => {
      const d = await trx.selectFrom('profile_claim_disputes').selectAll().where('id', '=', id).forUpdate().executeTakeFirst()
      if (!d) throw notFound('profile_dispute.not_found')
      if (d.status !== 'open') throw conflict('profile_dispute.closed')
      const card = await trx.selectFrom('players').select(['id', 'user_id']).where('id', '=', d.player_id).forUpdate().executeTakeFirstOrThrow()
      if (body.decision === 'approve') {
        await trx.updateTable('players').set({ user_id: null, updated_at: new Date() }).where('id', '=', card.id).execute()
        const own = await trx.selectFrom('players').select('id').where('user_id', '=', d.claimant_user_id).executeTakeFirst()
        if (own) await mergePlayers(trx, own.id, card.id)
        else await trx.updateTable('players').set({ user_id: d.claimant_user_id, claim_code: null }).where('id', '=', card.id).execute()
        await trx
          .updateTable('profile_claim_disputes')
          .set({ status: 'rejected', decision_note: 'superseded', decided_by: admin.id, decided_at: new Date() })
          .where('player_id', '=', card.id)
          .where('status', '=', 'open')
          .where('id', '!=', id)
          .execute()
      }
      const status = body.decision === 'approve' ? 'approved' : 'rejected'
      await trx.updateTable('profile_claim_disputes').set({ status, decision_note: body.note || null, decided_by: admin.id, decided_at: new Date() }).where('id', '=', id).execute()
      await audit(
        {
          actorUserId: admin.id,
          entity: 'profile_claim_dispute',
          entityId: id,
          action: status,
          before: { playerId: card.id, userId: card.user_id },
          after: { userId: body.decision === 'approve' ? d.claimant_user_id : card.user_id },
          reason: body.note || null,
        },
        trx,
      )
    })
    res.json({ status: body.decision === 'approve' ? 'approved' : 'rejected' })
  }),
)
