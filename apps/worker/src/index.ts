// Background jobs (BullMQ on Redis). Stage D: hold expiry. Later: notifications with retries,
// reminders, rating recalculation, payout holds, Telegram delivery.

import { Queue, Worker } from 'bullmq'
import { config } from '@nomad/server/src/config.ts'
import { db } from '@nomad/server/src/db/index.ts'
import { expireHolds } from '@nomad/server/src/jobs/holds.ts'
import { logger } from '@nomad/server/src/logger.ts'
import { bus } from '@nomad/server/src/realtime/bus.ts'
// --- Stage 3: notifications, rating replay, Telegram bot ---
import { closeQueues, QUEUES } from '@nomad/server/src/jobs/queues.ts'
import { runScheduledNotifications } from '@nomad/server/src/jobs/notifications.ts'
import { deliver } from '@nomad/server/src/notify/index.ts'
import type { DeliveryJob } from '@nomad/server/src/notify/index.ts'
import { runRecalc } from '@nomad/server/src/rating/recalc.ts'
import { createBot } from '@nomad/server/src/telegram/bot.ts'

if (!config.REDIS_URL) {
  logger.error('REDIS_URL is required for the worker')
  process.exit(1)
}

const connection = { url: config.REDIS_URL }
const QUEUE = 'maintenance'

const queue = new Queue(QUEUE, { connection })
await queue.upsertJobScheduler('expire-holds', { every: 60_000 }, { name: 'expire-holds' })
await queue.upsertJobScheduler('scheduled-notifications', { every: 5 * 60_000 }, { name: 'scheduled-notifications' })

const worker = new Worker(
  QUEUE,
  async (job) => {
    if (job.name === 'expire-holds') {
      const result = await expireHolds()
      if (result.entries || result.bookings) logger.info(result, 'holds expired')
      return result
    }
    if (job.name === 'scheduled-notifications') return runScheduledNotifications()
    throw new Error(`unknown job ${job.name}`)
  },
  { connection, concurrency: 1 },
)
worker.on('failed', (job, err) => logger.error({ job: job?.name, err }, 'job failed'))

// --- Stage 3 ---
const notifyWorker = new Worker<DeliveryJob>(QUEUES.notify, (job) => deliver(job.data, job.attemptsMade + 1), { connection, concurrency: 20 })
const ratingWorker = new Worker<{ tournamentId: number }>(QUEUES.rating, (job) => runRecalc(job.data.tournamentId), { connection, concurrency: 1 })
for (const w of [notifyWorker, ratingWorker]) w.on('failed', (job, err) => logger.warn({ job: job?.name, attempt: job?.attemptsMade, err: err.message }, 'job failed'))
const bot = createBot()
if (bot) void bot.start({ onStart: (me) => logger.info({ bot: me.username }, 'telegram bot started') })
// --- end Stage 3 ---
logger.info('worker started')

async function shutdown() {
  await worker.close()
  await Promise.allSettled([notifyWorker.close(), ratingWorker.close(), bot?.stop(), closeQueues()])
  await queue.close()
  await bus.close()
  await db.destroy()
  process.exit(0)
}
process.on('SIGINT', () => void shutdown())
process.on('SIGTERM', () => void shutdown())
