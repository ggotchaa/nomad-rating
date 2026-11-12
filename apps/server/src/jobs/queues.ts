// BullMQ queues for the API side (producers). Null without REDIS_URL: callers then work inline.

import { Queue } from 'bullmq'
import { config } from '../config.ts'

export const QUEUES = { notify: 'notify', rating: 'rating', maintenance: 'maintenance' } as const

const cache = new Map<string, Queue>()

export function queue(name: (typeof QUEUES)[keyof typeof QUEUES]): Queue | null {
  if (!config.REDIS_URL) return null
  let q = cache.get(name)
  if (!q) {
    q = new Queue(name, { connection: { url: config.REDIS_URL } })
    cache.set(name, q)
  }
  return q
}

export async function closeQueues(): Promise<void> {
  await Promise.allSettled([...cache.values()].map((q) => q.close()))
}
