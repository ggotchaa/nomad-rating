// RTTF base (R-14…R-18): admin import and edit, player search, «Это я» transfer, conflicts, add requests.

import { Router } from 'express'
import { z } from 'zod'
import { rttfToElo } from '@nomad/engine'
import { searchWords } from '@nomad/shared'
import { db, json } from '../db/index.ts'
import type { Transaction } from '../db/index.ts'
import type { Database } from '../db/types.ts'
import { audit } from '../audit.ts'
import { requirePlatformAdmin, requireUser } from '../auth/access.ts'
import { badRequest, conflict, forbidden, handler, notFound } from '../http/errors.ts'
import { intParam, pageQuery, parseBody, parseQuery } from '../http/validate.ts'
import { rankRttf, rttfSearchName } from './rttf-match.ts'
import { headerIndex, readTable, tableUpload } from './tabular.ts'

export const rttfRouter = Router()
export const adminRttfRouter = Router()

async function searchRttf(q: string, birthYear: number | null, limit: number) {
  const words = searchWords(q)
  if (!words.length) return []
  let query = db
    .selectFrom('rttf_profiles as r')
    .leftJoin('players as p', 'p.id', 'r.player_id')
    .select(['r.id', 'r.rttf_id', 'r.full_name', 'r.search_name', 'r.birth_year', 'r.city', 'r.rating', 'r.player_id', 'p.first_name', 'p.last_name'])
  for (const w of words) query = query.where('r.search_name', 'like', `%${w}%`)
  const rows = await query.limit(300).execute()
  return rankRttf(q, birthYear, rows)
    .slice(0, limit)
    .map((r) => ({
      id: r.id,
      rttfId: r.rttf_id,
      fullName: r.full_name,
      birthYear: r.birth_year,
      city: r.city,
      rating: r.rating,
      transferred: rttfToElo(r.rating),
      claimedBy: r.player_id ? { id: r.player_id, name: `${r.last_name} ${r.first_name}` } : null,
    }))
}

rttfRouter.get(
  '/search',
  handler(async (req, res) => {
    const q = parseQuery(z.object({ q: z.string().trim().min(2).max(100), birthYear: z.coerce.number().int().optional() }), req)
    res.json(await searchRttf(q.q, q.birthYear ?? null, 20))
  }),
)

/** Sets the transferred rating: round(2·RTTF + 700), min 100, source `rttf` (K = 40 for 5 matches in the engine). */
async function applyClaim(trx: Transaction<Database>, profileId: number, playerId: number, actorUserId: number) {
  const profile = await trx.selectFrom('rttf_profiles').select(['rating']).where('id', '=', profileId).executeTakeFirstOrThrow()
  const rating = rttfToElo(profile.rating)
  await trx.updateTable('rttf_profiles').set({ player_id: playerId }).where('id', '=', profileId).execute()
  await trx
    .insertInto('player_ratings')
    .values({ player_id: playerId, kind: 'singles', rating, source: 'rttf', rated_matches: 0, max_rating: rating, calibration: json({ tournaments: 0 }) })
    .onConflict((oc) => oc.columns(['player_id', 'kind']).doUpdateSet({ rating, source: 'rttf', rated_matches: 0, max_rating: rating, updated_at: new Date() }))
    .execute()
  await audit({ actorUserId, entity: 'player', entityId: playerId, action: 'rttf_transfer', after: { profileId, rttf: profile.rating, rating } }, trx)
  return rating
}

rttfRouter.post(
  '/:id/claim',
  handler(async (req, res) => {
    const user = requireUser(req)
    if (!user.playerId) throw forbidden('player.profile_required')
    const playerId = user.playerId
    const profileId = intParam(req, 'id')
    const result = await db.transaction().execute(async (trx) => {
      const profile = await trx.selectFrom('rttf_profiles').select(['id', 'player_id']).where('id', '=', profileId).forUpdate().executeTakeFirst()
      if (!profile) throw notFound('rttf.not_found')
      if (profile.player_id === playerId) throw conflict('rttf.already_yours')
      const own = await trx.selectFrom('rttf_profiles').select('id').where('player_id', '=', playerId).executeTakeFirst()
      if (own) throw conflict('rttf.already_claimed_other')
      const rating = await trx.selectFrom('player_ratings').select(['rated_matches']).where('player_id', '=', playerId).where('kind', '=', 'singles').executeTakeFirst()
      // Taken by someone else, or the player already has rated matches: the admin decides.
      const reason = profile.player_id ? 'taken' : (rating?.rated_matches ?? 0) > 0 ? 'has_matches' : null
      if (reason) {
        const open = await trx.selectFrom('rttf_claims').select('id').where('rttf_profile_id', '=', profileId).where('player_id', '=', playerId).where('status', '=', 'conflict').executeTakeFirst()
        if (!open) await trx.insertInto('rttf_claims').values({ kind: 'claim', rttf_profile_id: profileId, player_id: playerId, status: 'conflict', reason }).execute()
        return { status: 'conflict' as const, reason }
      }
      const newRating = await applyClaim(trx, profileId, playerId, user.id)
      await trx.insertInto('rttf_claims').values({ kind: 'claim', rttf_profile_id: profileId, player_id: playerId, status: 'approved' }).execute()
      return { status: 'approved' as const, rating: newRating }
    })
    res.json(result)
  }),
)

const addRequest = z.object({
  fullName: z.string().trim().min(3).max(150),
  birthYear: z.number().int().min(1920).max(new Date().getFullYear()),
  city: z.string().trim().max(80).default(''),
  rating: z.number().int().min(0).max(5000),
  url: z.string().trim().max(300).default(''),
})

rttfRouter.post(
  '/requests',
  handler(async (req, res) => {
    const user = requireUser(req)
    if (!user.playerId) throw forbidden('player.profile_required')
    const body = parseBody(addRequest, req)
    const row = await db.insertInto('rttf_claims').values({ kind: 'add_request', player_id: user.playerId, status: 'pending', payload: json(body) }).returning('id').executeTakeFirstOrThrow()
    await audit({ actorUserId: user.id, entity: 'rttf_claim', entityId: row.id, action: 'add_request', after: body })
    res.status(201).json({ id: row.id })
  }),
)

rttfRouter.get(
  '/mine',
  handler(async (req, res) => {
    const user = requireUser(req)
    if (!user.playerId) return res.json({ profile: null, claims: [] })
    const profile = await db.selectFrom('rttf_profiles').select(['id', 'full_name', 'rating', 'birth_year', 'city']).where('player_id', '=', user.playerId).executeTakeFirst()
    const claims = await db.selectFrom('rttf_claims').select(['id', 'kind', 'status', 'reason', 'created_at']).where('player_id', '=', user.playerId).orderBy('created_at', 'desc').execute()
    res.json({ profile: profile ?? null, claims })
  }),
)

// --- Admin -------------------------------------------------------------------------

const ALIASES = {
  rttfId: ['id', 'rttfid', 'rttf', 'номер'],
  fullName: ['фио', 'имя', 'name', 'fullname', 'игрок'],
  birthYear: ['годрождения', 'год', 'birthyear', 'year'],
  city: ['город', 'city'],
  rating: ['рейтинг', 'rating'],
}

adminRttfRouter.post(
  '/import',
  tableUpload,
  handler(async (req, res) => {
    const admin = requirePlatformAdmin(req)
    const [header, ...rows] = await readTable(req.body)
    if (!header) throw badRequest('import.empty_file')
    const col = headerIndex(header, ALIASES)
    if (col.fullName == null || col.rating == null) throw badRequest('import.missing_column', { required: ['fullName', 'rating'] })
    const errors: { row: number; error: string }[] = []
    let created = 0
    let updated = 0
    await db.transaction().execute(async (trx) => {
      for (const [i, cells] of rows.entries()) {
        const get = (k: keyof typeof ALIASES) => (col[k] == null ? '' : (cells[col[k]] ?? '').trim())
        const fullName = get('fullName').replace(/\s+/g, ' ')
        const rating = Number(get('rating'))
        const birthYear = get('birthYear') ? Number(get('birthYear')) : null
        if (!fullName || !Number.isFinite(rating) || rating < 0 || (birthYear != null && !Number.isInteger(birthYear))) {
          errors.push({ row: i + 2, error: 'import.row_invalid' })
          continue
        }
        const values = { full_name: fullName, search_name: rttfSearchName(fullName), birth_year: birthYear, city: get('city'), rating: Math.round(rating), updated_at: new Date() }
        const rttfId = get('rttfId') || null
        const existing = rttfId
          ? await trx.selectFrom('rttf_profiles').select('id').where('rttf_id', '=', rttfId).executeTakeFirst()
          : await trx.selectFrom('rttf_profiles').select('id').where('search_name', '=', values.search_name).where('birth_year', birthYear == null ? 'is' : '=', birthYear).executeTakeFirst()
        if (existing) {
          await trx.updateTable('rttf_profiles').set(values).where('id', '=', existing.id).execute()
          updated++
        } else {
          await trx.insertInto('rttf_profiles').values({ ...values, rttf_id: rttfId }).execute()
          created++
        }
      }
      await audit({ actorUserId: admin.id, entity: 'rttf', entityId: 'import', action: 'import', after: { created, updated, errors: errors.length } }, trx)
    })
    res.json({ created, updated, errors })
  }),
)

adminRttfRouter.get(
  '/',
  handler(async (req, res) => {
    requirePlatformAdmin(req)
    const q = parseQuery(z.object({ q: z.string().trim().max(100).default(''), birthYear: z.coerce.number().int().optional(), ...pageQuery }), req)
    if (q.q.length >= 2) return res.json({ total: null, items: await searchRttf(q.q, q.birthYear ?? null, q.limit) })
    const [items, total] = await Promise.all([
      db.selectFrom('rttf_profiles').selectAll().orderBy('rating', 'desc').limit(q.limit).offset(q.offset).execute(),
      db.selectFrom('rttf_profiles').select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirstOrThrow(),
    ])
    res.json({
      total: Number(total.n),
      items: items.map((r) => ({ id: r.id, rttfId: r.rttf_id, fullName: r.full_name, birthYear: r.birth_year, city: r.city, rating: r.rating, transferred: rttfToElo(r.rating), claimedBy: r.player_id ? { id: r.player_id, name: '' } : null })),
    })
  }),
)

const profileEdit = z.object({
  fullName: z.string().trim().min(3).max(150).optional(),
  birthYear: z.number().int().min(1920).max(new Date().getFullYear()).nullable().optional(),
  city: z.string().trim().max(80).optional(),
  rating: z.number().int().min(0).max(5000).optional(),
  rttfId: z.string().trim().max(40).nullable().optional(),
})

adminRttfRouter.patch(
  '/:id',
  handler(async (req, res) => {
    const admin = requirePlatformAdmin(req)
    const id = intParam(req, 'id')
    const body = parseBody(profileEdit, req)
    const before = await db.selectFrom('rttf_profiles').selectAll().where('id', '=', id).executeTakeFirst()
    if (!before) throw notFound('rttf.not_found')
    await db
      .updateTable('rttf_profiles')
      .set({
        ...(body.fullName && { full_name: body.fullName, search_name: rttfSearchName(body.fullName) }),
        ...(body.birthYear !== undefined && { birth_year: body.birthYear }),
        ...(body.city !== undefined && { city: body.city }),
        ...(body.rating !== undefined && { rating: body.rating }),
        ...(body.rttfId !== undefined && { rttf_id: body.rttfId }),
        updated_at: new Date(),
      })
      .where('id', '=', id)
      .execute()
    await audit({ actorUserId: admin.id, entity: 'rttf', entityId: id, action: 'update', before, after: body })
    res.json({ ok: true })
  }),
)

adminRttfRouter.get(
  '/claims',
  handler(async (req, res) => {
    requirePlatformAdmin(req)
    const rows = await db
      .selectFrom('rttf_claims as c')
      .innerJoin('players as p', 'p.id', 'c.player_id')
      .leftJoin('rttf_profiles as r', 'r.id', 'c.rttf_profile_id')
      .leftJoin('players as holder', 'holder.id', 'r.player_id')
      .select([
        'c.id',
        'c.kind',
        'c.status',
        'c.reason',
        'c.payload',
        'c.created_at',
        'p.id as player_id',
        'p.first_name',
        'p.last_name',
        'p.birth_year',
        'r.id as profile_id',
        'r.full_name',
        'r.rating',
        'r.birth_year as profile_birth_year',
        'holder.id as holder_id',
        'holder.first_name as holder_first',
        'holder.last_name as holder_last',
      ])
      .where('c.status', 'in', ['conflict', 'pending'])
      .orderBy('c.created_at')
      .execute()
    res.json(
      rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        status: r.status,
        reason: r.reason,
        payload: r.payload,
        createdAt: r.created_at,
        player: { id: r.player_id, name: `${r.last_name} ${r.first_name}`, birthYear: r.birth_year },
        profile: r.profile_id ? { id: r.profile_id, fullName: r.full_name, rating: r.rating, birthYear: r.profile_birth_year } : null,
        holder: r.holder_id ? { id: r.holder_id, name: `${r.holder_last} ${r.holder_first}` } : null,
      })),
    )
  }),
)

/** Approve: the profile moves to the claimant (taken from the holder if any); add requests create the profile. */
adminRttfRouter.post(
  '/claims/:id',
  handler(async (req, res) => {
    const admin = requirePlatformAdmin(req)
    const id = intParam(req, 'id')
    const { action, reason } = parseBody(z.object({ action: z.enum(['approve', 'reject']), reason: z.string().max(500).default('') }), req)
    await db.transaction().execute(async (trx) => {
      const claim = await trx.selectFrom('rttf_claims').selectAll().where('id', '=', id).forUpdate().executeTakeFirst()
      if (!claim || !['conflict', 'pending'].includes(claim.status)) throw notFound('rttf.claim_not_found')
      if (action === 'approve') {
        let profileId = claim.rttf_profile_id
        if (claim.kind === 'add_request') {
          const p = claim.payload as { fullName: string; birthYear: number; city: string; rating: number }
          profileId = (
            await trx
              .insertInto('rttf_profiles')
              .values({ full_name: p.fullName, search_name: rttfSearchName(p.fullName), birth_year: p.birthYear, city: p.city, rating: p.rating })
              .returning('id')
              .executeTakeFirstOrThrow()
          ).id
        }
        await trx.updateTable('rttf_profiles').set({ player_id: null }).where('player_id', '=', claim.player_id).execute()
        await applyClaim(trx, profileId!, claim.player_id, admin.id)
      }
      await trx
        .updateTable('rttf_claims')
        .set({ status: action === 'approve' ? 'approved' : 'rejected', reason: reason || claim.reason, resolved_by: admin.id, resolved_at: new Date() })
        .where('id', '=', id)
        .execute()
      await audit({ actorUserId: admin.id, entity: 'rttf_claim', entityId: id, action, reason }, trx)
    })
    res.json({ ok: true })
  }),
)
