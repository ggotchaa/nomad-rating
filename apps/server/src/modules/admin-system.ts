// Platform admin (4.8): platform settings, audit log with filters, «view as club» (read-only).

import { Router } from 'express'
import { z } from 'zod'
import { CLUB_RIGHTS, DEFAULT_COMMISSION, START_LEVELS } from '@nomad/shared'
import { DEFAULT_ELO } from '@nomad/engine'
import { audit } from '../audit.ts'
import { requirePlatformAdmin } from '../auth/access.ts'
import { db, json } from '../db/index.ts'
import { handler, notFound } from '../http/errors.ts'
import { intParam, isoDate, parseBody, parseQuery } from '../http/validate.ts'
import { setTemplateOverrides } from '../notify/text.ts'

export const adminSystemRouter = Router()
export const publicSettingsRouter = Router()

const text = z.string().max(2000)
const SETTINGS = {
  elo: z.object({
    kProvisional: z.number().int().min(1).max(100),
    provisionalMatches: z.number().int().min(0).max(100),
    kStandard: z.number().int().min(1).max(100),
    kHigh: z.number().int().min(1).max(100),
    highThreshold: z.number().int().min(100).max(4000),
    rttfProvisionalMatches: z.number().int().min(0).max(100),
    floor: z.number().int().min(0).max(1000),
    calibrationTournaments: z.number().int().min(1).max(10),
    calibrationFallback: z.number().int().min(0).max(500),
    rttfA: z.number().min(0).max(10),
    rttfB: z.number().min(-2000).max(2000),
  }),
  levels: z.record(z.enum(Object.keys(START_LEVELS) as [string, ...string[]]), z.number().int().min(100).max(3000)),
  commission: z.object({ percent: z.number().min(0).max(50), minimum: z.number().int().min(0).nullable() }),
  holds: z.object({ entryMinutes: z.number().int().min(5).max(120), waitlistMinutes: z.number().int().min(5).max(240), payoutHoldDays: z.number().int().min(0).max(60) }),
  notify_templates: z.record(z.string().max(60), z.object({ title: text.optional(), body: text.optional() })),
  texts: z.object({ ru: z.record(z.string().max(120), text), kk: z.record(z.string().max(120), text), en: z.record(z.string().max(120), text) }),
} as const
type SettingKey = keyof typeof SETTINGS

const DEFAULTS: Record<SettingKey, unknown> = {
  elo: DEFAULT_ELO,
  levels: START_LEVELS,
  commission: DEFAULT_COMMISSION,
  holds: { entryMinutes: 15, waitlistMinutes: 30, payoutHoldDays: 3 },
  notify_templates: {},
  texts: { ru: {}, kk: {}, en: {} },
}

async function readSettings() {
  const rows = await db.selectFrom('platform_settings').select(['key', 'value', 'updated_at']).where('key', 'in', Object.keys(SETTINGS)).execute()
  return Object.fromEntries((Object.keys(SETTINGS) as SettingKey[]).map((k) => [k, rows.find((r) => r.key === k)?.value ?? DEFAULTS[k]])) as Record<SettingKey, unknown>
}

/** Loads admin-edited notification templates into the renderer (server start and after every save). */
export async function loadTemplateOverrides(): Promise<void> {
  const row = await db.selectFrom('platform_settings').select('value').where('key', '=', 'notify_templates').executeTakeFirst()
  setTemplateOverrides((row?.value as Record<string, { title?: string; body?: string }>) ?? {})
}

adminSystemRouter.get(
  '/settings',
  handler(async (req, res) => {
    requirePlatformAdmin(req)
    res.json(await readSettings())
  }),
)

adminSystemRouter.put(
  '/settings/:key',
  handler(async (req, res) => {
    const admin = requirePlatformAdmin(req)
    const key = z.enum(Object.keys(SETTINGS) as [SettingKey, ...SettingKey[]]).parse(req.params.key)
    const value = parseBody(SETTINGS[key] as z.ZodType, req)
    const before = (await readSettings())[key]
    await db
      .insertInto('platform_settings')
      .values({ key, value: json(value) })
      .onConflict((oc) => oc.column('key').doUpdateSet({ value: json(value), updated_at: new Date() }))
      .execute()
    await audit({ actorUserId: admin.id, entity: 'platform_setting', entityId: key, action: 'update', before, after: value })
    if (key === 'notify_templates') await loadTemplateOverrides()
    res.json(value)
  }),
)

/** Text overrides in three languages for the web app (public, cached briefly by nginx). */
publicSettingsRouter.get(
  '/texts',
  handler(async (_req, res) => {
    const row = await db.selectFrom('platform_settings').select('value').where('key', '=', 'texts').executeTakeFirst()
    res.set('Cache-Control', 'public, max-age=60').json(row?.value ?? DEFAULTS.texts)
  }),
)

adminSystemRouter.get(
  '/audit',
  handler(async (req, res) => {
    requirePlatformAdmin(req)
    const q = parseQuery(
      z.object({
        entity: z.string().max(40).optional(),
        action: z.string().max(40).optional(),
        actor: z.string().max(120).optional(),
        clubId: z.coerce.number().int().positive().optional(),
        entityId: z.string().max(40).optional(),
        from: isoDate.optional(),
        to: isoDate.optional(),
        before: z.coerce.number().int().positive().optional(),
        limit: z.coerce.number().int().min(1).max(200).default(50),
      }),
      req,
    )
    const rows = await db
      .selectFrom('audit_log as a')
      .leftJoin('users as u', 'u.id', 'a.actor_user_id')
      .leftJoin('clubs as c', 'c.id', 'a.club_id')
      .select(['a.id', 'a.at', 'a.entity', 'a.entity_id', 'a.action', 'a.before', 'a.after', 'a.reason', 'a.club_id', 'c.name as club', 'u.email as actor'])
      .$if(q.entity != null, (b) => b.where('a.entity', '=', q.entity!))
      .$if(q.action != null, (b) => b.where('a.action', '=', q.action!))
      .$if(q.entityId != null, (b) => b.where('a.entity_id', '=', q.entityId!))
      .$if(q.clubId != null, (b) => b.where('a.club_id', '=', q.clubId!))
      .$if(q.actor != null, (b) => b.where('u.email', 'ilike', `%${q.actor!}%`))
      .$if(q.from != null, (b) => b.where('a.at', '>=', new Date(`${q.from}T00:00:00Z`)))
      .$if(q.to != null, (b) => b.where('a.at', '<', new Date(new Date(`${q.to}T00:00:00Z`).getTime() + 86400000)))
      .$if(q.before != null, (b) => b.where('a.id', '<', q.before!))
      .orderBy('a.id', 'desc')
      .limit(q.limit)
      .execute()
    res.json(rows)
  }),
)

/** Club cabinet for the admin in read-only mode: same shape as /my/clubs, writes stay forbidden on the server. */
adminSystemRouter.get(
  '/clubs/:id/view',
  handler(async (req, res) => {
    const admin = requirePlatformAdmin(req)
    const id = intParam(req, 'id')
    const club = await db.selectFrom('clubs').select(['id', 'slug', 'name', 'status']).where('id', '=', id).executeTakeFirst()
    if (!club) throw notFound('club.not_found')
    const halls = await db.selectFrom('halls').select(['id', 'name']).where('club_id', '=', id).execute()
    await audit({ actorUserId: admin.id, clubId: id, entity: 'club', entityId: id, action: 'view_as' })
    res.json({ ...club, role: 'organizer', rights: [...CLUB_RIGHTS], scope: null, halls, readOnly: true })
  }),
)

adminSystemRouter.get(
  '/clubs/all',
  handler(async (req, res) => {
    requirePlatformAdmin(req)
    const { q } = parseQuery(z.object({ q: z.string().trim().max(100).default('') }), req)
    res.json(await db.selectFrom('clubs').select(['id', 'slug', 'name', 'status']).$if(q !== '', (b) => b.where('name', 'ilike', `%${q}%`)).orderBy('name').limit(100).execute())
  }),
)
