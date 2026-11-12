// Liveness / readiness probes and the OpenAPI document (`/api/docs`).

import { readFileSync } from 'node:fs'
import { Router } from 'express'
import { Redis } from 'ioredis'
import { sql } from 'kysely'
import { config } from '../config.ts'
import { db } from '../db/index.ts'

export const opsRouter = Router()

opsRouter.get('/live', (_req, res) => void res.json({ ok: true }))

opsRouter.get('/ready', async (_req, res) => {
  const checks: Record<string, boolean> = {}
  try {
    await sql`select 1`.execute(db)
    checks.db = true
  } catch {
    checks.db = false
  }
  if (config.REDIS_URL) {
    const redis = new Redis(config.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1, connectTimeout: 2000 })
    try {
      await redis.connect()
      checks.redis = (await redis.ping()) === 'PONG'
    } catch {
      checks.redis = false
    } finally {
      redis.disconnect()
    }
  }
  const ok = Object.values(checks).every(Boolean)
  res.status(ok ? 200 : 503).json({ ok, checks })
})

let spec: string | null = null
const openapi = () => (spec ??= readFileSync(new URL('../../openapi.yaml', import.meta.url), 'utf8'))

opsRouter.get('/docs/openapi.yaml', (_req, res) => void res.type('application/yaml').set('Cache-Control', 'public, max-age=300').send(openapi()))

opsRouter.get('/docs', (_req, res) => {
  res
    .set('Content-Security-Policy', "default-src 'none'; script-src https://cdn.jsdelivr.net; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src data: https:; connect-src 'self'; worker-src blob:")
    .type('html')
    .send('<!doctype html><html><head><meta charset="utf-8"><title>Nomad API</title><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><redoc spec-url="/api/docs/openapi.yaml"></redoc><script src="https://cdn.jsdelivr.net/npm/redoc@2.1.5/bundles/redoc.standalone.js"></script></body></html>')
})
