// Event bus between API processes, the worker and WebSocket clients.
// Redis pub/sub when REDIS_URL is set (several processes), in-process otherwise.
// Rooms: `tournament:{id}`, `hall:{id}`, `user:{id}`, `club:{id}`.

import { EventEmitter } from 'node:events'
import { Redis } from 'ioredis'
import { config } from '../config.ts'
import { logger } from '../logger.ts'

export type BusEvent = { room: string; type: string; data: unknown }
type Listener = (event: BusEvent) => void

const CHANNEL = 'nomad:events'

export interface Bus {
  publish(room: string, type: string, data: unknown): void
  subscribe(listener: Listener): () => void
  close(): Promise<void>
}

class LocalBus implements Bus {
  private emitter = new EventEmitter().setMaxListeners(0)
  publish(room: string, type: string, data: unknown) {
    this.emitter.emit('event', { room, type, data })
  }
  subscribe(listener: Listener) {
    this.emitter.on('event', listener)
    return () => void this.emitter.off('event', listener)
  }
  async close() {}
}

class RedisBus implements Bus {
  private pub: Redis
  private sub: Redis
  private listeners = new Set<Listener>()
  constructor(url: string) {
    this.pub = new Redis(url, { lazyConnect: false, maxRetriesPerRequest: 2 })
    this.sub = new Redis(url, { lazyConnect: false })
    this.sub.subscribe(CHANNEL).catch((err) => logger.error({ err }, 'redis subscribe failed'))
    this.sub.on('message', (_channel, message: string) => {
      const event = JSON.parse(message) as BusEvent
      for (const l of this.listeners) l(event)
    })
    for (const c of [this.pub, this.sub]) c.on('error', (err) => logger.warn({ err: err.message }, 'redis error'))
  }
  publish(room: string, type: string, data: unknown) {
    this.pub.publish(CHANNEL, JSON.stringify({ room, type, data })).catch((err) => logger.warn({ err }, 'publish failed'))
  }
  subscribe(listener: Listener) {
    this.listeners.add(listener)
    return () => void this.listeners.delete(listener)
  }
  async close() {
    await Promise.allSettled([this.pub.quit(), this.sub.quit()])
  }
}

export const bus: Bus = config.REDIS_URL ? new RedisBus(config.REDIS_URL) : new LocalBus()
