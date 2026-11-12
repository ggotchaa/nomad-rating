// Hall plan of a tournament (public): the tables screen and the live page draw it in `tournament` mode.

import { Router } from 'express'
import { db } from '../db/index.ts'
import { handler, notFound } from '../http/errors.ts'
import { intParam } from '../http/validate.ts'

export const tournamentPlanRouter = Router()

tournamentPlanRouter.get(
  '/:id/plan',
  handler(async (req, res) => {
    const t = await db.selectFrom('tournaments').select(['hall_id', 'table_ids']).where('id', '=', intParam(req, 'id')).executeTakeFirst()
    if (!t) throw notFound('tournament.not_found')
    const [hall, tables] = await Promise.all([
      db.selectFrom('halls').select('plan').where('id', '=', t.hall_id).executeTakeFirstOrThrow(),
      t.table_ids.length ? db.selectFrom('hall_tables').select(['id', 'number', 'x', 'y', 'rotation', 'label']).where('id', 'in', t.table_ids).orderBy('number').execute() : [],
    ])
    res.set('Cache-Control', 'public, max-age=60').json({ plan: hall.plan, tables })
  }),
)
