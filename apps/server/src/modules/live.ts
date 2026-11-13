// Public live / TV page data (M-6) and the OG preview for shared links (R-20, T-8).

import { Router } from 'express'
import { config } from '../config.ts'
import { db } from '../db/index.ts'
import { handler, notFound } from '../http/errors.ts'
import { conductState } from '../tournaments/queue.ts'
import { structure } from './tournaments.ts'

export const liveRouter = Router()
export const ogRouter = Router()

const bySlug = (slug: string) =>
  db
    .selectFrom('tournaments')
    .selectAll()
    .where((eb) => (/^\d+$/.test(slug) ? eb('id', '=', Number(slug)) : eb('slug', '=', slug)))
    .where('status', '<>', 'draft')
    .executeTakeFirst()

liveRouter.get(
  '/:slug/live',
  handler(async (req, res) => {
    const t = await bySlug(String(req.params.slug))
    if (!t) throw notFound('tournament.not_found')
    const state = await conductState(t)
    const strip = <M extends { home: unknown; away: unknown }>(m: M) => {
      const side = (s: unknown) => {
        const x = s as { name: string; rating: number | null; calibrating: boolean; startLevel: number } | null
        return x ? { name: x.name, rating: x.rating, calibrating: x.calibrating, startLevel: x.startLevel } : null
      }
      return { ...m, home: side(m.home), away: side(m.away), callResponses: undefined, reportedScore: undefined }
    }
    res.json({
      id: t.id,
      slug: t.slug,
      title: t.title,
      status: t.status,
      startsAt: t.starts_at,
      tables: state.tables.map((x) => ({ ...x, match: x.match ? strip(x.match) : null })),
      next: state.queue.slice(0, 12).map(strip),
      recent: state.recent.slice(0, 8).map(strip),
      structure: await structure(t),
    })
  }),
)

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

const ogPage = (url: string, title: string, description: string, image?: string | null) => `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>${title}</title>
<meta property="og:type" content="website"><meta property="og:title" content="${title}"><meta property="og:description" content="${description}">
<meta property="og:url" content="${escape(url)}">${image ? `<meta property="og:image" content="${escape(image)}">` : ''}
<meta name="twitter:card" content="summary"><meta http-equiv="refresh" content="0;url=${escape(url)}"></head>
<body><a href="${escape(url)}">${title}</a></body></html>`

async function tournamentOg(slug: string) {
  const t = await bySlug(slug)
  if (!t) throw notFound('tournament.not_found')
  const hall = await db.selectFrom('halls').select(['name', 'address', 'timezone']).where('id', '=', t.hall_id).executeTakeFirstOrThrow()
  const when = new Intl.DateTimeFormat('ru-RU', { timeZone: hall.timezone, day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).format(t.starts_at)
  return ogPage(`${config.SITE_URL}/t/${t.slug}`, escape(t.title), escape(`${when} · ${hall.name}, ${hall.address}${t.fee ? ` · взнос ${Math.round(t.fee / 100)} ₸` : ''}`), t.cover_url)
}

/** Short share codes (R-20): `t<id36>` → tournament, `l<id36>` → league. */
export const shortCode = (kind: 't' | 'l', id: number) => `${kind}${id.toString(36)}`

async function resolveShort(code: string) {
  const m = /^([tl])([0-9a-z]{1,10})$/.exec(code)
  const id = m ? parseInt(m[2]!, 36) : NaN
  if (m?.[1] === 't') {
    const t = await bySlug(String(id))
    if (t) return { kind: 'tournament' as const, slug: t.slug, path: `/t/${t.slug}` }
  }
  if (m?.[1] === 'l') {
    const l = await db.selectFrom('leagues as l').innerJoin('clubs as c', 'c.id', 'l.club_id').select(['l.slug', 'l.name', 'l.description', 'c.name as club']).where('l.id', '=', id).executeTakeFirst()
    if (l) return { kind: 'league' as const, slug: l.slug, path: `/leagues/${l.slug}`, league: l }
  }
  throw notFound('link.not_found')
}

export const shortRouter = Router()

shortRouter.get(
  '/:code',
  handler(async (req, res) => {
    const r = await resolveShort(String(req.params.code))
    res.json({ kind: r.kind, slug: r.slug, path: r.path })
  }),
)

/** HTML with Open Graph tags for crawlers (nginx sends bot user agents for /t/:slug and /s/:code here); people are redirected to the SPA. */
ogRouter.get(
  '/t/:slug',
  handler(async (req, res) => {
    res.type('html').send(await tournamentOg(String(req.params.slug)))
  }),
)

ogRouter.get(
  '/s/:code',
  handler(async (req, res) => {
    const r = await resolveShort(String(req.params.code))
    if (r.kind === 'tournament') {
      res.type('html').send(await tournamentOg(r.slug))
      return
    }
    res.type('html').send(ogPage(`${config.SITE_URL}${r.path}`, escape(r.league.name), escape([r.league.club, r.league.description].filter(Boolean).join(' · '))))
  }),
)
