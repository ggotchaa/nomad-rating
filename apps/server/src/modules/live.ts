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
      const side = (s: unknown) => (s ? { name: (s as { name: string }).name, rating: (s as { rating: number | null }).rating } : null)
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

/** HTML with Open Graph tags for crawlers (nginx sends bot user agents for /t/:slug here); people are redirected to the SPA. */
ogRouter.get(
  '/t/:slug',
  handler(async (req, res) => {
    const t = await bySlug(String(req.params.slug))
    if (!t) throw notFound('tournament.not_found')
    const hall = await db.selectFrom('halls').select(['name', 'address', 'timezone']).where('id', '=', t.hall_id).executeTakeFirstOrThrow()
    const when = new Intl.DateTimeFormat('ru-RU', { timeZone: hall.timezone, day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).format(t.starts_at)
    const url = `${config.SITE_URL}/t/${t.slug}`
    const title = escape(t.title)
    const description = escape(`${when} · ${hall.name}, ${hall.address}${t.fee ? ` · взнос ${Math.round(t.fee / 100)} ₸` : ''}`)
    res.type('html').send(`<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>${title}</title>
<meta property="og:type" content="website"><meta property="og:title" content="${title}"><meta property="og:description" content="${description}">
<meta property="og:url" content="${escape(url)}">${t.cover_url ? `<meta property="og:image" content="${escape(t.cover_url)}">` : ''}
<meta name="twitter:card" content="summary"><meta http-equiv="refresh" content="0;url=${escape(url)}"></head>
<body><a href="${escape(url)}">${title}</a></body></html>`)
  }),
)
