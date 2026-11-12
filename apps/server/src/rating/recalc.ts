// Background replay of ratings after a correction, with the public «рейтинг обновляется» flag.

import { db, json } from '../db/index.ts'
import { QUEUES, queue } from '../jobs/queues.ts'
import { logger } from '../logger.ts'
import { bus } from '../realtime/bus.ts'
import { recalculateFrom } from './service.ts'

const KEY = 'rating_recalc'

export type RecalcStatus = { running: boolean; tournamentId?: number; since?: string; lastMs?: number }

async function setStatus(value: RecalcStatus): Promise<void> {
  await db
    .insertInto('platform_settings')
    .values({ key: KEY, value: json(value) })
    .onConflict((oc) => oc.column('key').doUpdateSet({ value: json(value), updated_at: new Date() }))
    .execute()
  bus.publish('rating', 'rating.status', value)
}

export async function recalcStatus(): Promise<RecalcStatus> {
  const row = await db.selectFrom('platform_settings').select('value').where('key', '=', KEY).executeTakeFirst()
  return (row?.value as RecalcStatus | undefined) ?? { running: false }
}

export async function requestRecalc(tournamentId: number): Promise<void> {
  await setStatus({ running: true, tournamentId, since: new Date().toISOString() })
  const q = queue(QUEUES.rating)
  if (q) await q.add('recalculate', { tournamentId }, { attempts: 2, removeOnComplete: 100 })
  else setImmediate(() => void runRecalc(tournamentId).catch((err) => logger.error({ err }, 'rating recalc failed')))
}

export async function runRecalc(tournamentId: number): Promise<{ tournaments: number; players: number; ms: number }> {
  const started = Date.now()
  try {
    const result = await db.transaction().execute((trx) => recalculateFrom(trx, tournamentId))
    const ms = Date.now() - started
    logger.info({ tournamentId, ...result, ms }, 'rating recalculated')
    await setStatus({ running: false, lastMs: ms })
    return { ...result, ms }
  } catch (err) {
    await setStatus({ running: false })
    throw err
  }
}
