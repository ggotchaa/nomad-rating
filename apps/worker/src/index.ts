// Background jobs (BullMQ on Redis). Stage D: hold expiry. Later: notifications with retries,
// reminders, rating recalculation, payout holds, Telegram delivery.

import { Queue, Worker } from 'bullmq'
import { config } from '@nomad/server/src/config.ts'
import { db } from '@nomad/server/src/db/index.ts'
import { expireHolds } from '@nomad/server/src/jobs/holds.ts'
import { logger } from '@nomad/server/src/logger.ts'
import { bus } from '@nomad/server/src/realtime/bus.ts'

if (!config.REDIS_URL) {
  logger.error('REDIS_URL is required for the worker')
  process.exit(1)
}

const connection = { url: config.REDIS_URL }
const QUEUE = 'maintenance'

const queue = new Queue(QUEUE, { connection })
await queue.upsertJobScheduler('expire-holds', { every: 60_000 }, { name: 'expire-holds' })

const worker = new Worker(
  QUEUE,
  async (job) => {
    if (job.name === 'expire-holds') {
      const result = await expireHolds()
      if (result.entries || result.bookings) logger.info(result, 'holds expired')
      return result
    }
    throw new Error(`unknown job ${job.name}`)
  },
  { connection, concurrency: 1 },
)
worker.on('failed', (job, err) => logger.error({ job: job?.name, err }, 'job failed'))
logger.info('worker started')

async function shutdown() {
  await worker.close()
  await queue.close()
  await bus.close()
  await db.destroy()
  process.exit(0)
}
process.on('SIGINT', () => void shutdown())
process.on('SIGTERM', () => void shutdown())
