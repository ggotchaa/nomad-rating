// Organiser changes to the draw: draft (T-8), early final (T-7), manual group places (T-3), late players (T-9), swaps (T-10).

import { Router } from 'express'
import type { Request } from 'express'
import { z } from 'zod'
import { db } from '../db/index.ts'
import { requireClubRight, requirePlatformAdmin } from '../auth/access.ts'
import { handler, notFound } from '../http/errors.ts'
import { intParam, parseBody } from '../http/validate.ts'
import { bus } from '../realtime/bus.ts'
import { addLateEntry, clearDraft, draftAddToFreeSlot, draftMove, draftSwap, generateDraft, publishDraft, removeUnplayedEntry, swapEntries } from '../tournaments/stage-edit.ts'
import { openStageEarly, setGroupOrder } from '../tournaments/structure.ts'

export const stageEditRouter = Router()

async function staff(req: Request) {
  const id = intParam(req, 'id')
  const t = await db.selectFrom('tournaments').select(['id', 'club_id', 'hall_id']).where('id', '=', id).executeTakeFirst()
  if (!t) throw notFound('tournament.not_found')
  const user = req.user?.platformRole === 'admin' ? requirePlatformAdmin(req) : await requireClubRight(req, t.club_id, 'conduct', { tournamentId: id, hallId: t.hall_id })
  return { id, user }
}

const changed = (id: number) => bus.publish(`tournament:${id}`, 'match.updated', { tournamentId: id })
const reason = z.string().trim().min(3).max(500)

stageEditRouter.post(
  '/:id/draft',
  handler(async (req, res) => {
    const { id, user } = await staff(req)
    const { presentOnly } = parseBody(z.object({ presentOnly: z.boolean().default(false) }).default({ presentOnly: false }), req)
    const draft = await db.transaction().execute((trx) => generateDraft(trx, id, user.id, { presentOnly }))
    changed(id)
    res.json(draft)
  }),
)

stageEditRouter.post(
  '/:id/draft/publish',
  handler(async (req, res) => {
    const { id, user } = await staff(req)
    const { publish } = parseBody(z.object({ publish: z.boolean() }), req)
    await db.transaction().execute((trx) => publishDraft(trx, id, publish, user.id))
    changed(id)
    res.json({ ok: true })
  }),
)

stageEditRouter.delete(
  '/:id/draft',
  handler(async (req, res) => {
    const { id, user } = await staff(req)
    await db.transaction().execute((trx) => clearDraft(trx, id, user.id))
    changed(id)
    res.json({ ok: true })
  }),
)

stageEditRouter.post(
  '/:id/draft/swap',
  handler(async (req, res) => {
    const { id, user } = await staff(req)
    const { a, b } = parseBody(z.object({ a: z.number().int(), b: z.number().int() }), req)
    await db.transaction().execute((trx) => draftSwap(trx, id, a, b, user.id))
    changed(id)
    res.json({ ok: true })
  }),
)

stageEditRouter.post(
  '/:id/draft/move',
  handler(async (req, res) => {
    const { id, user } = await staff(req)
    const body = parseBody(z.object({ entryId: z.number().int(), group: z.string().max(4).optional(), seed: z.number().int().min(1).optional() }), req)
    await db.transaction().execute((trx) => draftMove(trx, id, body.entryId, body, user.id))
    changed(id)
    res.json({ ok: true })
  }),
)

stageEditRouter.post(
  '/:id/draft/add-free',
  handler(async (req, res) => {
    const { id, user } = await staff(req)
    const { entryId } = parseBody(z.object({ entryId: z.number().int() }), req)
    await db.transaction().execute((trx) => draftAddToFreeSlot(trx, id, entryId, user.id))
    changed(id)
    res.json({ ok: true })
  }),
)

stageEditRouter.post(
  '/:id/stages/:stageKey/open-early',
  handler(async (req, res) => {
    const { id, user } = await staff(req)
    await db.transaction().execute((trx) => openStageEarly(trx, id, String(req.params.stageKey), user.id))
    changed(id)
    res.json({ ok: true })
  }),
)

stageEditRouter.post(
  '/:id/stages/:stageKey/swap',
  handler(async (req, res) => {
    const { id, user } = await staff(req)
    const body = parseBody(z.object({ a: z.number().int(), b: z.number().int(), reason: reason.optional() }), req)
    await db.transaction().execute((trx) => swapEntries(trx, id, String(req.params.stageKey), body.a, body.b, body.reason ?? '', user.id))
    changed(id)
    res.json({ ok: true })
  }),
)

stageEditRouter.post(
  '/:id/groups/:groupId/order',
  handler(async (req, res) => {
    const { id, user } = await staff(req)
    const body = parseBody(z.object({ order: z.array(z.number().int()).min(2).max(16), reason }), req)
    const group = await db.selectFrom('groups as g').innerJoin('stages as s', 's.id', 'g.stage_id').select('s.tournament_id').where('g.id', '=', intParam(req, 'groupId')).executeTakeFirst()
    if (group?.tournament_id !== id) throw notFound('group.not_found')
    await db.transaction().execute((trx) => setGroupOrder(trx, intParam(req, 'groupId'), body.order, body.reason, user.id))
    changed(id)
    res.json({ ok: true })
  }),
)

stageEditRouter.post(
  '/:id/late-entries',
  handler(async (req, res) => {
    const { id, user } = await staff(req)
    const body = parseBody(
      z.object({
        playerId: z.number().int().positive(),
        stageKey: z.string().min(1).max(30),
        group: z.string().max(4).optional(),
        seed: z.number().int().min(1).optional(),
        confirmSwap: z.boolean().optional(),
        payment: z.enum(['on_site', 'waived']),
        missed: z.enum(['play', 'technical', 'ignore']).default('play'),
      }),
      req,
    )
    const entryId = await db.transaction().execute((trx) => addLateEntry(trx, id, body, user.id))
    changed(id)
    res.status(201).json({ entryId })
  }),
)

stageEditRouter.post(
  '/:id/entries/:entryId/remove',
  handler(async (req, res) => {
    const { id, user } = await staff(req)
    const body = parseBody(z.object({ reason }), req)
    const entry = await db.selectFrom('entries').select('tournament_id').where('id', '=', intParam(req, 'entryId')).executeTakeFirst()
    if (entry?.tournament_id !== id) throw notFound('entry.not_found')
    await db.transaction().execute((trx) => removeUnplayedEntry(trx, intParam(req, 'entryId'), body.reason, user.id))
    changed(id)
    res.json({ ok: true })
  }),
)
