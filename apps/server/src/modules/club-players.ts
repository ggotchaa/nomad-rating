// Club-added players (R-8…R-13): duplicate check, claim by code, Excel/CSV import, merge requests.

import { randomInt } from 'node:crypto'
import { Router } from 'express'
import { sql } from 'kysely'
import { z } from 'zod'
import { START_LEVELS, normalizeText, searchName } from '@nomad/shared'
import type { StartLevel } from '@nomad/shared'
import { db, json } from '../db/index.ts'
import type { Db, Transaction } from '../db/index.ts'
import type { Database } from '../db/types.ts'
import { audit } from '../audit.ts'
import { requireClubRight, requireUser } from '../auth/access.ts'
import { badRequest, conflict, handler, notFound } from '../http/errors.ts'
import { intParam, parseBody } from '../http/validate.ts'
import { validateImportRows } from './import-rows.ts'
import type { ImportPlayer } from './import-rows.ts'
import { readTable, tableUpload } from './tabular.ts'

export const clubPlayersRouter = Router()
export const claimRouter = Router()

type Exec = Db | Transaction<Database>

/** A self-chosen level; «разрядник» stays at the default level until an organiser confirms it. */
export const selfLevel = (level: StartLevel) =>
  level === 'ranked'
    ? { start_level: START_LEVELS.amateur, requested_level: START_LEVELS.ranked, level_status: 'pending' as const }
    : { start_level: START_LEVELS[level], requested_level: null, level_status: null }

export const newClaimCode = () => String(randomInt(100000, 999999)) + String(randomInt(0, 1000)).padStart(3, '0')

/** R-9: similar name (trigram) and the same birth year ±1 or the same city. */
export async function findDuplicates(exec: Exec, p: { lastName: string; firstName: string; middleName?: string | null; birthYear: number; cityId: number }) {
  const name = normalizeText(`${p.lastName} ${p.firstName}`)
  const rows = await exec
    .selectFrom('players as p')
    .leftJoin('cities as c', 'c.id', 'p.city_id')
    .select(['p.id', 'p.first_name', 'p.last_name', 'p.birth_year', 'p.user_id', 'c.name_ru as city', sql<number>`word_similarity(${name}, p.search_name)`.as('score')])
    .where(sql<boolean>`word_similarity(${name}, p.search_name) >= 0.6`)
    .where((eb) => eb.or([eb('p.birth_year', 'in', [p.birthYear - 1, p.birthYear, p.birthYear + 1]), eb('p.city_id', '=', p.cityId)]))
    .orderBy('score', 'desc')
    .limit(10)
    .execute()
  return rows.map((r) => ({ id: r.id, name: `${r.last_name} ${r.first_name}`, birthYear: r.birth_year, city: r.city, hasAccount: r.user_id != null }))
}

export async function createClubPlayer(trx: Transaction<Database>, clubId: number, actorUserId: number, p: ImportPlayer, action = 'create_by_club') {
  const row = await trx
    .insertInto('players')
    .values({
      first_name: p.firstName,
      last_name: p.lastName,
      middle_name: p.middleName,
      gender: p.gender,
      birth_year: p.birthYear,
      city_id: p.cityId,
      start_level: START_LEVELS[p.startLevel],
      added_by_club_id: clubId,
      contact_email: p.email,
      claim_code: newClaimCode(),
      search_name: searchName(p),
    })
    .returning(['id', 'claim_code'])
    .executeTakeFirstOrThrow()
  await trx.insertInto('player_ratings').values({ player_id: row.id, kind: 'singles', rating: null, calibration: json({ tournaments: 0 }) }).execute()
  await audit({ actorUserId, clubId, entity: 'player', entityId: row.id, action, after: p }, trx)
  return row
}

async function cityNames() {
  const cities = await db.selectFrom('cities').select(['id', 'name_ru', 'name_kk', 'name_en', 'slug']).execute()
  return cities.map((c) => ({ id: c.id, names: [c.name_ru, c.name_kk, c.name_en, c.slug] }))
}

clubPlayersRouter.post(
  '/:id/players/import/preview',
  tableUpload,
  handler(async (req, res) => {
    const clubId = intParam(req, 'id')
    await requireClubRight(req, clubId, 'players')
    const table = await readTable(req.body)
    if (table.length > 2001) throw badRequest('import.too_many_rows')
    const rows = validateImportRows(table, await cityNames())
    const out = []
    for (const r of rows) out.push({ ...r, duplicates: r.data ? await findDuplicates(db, r.data) : [] })
    res.json({ rows: out, valid: out.filter((r) => r.data).length, invalid: out.filter((r) => !r.data).length })
  }),
)

const importPlayer = z.object({
  lastName: z.string().trim().min(1).max(80),
  firstName: z.string().trim().min(1).max(80),
  middleName: z.string().trim().max(80).nullable(),
  gender: z.enum(['m', 'f']),
  birthYear: z.number().int().min(1920).max(new Date().getFullYear() - 5),
  cityId: z.number().int().positive(),
  email: z.email().nullable(),
  startLevel: z.enum(Object.keys(START_LEVELS) as [keyof typeof START_LEVELS]),
})

/** Confirm step: the client sends back the rows it accepted after the preview. */
clubPlayersRouter.post(
  '/:id/players/import/confirm',
  handler(async (req, res) => {
    const clubId = intParam(req, 'id')
    const user = await requireClubRight(req, clubId, 'players')
    const { players } = parseBody(z.object({ players: z.array(importPlayer).min(1).max(2000) }), req)
    const created = await db.transaction().execute(async (trx) => {
      const out = []
      for (const p of players) {
        const row = await createClubPlayer(trx, clubId, user.id, p, 'import')
        out.push({ id: row.id, name: `${p.lastName} ${p.firstName}`, claimCode: row.claim_code })
      }
      return out
    })
    res.status(201).json({ created })
  }),
)

/** R-12: the club corrects the start level while the player has no rating yet; also confirms or rejects «разрядник». */
clubPlayersRouter.post(
  '/:id/players/:playerId/start-level',
  handler(async (req, res) => {
    const clubId = intParam(req, 'id')
    const user = await requireClubRight(req, clubId, 'players')
    const body = parseBody(z.union([z.object({ startLevel: z.enum(Object.keys(START_LEVELS) as [StartLevel]) }), z.object({ decision: z.enum(['confirm', 'reject']) })]), req)
    const playerId = intParam(req, 'playerId')
    const result = await db.transaction().execute(async (trx) => {
      const p = await trx.selectFrom('players').select(['id', 'start_level', 'requested_level', 'level_status']).where('id', '=', playerId).forUpdate().executeTakeFirst()
      if (!p) throw notFound('player.not_found')
      const rating = await trx.selectFrom('player_ratings').select('rating').where('player_id', '=', playerId).where('kind', '=', 'singles').executeTakeFirst()
      if (rating?.rating != null) throw conflict('player.start_level_locked')
      let set: { start_level: number; requested_level: null; level_status: 'confirmed' | 'rejected' | null }
      if ('decision' in body) {
        if (p.level_status !== 'pending' || p.requested_level == null) throw conflict('player.level_not_pending')
        set = { start_level: body.decision === 'confirm' ? p.requested_level : p.start_level, requested_level: null, level_status: body.decision === 'confirm' ? 'confirmed' : 'rejected' }
      } else set = { start_level: START_LEVELS[body.startLevel], requested_level: null, level_status: body.startLevel === 'ranked' ? 'confirmed' : null }
      await trx.updateTable('players').set({ ...set, updated_at: new Date() }).where('id', '=', playerId).execute()
      const action = 'decision' in body ? `level_${body.decision}` : 'start_level_corrected'
      await audit({ actorUserId: user.id, clubId, entity: 'player', entityId: playerId, action, before: { startLevel: p.start_level, levelStatus: p.level_status }, after: set }, trx)
      return { startLevel: set.start_level, levelStatus: set.level_status }
    })
    res.json(result)
  }),
)

/** Claim codes of the club's unclaimed profiles (to hand out to players). */
clubPlayersRouter.get(
  '/:id/players/claim-codes',
  handler(async (req, res) => {
    const clubId = intParam(req, 'id')
    await requireClubRight(req, clubId, 'players')
    const rows = await db
      .selectFrom('players')
      .select(['id', 'first_name', 'last_name', 'birth_year', 'claim_code', 'contact_email'])
      .where('added_by_club_id', '=', clubId)
      .where('user_id', 'is', null)
      .orderBy('last_name')
      .execute()
    res.json(rows.map((r) => ({ id: r.id, name: `${r.last_name} ${r.first_name}`, birthYear: r.birth_year, claimCode: r.claim_code, email: r.contact_email })))
  }),
)

clubPlayersRouter.post(
  '/:id/merge-requests',
  handler(async (req, res) => {
    const clubId = intParam(req, 'id')
    const user = await requireClubRight(req, clubId, 'players')
    const body = parseBody(z.object({ sourcePlayerId: z.number().int(), targetPlayerId: z.number().int(), reason: z.string().max(1000).default('') }), req)
    if (body.sourcePlayerId === body.targetPlayerId) throw badRequest('merge.same_player')
    const found = await db.selectFrom('players').select('id').where('id', 'in', [body.sourcePlayerId, body.targetPlayerId]).execute()
    if (found.length !== 2) throw notFound('player.not_found')
    const row = await db
      .insertInto('player_merge_requests')
      .values({ club_id: clubId, source_player_id: body.sourcePlayerId, target_player_id: body.targetPlayerId, reason: body.reason, requested_by: user.id })
      .returning('id')
      .executeTakeFirstOrThrow()
    await audit({ actorUserId: user.id, clubId, entity: 'merge_request', entityId: row.id, action: 'create', after: body })
    res.status(201).json({ id: row.id })
  }),
)

/** R-11: one-time claim code. Without a profile the account takes it; with one, a merge request goes to the admin. */
claimRouter.post(
  '/claim',
  handler(async (req, res) => {
    const user = requireUser(req)
    const { code } = parseBody(z.object({ code: z.string().trim().regex(/^\d{6,12}$/) }), req)
    const result = await db.transaction().execute(async (trx) => {
      const p = await trx.selectFrom('players').select(['id', 'user_id', 'added_by_club_id']).where('claim_code', '=', code).forUpdate().executeTakeFirst()
      if (!p || p.user_id) throw notFound('claim.code_invalid')
      if (!user.playerId) {
        await trx.updateTable('players').set({ user_id: user.id, claim_code: null, updated_at: new Date() }).where('id', '=', p.id).execute()
        await audit({ actorUserId: user.id, clubId: p.added_by_club_id, entity: 'player', entityId: p.id, action: 'claim_by_code' }, trx)
        return { claimed: p.id, mergeRequest: null }
      }
      await trx.updateTable('players').set({ claim_code: null }).where('id', '=', p.id).execute()
      const mr = await trx
        .insertInto('player_merge_requests')
        .values({ club_id: p.added_by_club_id, source_player_id: p.id, target_player_id: user.playerId, reason: 'claim_code', requested_by: user.id })
        .returning('id')
        .executeTakeFirstOrThrow()
      await audit({ actorUserId: user.id, entity: 'merge_request', entityId: mr.id, action: 'create_by_claim' }, trx)
      return { claimed: null, mergeRequest: mr.id }
    })
    res.json(result)
  }),
)

/** Moves everything of `sourceId` to `targetId` and deletes the source profile. Ratings are replayed later (stage 3). */
export async function mergePlayers(trx: Transaction<Database>, sourceId: number, targetId: number): Promise<void> {
  const [source, target] = await Promise.all(
    [sourceId, targetId].map((id) => trx.selectFrom('players').select(['id', 'user_id']).where('id', '=', id).forUpdate().executeTakeFirst()),
  )
  if (!source || !target) throw notFound('player.not_found')
  if (source.user_id && target.user_id) throw conflict('merge.both_have_accounts')
  const clash = await trx
    .selectFrom('entries as a')
    .innerJoin('entries as b', 'b.tournament_id', 'a.tournament_id')
    .select('a.tournament_id')
    .where('a.player_id', '=', sourceId)
    .where('b.player_id', '=', targetId)
    .executeTakeFirst()
  if (clash) throw conflict('merge.same_tournament', { tournamentId: clash.tournament_id })
  await trx.updateTable('entries').set({ player_id: targetId }).where('player_id', '=', sourceId).execute()
  await trx.updateTable('bookings').set({ player_id: targetId }).where('player_id', '=', sourceId).execute()
  await trx.updateTable('rating_events').set({ player_id: targetId }).where('player_id', '=', sourceId).execute()
  await trx.updateTable('rating_events').set({ opponent_id: targetId }).where('opponent_id', '=', sourceId).execute()
  await trx.updateTable('rating_snapshots').set({ player_id: targetId }).where('player_id', '=', sourceId).execute()
  const rttf = await trx.selectFrom('rttf_profiles').select('id').where('player_id', '=', targetId).executeTakeFirst()
  if (!rttf) await trx.updateTable('rttf_profiles').set({ player_id: targetId }).where('player_id', '=', sourceId).execute()
  await trx.deleteFrom('players').where('id', '=', sourceId).execute()
  if (source.user_id) await trx.updateTable('players').set({ user_id: source.user_id, updated_at: new Date() }).where('id', '=', targetId).execute()
}

