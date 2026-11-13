// Platform admin «Турниры»: every tournament of every club, lifecycle moves (forward and back) with reasons,
// participants, draw, matches, settings, rating and history. Reuses the club services; every change is audited.

import { Router } from 'express'
import type { Request } from 'express'
import { sql } from 'kysely'
import { z } from 'zod'
import { assertTransition, canTransition, ENTRY_OCCUPYING, entryStatus, tournamentStatus } from '@nomad/shared'
import type { EntryStatus, TournamentStatus } from '@nomad/shared'
import { audit } from '../audit.ts'
import { requirePlatformAdmin } from '../auth/access.ts'
import { db } from '../db/index.ts'
import type { Tournament } from '../db/types.ts'
import { badRequest, conflict, handler, notFound } from '../http/errors.ts'
import { intParam, isoDate, parseBody, parseQuery } from '../http/validate.ts'
import { notify } from '../notify/index.ts'
import { sendCallCancelled } from '../notify/match.ts'
import { recalcStatus, requestRecalc } from '../rating/recalc.ts'
import { isRatingTournament, recalculateFrom } from '../rating/service.ts'
import { bus } from '../realtime/bus.ts'
import { busyElsewhere } from '../tournaments/busy.ts'
import { completeStage, finishTournament, recordResult, replaceEntryPlayer, startTournament, withdrawEntry } from '../tournaments/structure.ts'
import { playerName } from './players.ts'
import { cancelTournament, updateSchema, updateTournament } from './tournament-admin.ts'
import { publishTournament, registerPlayer, structure } from './tournaments.ts'

export const adminTournamentsRouter = Router()

const reason = z.string().trim().min(3).max(500)
const PLAYED = ['finished', 'walkover', 'retired'] as const
const CONFIRMED: EntryStatus[] = ['paid', 'checked_in', 'playing', 'completed', 'withdrew']
const PAGE = 50

async function load(id: number): Promise<Tournament> {
  const t = await db.selectFrom('tournaments').selectAll().where('id', '=', id).executeTakeFirst()
  if (!t) throw notFound('tournament.not_found')
  return t
}

async function admin(req: Request) {
  const user = requirePlatformAdmin(req)
  return { user, t: await load(intParam(req, 'id')) }
}

const changed = (id: number) => {
  bus.publish(`tournament:${id}`, 'tournament.updated', { tournamentId: id })
  bus.publish(`tournament:${id}`, 'match.updated', { tournamentId: id })
}

/** Players with an active entry get «Турнир изменён» with the change (Russian text) and the reason. */
async function notifyParticipants(t: Pick<Tournament, 'id' | 'slug' | 'title'>, text: string, why?: string | null, entryIds?: number[]) {
  let q = db
    .selectFrom('entries as e')
    .innerJoin('players as p', 'p.id', 'e.player_id')
    .select('p.user_id')
    .distinct()
    .where('e.tournament_id', '=', t.id)
    .where('p.user_id', 'is not', null)
    .where('e.status', 'in', [...ENTRY_OCCUPYING, 'waitlist', 'invited'])
  if (entryIds) q = q.where('e.id', 'in', entryIds.length ? entryIds : [0])
  for (const r of await q.execute()) {
    await notify({ userId: r.user_id!, type: 'tournament_changed', urgent: true, data: { tournamentId: t.id, slug: t.slug, title: t.title, text, reason: why ?? null } })
  }
}

// List

const listQuery = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.string().max(200).optional(),
  clubId: z.coerce.number().int().positive().optional(),
  city: z.string().max(60).optional(),
  type: z.enum(['singles', 'doubles', 'team']).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  test: z.enum(['0', '1']).optional(),
  archived: z.enum(['0', '1']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  format: z.enum(['json', 'csv']).default('json'),
})
type ListQuery = z.infer<typeof listQuery>

function filtered(q: ListQuery) {
  let b = db.selectFrom('tournaments as t').innerJoin('clubs as c', 'c.id', 't.club_id').innerJoin('cities as ci', 'ci.id', 'c.city_id')
  if (q.status) b = b.where('t.status', 'in', q.status.split(',') as TournamentStatus[])
  if (q.clubId) b = b.where('t.club_id', '=', q.clubId)
  if (q.city) b = b.where('ci.slug', '=', q.city)
  if (q.type) b = b.where('t.type', '=', q.type)
  if (q.from) b = b.where('t.starts_at', '>=', new Date(`${q.from}T00:00:00+05:00`))
  if (q.to) b = b.where('t.starts_at', '<', new Date(new Date(`${q.to}T00:00:00+05:00`).getTime() + 86400_000))
  if (q.test) b = b.where('t.is_test', '=', q.test === '1')
  if (q.archived) b = b.where('t.archived_at', q.archived === '1' ? 'is not' : 'is', null)
  if (q.q) {
    const like = `%${q.q}%`
    const asId = /^\d+$/.test(q.q) ? Number(q.q) : 0
    b = b.where((eb) => eb.or([eb('t.title', 'ilike', like), eb('c.name', 'ilike', like), eb('t.id', '=', asId)]))
  }
  return b
}

const count = (where: string) => sql<number>`(select count(*)::int from entries e where e.tournament_id = t.id and ${sql.raw(where)})`

const csvCell = (v: unknown) => {
  const s = v == null ? '' : v instanceof Date ? v.toISOString() : String(v)
  return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

adminTournamentsRouter.get(
  '/',
  handler(async (req, res) => {
    requirePlatformAdmin(req)
    const q = parseQuery(listQuery, req)
    const quoted = (xs: readonly string[]) => xs.map((x) => `'${x}'`).join(',')
    let rows = filtered(q)
      .select([
        't.id',
        't.slug',
        't.title',
        't.type',
        't.status',
        't.starts_at',
        't.estimated_end_at',
        't.max_participants',
        't.is_test',
        't.archived_at',
        't.postponed_at',
        'c.id as club_id',
        'c.name as club',
        'ci.name_ru as city',
        count(`e.status in (${quoted(CONFIRMED)})`).as('confirmed'),
        count(`e.status in (${quoted(ENTRY_OCCUPYING)})`).as('taken'),
        count(`e.status = 'waitlist'`).as('waitlist'),
        sql<number>`(select count(*)::int from matches m where m.tournament_id = t.id and m.result_type is distinct from 'bye')`.as('matches_total'),
        sql<number>`(select count(*)::int from matches m where m.tournament_id = t.id and m.status in ('finished', 'walkover', 'retired') and m.result_type is distinct from 'bye')`.as('matches_played'),
      ])
      .orderBy('t.starts_at', 'desc')
      .orderBy('t.id', 'desc')
    if (q.format === 'json') rows = rows.limit(PAGE).offset((q.page - 1) * PAGE)
    const items = await rows.execute()
    if (q.format === 'csv') {
      const head = ['id', 'title', 'club', 'city', 'type', 'status', 'starts_at', 'confirmed', 'taken', 'limit', 'waitlist', 'matches_played', 'matches_total', 'test', 'archived']
      const body = items.map((r) =>
        [r.id, r.title, r.club, r.city, r.type, r.status, r.starts_at, r.confirmed, r.taken, r.max_participants, r.waitlist, r.matches_played, r.matches_total, r.is_test ? 1 : 0, r.archived_at ? 1 : 0].map(csvCell).join(','),
      )
      res.type('text/csv; charset=utf-8').set('Content-Disposition', 'attachment; filename="tournaments.csv"').send(String.fromCharCode(0xfeff) + `${[head.join(','), ...body].join('\r\n')}`)
      return
    }
    const total = await filtered(q)
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .executeTakeFirstOrThrow()
    const clubs = await db.selectFrom('clubs').select(['id', 'name']).orderBy('name').execute()
    const cities = await db.selectFrom('cities').select(['slug', 'name_ru as name']).orderBy('name_ru').execute()
    res.json({ items, total: Number(total.n), page: q.page, pageSize: PAGE, clubs, cities })
  }),
)

// Card

type Action = { key: string; allowed: boolean; blocker?: string; reason: boolean; danger?: boolean; confirm?: boolean }

async function counts(t: Tournament) {
  const e = await db
    .selectFrom('entries')
    .select(['status', (eb) => eb.fn.countAll<number>().as('n')])
    .where('tournament_id', '=', t.id)
    .groupBy('status')
    .execute()
  const by = (xs: readonly string[]) => e.filter((r) => xs.includes(r.status)).reduce((s, r) => s + Number(r.n), 0)
  const m = await db
    .selectFrom('matches')
    .select([
      (eb) => eb.fn.countAll<number>().as('total'),
      sql<number>`count(*) filter (where status in ('finished', 'walkover', 'retired'))`.as('played'),
      sql<number>`count(*) filter (where status in ('called', 'playing') and table_id is null)`.as('no_table'),
      sql<number>`count(*) filter (where status in ('waiting', 'scheduled', 'called', 'playing'))`.as('open'),
      sql<number>`count(*) filter (where disputed)`.as('disputed'),
    ])
    .where('tournament_id', '=', t.id)
    .where('result_type', 'is distinct from', 'bye')
    .executeTakeFirstOrThrow()
  const disputes = await db.selectFrom('disputes').select((eb) => eb.fn.countAll<number>().as('n')).where('tournament_id', '=', t.id).where('status', '=', 'open').executeTakeFirstOrThrow()
  return {
    registered: by(ENTRY_OCCUPYING),
    confirmed: by(CONFIRMED),
    awaitingPayment: by(['awaiting_payment']),
    paidOrCheckedIn: by(['paid', 'checked_in']),
    waitlist: by(['waitlist', 'invited']),
    checkedIn: by(['checked_in', 'playing', 'completed']),
    limit: t.max_participants,
    matchesPlayed: Number(m.played),
    matchesTotal: Number(m.total),
    matchesOpen: Number(m.open),
    matchesNoTable: Number(m.no_table),
    disputes: Number(disputes.n) + Number(m.disputed),
  }
}

async function actions(t: Tournament, c: Awaited<ReturnType<typeof counts>>, hasAddress: boolean, clubActive: boolean): Promise<Action[]> {
  const s = t.status
  const can = (to: TournamentStatus) => canTransition(tournamentStatus, s, to)
  const not = (status: boolean, blocker: string) => (status ? undefined : blocker)
  const notStarted = s === 'published' || s === 'registration_closed'
  const present = t.settings.requireCheckin ? c.checkedIn : c.paidOrCheckedIn
  const list: (Omit<Action, 'allowed'> & { when: boolean })[] = [
    { key: 'publish', when: can('published') && s === 'draft', reason: false, blocker: not(clubActive, 'club.not_verified') ?? not(hasAddress && t.table_ids.length > 0, 'club.address_and_tables_required') },
    { key: 'close', when: s === 'published', reason: false },
    { key: 'start', when: notStarted, reason: false, blocker: t.postponed_at ? 'adminT.postponed' : not(present >= Math.max(2, t.min_participants), 'tournament.too_few_players') },
    { key: 'finish', when: s === 'running', reason: false, blocker: not(c.matchesOpen === 0, 'tournament.matches_not_finished') },
    { key: 'reopen', when: s === 'registration_closed', reason: true },
    { key: 'unpublish', when: notStarted, reason: true, confirm: c.paidOrCheckedIn > 0 },
    { key: 'unfinish', when: s === 'finished' || s === 'finished_early', reason: true, danger: true },
    { key: 'postpone', when: notStarted && !t.postponed_at, reason: true },
    { key: 'resume', when: notStarted && Boolean(t.postponed_at), reason: false },
    { key: 'cancel', when: can('cancelled'), reason: true, danger: true },
    { key: 'archive', when: !t.archived_at, reason: false, blocker: not(s !== 'running', 'adminT.running') },
    { key: 'unarchive', when: Boolean(t.archived_at), reason: false },
    { key: 'delete', when: true, reason: true, danger: true, blocker: not(s === 'draft' || t.is_test, 'adminT.deleteOnlyDraft') },
  ]
  return list.filter((a) => a.when).map(({ when: _, ...a }) => ({ ...a, allowed: !a.blocker }))
}

adminTournamentsRouter.get(
  '/:id',
  handler(async (req, res) => {
    const { t } = await admin(req)
    const club = await db.selectFrom('clubs').select(['id', 'name', 'slug', 'status']).where('id', '=', t.club_id).executeTakeFirstOrThrow()
    const hall = await db.selectFrom('halls').select(['id', 'name', 'address']).where('id', '=', t.hall_id).executeTakeFirstOrThrow()
    const tables = await db.selectFrom('hall_tables').select(['id', 'number', 'status']).where('hall_id', '=', t.hall_id).orderBy('number').execute()
    const c = await counts(t)
    const busy = ['published', 'registration_closed', 'running'].includes(t.status) ? Object.keys(await busyElsewhere(t.id)).length : 0
    const notStarted = t.status === 'published' || t.status === 'registration_closed'
    const problems = [
      !hall.address && 'no_address',
      !t.table_ids.length && 'no_tables',
      notStarted && t.settings.requireCheckin && c.registered - c.checkedIn > 0 && 'not_checked_in',
      t.status === 'running' && c.matchesOpen > 0 && 'unfinished_matches',
      c.matchesNoTable > 0 && 'no_table_matches',
      c.disputes > 0 && 'open_disputes',
      busy > 0 && 'players_busy',
      t.postponed_at && 'postponed',
    ].filter((x): x is string => Boolean(x))
    res.json({
      tournament: {
        id: t.id,
        slug: t.slug,
        title: t.title,
        type: t.type,
        status: t.status,
        startsAt: t.starts_at,
        estimatedEndAt: t.estimated_end_at,
        registrationClosesAt: t.registration_closes_at,
        maxParticipants: t.max_participants,
        minParticipants: t.min_participants,
        fee: t.fee,
        description: t.description,
        prizes: t.prizes,
        commentForPlayers: t.comment_for_players,
        staffComment: t.staff_comment,
        isRated: t.is_rated,
        ratingCoefficient: Number(t.rating_coefficient),
        isTest: t.is_test,
        archivedAt: t.archived_at,
        postponedAt: t.postponed_at,
        postponedReason: t.postponed_reason,
        cancelledReason: t.cancelled_reason,
        tableIds: t.table_ids,
        format: t.format,
        settings: t.settings,
      },
      club,
      hall,
      tables,
      counts: { ...c, busy },
      problems,
      actions: await actions(t, c, Boolean(hall.address), club.status === 'active'),
    })
  }),
)

// Lifecycle

const actionBody = z
  .object({ reason: reason.optional(), startsAt: z.iso.datetime({ offset: true }).optional(), confirm: z.boolean().optional(), order: z.array(z.number().int()).max(256).optional() })
  .default({})

const NEEDS_REASON = new Set(['reopen', 'unpublish', 'unfinish', 'postpone', 'cancel', 'delete'])

adminTournamentsRouter.post(
  '/:id/actions/:action',
  handler(async (req, res) => {
    const { user, t } = await admin(req)
    const action = String(req.params.action)
    const body = parseBody(actionBody, req)
    if (NEEDS_REASON.has(action) && !body.reason) throw badRequest('adminT.reason_required')
    const why = body.reason ?? null
    const log = (after: unknown, trx?: Parameters<typeof audit>[1]) =>
      audit({ actorUserId: user.id, clubId: t.club_id, entity: 'tournament', entityId: t.id, action: `admin.${action}`, reason: why, before: { status: t.status, startsAt: t.starts_at }, after }, trx)
    let result: unknown = { ok: true }
    switch (action) {
      case 'publish':
        result = await db.transaction().execute(async (trx) => {
          const r = await publishTournament(trx, t.id, user.id)
          await log({ status: 'published' }, trx)
          return r
        })
        break
      case 'close':
      case 'reopen': {
        const to = action === 'close' ? 'registration_closed' : 'published'
        assertTransition('tournament', tournamentStatus, t.status, to)
        await db.transaction().execute(async (trx) => {
          await trx.updateTable('tournaments').set({ status: to }).where('id', '=', t.id).execute()
          await log({ status: to }, trx)
        })
        if (action === 'reopen') await notifyParticipants(t, 'Запись на турнир снова открыта', why)
        break
      }
      case 'start':
        if (t.postponed_at) throw conflict('adminT.postponed')
        await db.transaction().execute(async (trx) => {
          if (t.status === 'published') await trx.updateTable('tournaments').set({ status: 'registration_closed' }).where('id', '=', t.id).execute()
          await startTournament(trx, t.id, user.id, new Date(), { order: body.order })
          await log({ status: 'running' }, trx)
        })
        bus.publish(`tournament:${t.id}`, 'tournament.started', { tournamentId: t.id })
        break
      case 'finish': {
        const reopened = await db.selectFrom('audit_log').select('id').where('entity', '=', 'tournament').where('entity_id', '=', String(t.id)).where('action', '=', 'admin.unfinish').executeTakeFirst()
        await db.transaction().execute(async (trx) => {
          await finishTournament(trx, t.id, user.id)
          await log({ status: 'finished' }, trx)
        })
        // A tournament returned for corrections was rated again at its new finish: later tournaments are replayed.
        if (reopened) await requestRecalc(t.id)
        bus.publish(`tournament:${t.id}`, 'tournament.finished', { tournamentId: t.id })
        break
      }
      case 'unfinish':
        if (t.status !== 'finished' && t.status !== 'finished_early') throw conflict('status.transition_not_allowed')
        result = await db.transaction().execute(async (trx) => {
          await trx.selectFrom('tournaments').select('id').where('id', '=', t.id).forUpdate().execute()
          const replay = await recalculateFrom(trx, t.id, { skip: t.id })
          await trx.updateTable('tournaments').set({ status: 'running', finished_at: null }).where('id', '=', t.id).execute()
          await trx.updateTable('entries').set({ status: 'playing', final_place: null, final_place_to: null, updated_at: new Date() }).where('tournament_id', '=', t.id).where('status', '=', 'completed').execute()
          await log({ status: 'running', replay }, trx)
          return { ok: true, replay }
        })
        await notifyParticipants(t, 'Турнир возвращён в игру для исправлений, итоги и рейтинг будут пересчитаны', why)
        break
      case 'unpublish': {
        if (t.status !== 'published' && t.status !== 'registration_closed') throw conflict('status.transition_not_allowed')
        const c = await counts(t)
        if (c.paidOrCheckedIn > 0 && !body.confirm) throw conflict('adminT.needs_confirm', { paid: c.paidOrCheckedIn })
        await db.transaction().execute(async (trx) => {
          await trx.updateTable('tournaments').set({ status: 'draft', published_at: null }).where('id', '=', t.id).execute()
          await trx.deleteFrom('table_blocks').where('tournament_id', '=', t.id).execute()
          await log({ status: 'draft' }, trx)
        })
        await notifyParticipants(t, 'Турнир снят с публикации', why)
        bus.publish(`hall:${t.hall_id}`, 'hall.availability_changed', { hallId: t.hall_id })
        break
      }
      case 'postpone': {
        if (t.status !== 'published' && t.status !== 'registration_closed') throw conflict('status.transition_not_allowed')
        if (!body.startsAt) throw badRequest('adminT.date_required')
        const start = new Date(body.startsAt)
        const shift = start.getTime() - t.starts_at.getTime()
        const end = new Date(t.estimated_end_at.getTime() + shift)
        await db.transaction().execute(async (trx) => {
          await trx
            .updateTable('tournaments')
            .set({
              starts_at: start,
              estimated_end_at: end,
              registration_closes_at: t.registration_closes_at ? new Date(Math.min(t.registration_closes_at.getTime() + shift, start.getTime())) : null,
              postponed_at: new Date(),
              postponed_reason: why,
            })
            .where('id', '=', t.id)
            .execute()
          await trx.updateTable('table_blocks').set({ starts_at: start, ends_at: end }).where('tournament_id', '=', t.id).execute()
          await log({ startsAt: start, postponed: true }, trx)
        })
        await notifyParticipants(t, `Турнир перенесён на ${start.toLocaleString('ru-RU', { timeZone: 'Asia/Almaty', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}`, why)
        bus.publish(`hall:${t.hall_id}`, 'hall.availability_changed', { hallId: t.hall_id })
        break
      }
      case 'resume':
        if (!t.postponed_at) throw conflict('status.transition_not_allowed')
        await db.transaction().execute(async (trx) => {
          await trx.updateTable('tournaments').set({ postponed_at: null, postponed_reason: null }).where('id', '=', t.id).execute()
          await log({ postponed: false }, trx)
        })
        await notifyParticipants(t, `Турнир состоится ${t.starts_at.toLocaleString('ru-RU', { timeZone: 'Asia/Almaty', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`, why)
        break
      case 'cancel':
        await cancelTournament(t.id, user.id, why!)
        await log({ status: 'cancelled' })
        break
      case 'archive':
      case 'unarchive':
        if (action === 'archive' && t.status === 'running') throw conflict('adminT.running')
        await db.updateTable('tournaments').set({ archived_at: action === 'archive' ? new Date() : null }).where('id', '=', t.id).execute()
        await log({ archived: action === 'archive' })
        break
      case 'test':
      case 'untest':
        await db.updateTable('tournaments').set({ is_test: action === 'test' }).where('id', '=', t.id).execute()
        await log({ isTest: action === 'test' })
        break
      default:
        throw notFound('adminT.unknown_action')
    }
    changed(t.id)
    res.json(result)
  }),
)

adminTournamentsRouter.delete(
  '/:id',
  handler(async (req, res) => {
    const { user, t } = await admin(req)
    const { reason: why } = parseBody(z.object({ reason }), req)
    if (t.status !== 'draft' && !t.is_test) throw conflict('adminT.deleteOnlyDraft')
    await db.transaction().execute(async (trx) => {
      await trx.deleteFrom('matches').where('tournament_id', '=', t.id).execute()
      await trx.deleteFrom('tournaments').where('id', '=', t.id).execute()
      await audit({ actorUserId: user.id, clubId: t.club_id, entity: 'tournament', entityId: t.id, action: 'admin.delete', reason: why, before: { title: t.title, status: t.status, startsAt: t.starts_at, isTest: t.is_test } }, trx)
    })
    bus.publish(`hall:${t.hall_id}`, 'hall.availability_changed', { hallId: t.hall_id })
    res.json({ ok: true })
  }),
)

// Participants

adminTournamentsRouter.get(
  '/:id/entries',
  handler(async (req, res) => {
    const { t } = await admin(req)
    const rows = await db
      .selectFrom('entries as e')
      .innerJoin('players as p', 'p.id', 'e.player_id')
      .leftJoin('teams as tm', 'tm.id', 'e.team_id')
      .leftJoin('payments as pay', 'pay.id', 'e.payment_id')
      .leftJoin('player_ratings as r', (j) => j.onRef('r.player_id', '=', 'p.id').on('r.kind', '=', 'singles'))
      .select(['e.id', 'e.status', 'e.waitlist_position', 'e.seed', 'e.final_place', 'e.checked_in_at', 'e.created_at', 'p.id as player_id', 'p.first_name', 'p.last_name', 'tm.name as team', 'r.rating', 'pay.method as payment_method', 'pay.status as payment_status'])
      .where('e.tournament_id', '=', t.id)
      .orderBy('e.created_at')
      .execute()
    res.json(rows.map(({ first_name, last_name, ...r }) => ({ ...r, name: r.team ?? playerName({ first_name, last_name }) })))
  }),
)

adminTournamentsRouter.post(
  '/:id/entries',
  handler(async (req, res) => {
    const { user, t } = await admin(req)
    const { playerId, reason: why } = parseBody(z.object({ playerId: z.number().int().positive(), reason: reason.optional() }), req)
    const r = await db.transaction().execute(async (trx) => {
      const r = await registerPlayer(trx, t.id, playerId, user.id, { byClub: true })
      await audit({ actorUserId: user.id, clubId: t.club_id, entity: 'entry', entityId: r.entryId, action: 'admin.add', reason: why, after: { playerId, status: r.status } }, trx)
      return r
    })
    bus.publish(`tournament:${t.id}`, 'tournament.entries_changed', { tournamentId: t.id })
    res.status(201).json(r)
  }),
)

type Trx = Parameters<Parameters<ReturnType<typeof db.transaction>['execute']>[0]>[0]

/** Admin override of an entry status (no state-machine check); a running withdrawal goes through withdrawEntry. */
async function setEntryStatus(trx: Trx, t: Tournament, entryId: number, to: EntryStatus, why: string, actorUserId: number) {
  const e = await trx.selectFrom('entries').selectAll().where('id', '=', entryId).forUpdate().executeTakeFirst()
  if (!e || e.tournament_id !== t.id) throw notFound('entry.not_found')
  if (e.status === to) return
  if (t.status === 'running' && e.status === 'playing') {
    if (to === 'withdrew' || to === 'removed_by_club') return withdrawEntry(trx, entryId, actorUserId, why)
    throw conflict('adminT.entry_playing')
  }
  let waitlist: number | null = null
  if (to === 'waitlist') {
    const last = await trx.selectFrom('entries').select((eb) => eb.fn.max<number>('waitlist_position').as('p')).where('tournament_id', '=', t.id).executeTakeFirst()
    waitlist = (last?.p ?? 0) + 1
  }
  await trx
    .updateTable('entries')
    .set({ status: to, waitlist_position: waitlist, hold_until: null, checked_in_at: to === 'checked_in' ? (e.checked_in_at ?? new Date()) : e.checked_in_at, updated_at: new Date() })
    .where('id', '=', entryId)
    .execute()
  // Online payments are off: confirming an at-club payment marks it collected.
  if ((to === 'paid' || to === 'checked_in') && e.payment_id)
    await trx.updateTable('payments').set({ status: 'succeeded', updated_at: new Date() }).where('id', '=', e.payment_id).where('method', '=', 'at_club').where('status', '=', 'created').execute()
  await audit({ actorUserId, clubId: t.club_id, entity: 'entry', entityId: entryId, action: 'admin.status', reason: why, before: { status: e.status }, after: { status: to } }, trx)
}

const STATUS_TEXT: Partial<Record<EntryStatus, string>> = {
  paid: 'Ваша заявка подтверждена',
  waitlist: 'Ваша заявка перенесена в лист ожидания',
  removed_by_club: 'Ваша заявка снята с турнира',
  withdrew: 'Вы сняты с турнира',
}

adminTournamentsRouter.post(
  '/:id/entries/bulk',
  handler(async (req, res) => {
    const { user, t } = await admin(req)
    const body = parseBody(
      z.object({
        ids: z.array(z.number().int().positive()).min(1).max(256),
        status: z.enum(entryStatus.states as [EntryStatus, ...EntryStatus[]]),
        reason,
      }),
      req,
    )
    await db.transaction().execute(async (trx) => {
      for (const id of body.ids) await setEntryStatus(trx, t, id, body.status, body.reason, user.id)
    })
    const text = STATUS_TEXT[body.status]
    if (text) await notifyParticipants(t, text, body.reason, body.ids)
    changed(t.id)
    bus.publish(`tournament:${t.id}`, 'tournament.entries_changed', { tournamentId: t.id })
    res.json({ ok: true })
  }),
)

adminTournamentsRouter.post(
  '/:id/entries/:entryId/replace',
  handler(async (req, res) => {
    const { user, t } = await admin(req)
    const { playerId, reason: why } = parseBody(z.object({ playerId: z.number().int().positive(), reason }), req)
    const entryId = intParam(req, 'entryId')
    const e = await db.selectFrom('entries').select('tournament_id').where('id', '=', entryId).executeTakeFirst()
    if (e?.tournament_id !== t.id) throw notFound('entry.not_found')
    await db.transaction().execute((trx) => replaceEntryPlayer(trx, entryId, playerId, why, user.id))
    changed(t.id)
    res.json({ ok: true })
  }),
)

// Draw

adminTournamentsRouter.get(
  '/:id/structure',
  handler(async (req, res) => {
    const { t } = await admin(req)
    const played = await db.selectFrom('matches').select('id').where('tournament_id', '=', t.id).where('status', 'in', [...PLAYED, 'called', 'playing']).where('result_type', 'is distinct from', 'bye').executeTakeFirst()
    const seeds = await db
      .selectFrom('entries as e')
      .innerJoin('players as p', 'p.id', 'e.player_id')
      .leftJoin('teams as tm', 'tm.id', 'e.team_id')
      .select(['e.id', 'e.seed', 'e.rating_at_start', 'p.first_name', 'p.last_name', 'tm.name as team'])
      .where('e.tournament_id', '=', t.id)
      .where('e.seed', 'is not', null)
      .orderBy('e.seed')
      .execute()
    res.json({
      stages: await structure(t),
      locked: Boolean(played),
      seeds: seeds.map((s) => ({ entryId: s.id, seed: s.seed, rating: s.rating_at_start, name: s.team ?? playerName(s) })),
    })
  }),
)

/** Deterministic shuffle (mulberry32): the same seed always gives the same draw. */
export function seededShuffle<T>(items: readonly T[], seed: number): T[] {
  let a = seed >>> 0
  const rnd = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let x = Math.imul(a ^ (a >>> 15), 1 | a)
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296
  }
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[out[i], out[j]] = [out[j]!, out[i]!]
  }
  return out
}

adminTournamentsRouter.post(
  '/:id/redraw',
  handler(async (req, res) => {
    const { user, t } = await admin(req)
    const body = parseBody(
      z.object({ reason, mode: z.enum(['rating', 'random', 'manual']), seed: z.number().int().min(0).max(2 ** 31).optional(), swap: z.tuple([z.number().int(), z.number().int()]).optional() }),
      req,
    )
    if (t.status !== 'running') throw conflict('tournament.not_running')
    const seed = body.mode === 'random' ? (body.seed ?? Math.floor(Math.random() * 2 ** 31)) : null
    await db.transaction().execute(async (trx) => {
      await trx.selectFrom('tournaments').select('id').where('id', '=', t.id).forUpdate().execute()
      const played = await trx.selectFrom('matches').select('id').where('tournament_id', '=', t.id).where('status', 'in', [...PLAYED, 'called', 'playing']).where('result_type', 'is distinct from', 'bye').executeTakeFirst()
      if (played) throw conflict('adminT.results_exist')
      const seeded = await trx.selectFrom('entries').select(['id', 'seed']).where('tournament_id', '=', t.id).where('status', '=', 'playing').orderBy('seed').execute()
      let order: number[] | undefined
      if (seed != null) order = seededShuffle(seeded.map((e) => e.id).sort((a, b) => a - b), seed)
      if (body.mode === 'manual') {
        if (!body.swap) throw badRequest('adminT.swap_required')
        order = seeded.map((e) => e.id)
        const [i, j] = body.swap.map((id) => order!.indexOf(id))
        if (i == null || j == null || i < 0 || j < 0) throw badRequest('entry.not_found')
        ;[order[i], order[j]] = [order[j]!, order[i]!]
      }
      await trx.deleteFrom('matches').where('tournament_id', '=', t.id).execute()
      await trx.deleteFrom('stages').where('tournament_id', '=', t.id).execute()
      await trx.updateTable('entries').set({ status: 'checked_in', seed: null }).where('tournament_id', '=', t.id).where('status', '=', 'playing').execute()
      await trx.updateTable('tournaments').set({ status: 'registration_closed' }).where('id', '=', t.id).execute()
      await startTournament(trx, t.id, user.id, new Date(), { order })
      await audit({ actorUserId: user.id, clubId: t.club_id, entity: 'tournament', entityId: t.id, action: 'admin.redraw', reason: body.reason, after: { mode: body.mode, seed, swap: body.swap ?? null } }, trx)
    })
    await notifyParticipants(t, 'Жеребьёвка турнира проведена заново', body.reason)
    changed(t.id)
    res.json({ ok: true, seed })
  }),
)

// Matches

adminTournamentsRouter.get(
  '/:id/matches',
  handler(async (req, res) => {
    const { t } = await admin(req)
    const rows = await db
      .selectFrom('matches as m')
      .innerJoin('stages as s', 's.id', 'm.stage_id')
      .leftJoin('groups as g', 'g.id', 'm.group_id')
      .leftJoin('hall_tables as ht', 'ht.id', 'm.table_id')
      .leftJoin('entries as he', 'he.id', 'm.home_entry_id')
      .leftJoin('players as hp', 'hp.id', 'he.player_id')
      .leftJoin('teams as htm', 'htm.id', 'he.team_id')
      .leftJoin('entries as ae', 'ae.id', 'm.away_entry_id')
      .leftJoin('players as ap', 'ap.id', 'ae.player_id')
      .leftJoin('teams as atm', 'atm.id', 'ae.team_id')
      .select([
        'm.id',
        'm.number',
        'm.round',
        'm.stage_label',
        'm.status',
        'm.result_type',
        'm.sets_home',
        'm.sets_away',
        'm.games',
        'm.table_id',
        'ht.number as table_number',
        'm.scheduled_at',
        'm.called_at',
        'm.disputed',
        'm.home_entry_id',
        'm.away_entry_id',
        'm.winner_entry_id',
        's.stage_key',
        's.name as stage',
        's.kind as stage_kind',
        'g.code as group',
        sql<string | null>`coalesce(htm.name, hp.last_name || ' ' || hp.first_name)`.as('home'),
        sql<string | null>`coalesce(atm.name, ap.last_name || ' ' || ap.first_name)`.as('away'),
      ])
      .where('m.tournament_id', '=', t.id)
      .where('m.result_type', 'is distinct from', 'bye')
      .orderBy('m.number')
      .execute()
    res.json(rows)
  }),
)

async function matchOf(t: Tournament, matchId: number) {
  const m = await db.selectFrom('matches').selectAll().where('id', '=', matchId).executeTakeFirst()
  if (!m || m.tournament_id !== t.id) throw notFound('match.not_found')
  return m
}

adminTournamentsRouter.post(
  '/:id/matches/:matchId/annul',
  handler(async (req, res) => {
    const { user, t } = await admin(req)
    const { reason: why } = parseBody(z.object({ reason }), req)
    const m = await matchOf(t, intParam(req, 'matchId'))
    if (m.status !== 'scheduled' && m.status !== 'called') throw conflict('adminT.annul_unplayed_only')
    const stage = await db.selectFrom('stages').select(['id', 'kind']).where('id', '=', m.stage_id).executeTakeFirstOrThrow()
    if (stage.kind !== 'groups' && stage.kind !== 'round_robin') throw conflict('adminT.annul_bracket')
    await db.transaction().execute(async (trx) => {
      await trx.updateTable('matches').set({ status: 'annulled', is_rated: false, table_id: null, called_at: null, version: m.version + 1 }).where('id', '=', m.id).execute()
      await audit({ actorUserId: user.id, clubId: t.club_id, entity: 'match', entityId: m.id, action: 'admin.annul', reason: why, before: { status: m.status }, after: { status: 'annulled' } }, trx)
      const open = await trx.selectFrom('matches').select('id').where('stage_id', '=', m.stage_id).where('status', 'in', ['waiting', 'scheduled', 'called', 'playing']).executeTakeFirst()
      if (!open) await completeStage(trx, t.id, m.stage_id)
    })
    if (m.status === 'called') await sendCallCancelled(t, m)
    changed(t.id)
    res.json({ ok: true })
  }),
)

adminTournamentsRouter.post(
  '/:id/matches/:matchId/walkover',
  handler(async (req, res) => {
    const { user, t } = await admin(req)
    const { winner, reason: why } = parseBody(z.object({ winner: z.enum(['home', 'away']), reason }), req)
    const m = await matchOf(t, intParam(req, 'matchId'))
    if (!['scheduled', 'called', 'playing'].includes(m.status)) throw conflict('match.already_recorded')
    await db.transaction().execute(async (trx) => {
      await recordResult(trx, m.id, { setsHome: 0, setsAway: 0, resultType: 'walkover', winner }, user.id)
      await audit({ actorUserId: user.id, clubId: t.club_id, entity: 'match', entityId: m.id, action: 'admin.walkover', reason: why, before: { status: m.status }, after: { status: 'walkover', winner } }, trx)
    })
    changed(t.id)
    res.json({ ok: true })
  }),
)

adminTournamentsRouter.post(
  '/:id/matches/:matchId/schedule',
  handler(async (req, res) => {
    const { user, t } = await admin(req)
    const { scheduledAt, reason: why } = parseBody(z.object({ scheduledAt: z.iso.datetime({ offset: true }).nullable(), reason }), req)
    const m = await matchOf(t, intParam(req, 'matchId'))
    const at = scheduledAt ? new Date(scheduledAt) : null
    await db.updateTable('matches').set({ scheduled_at: at }).where('id', '=', m.id).execute()
    await audit({ actorUserId: user.id, clubId: t.club_id, entity: 'match', entityId: m.id, action: 'admin.schedule', reason: why, before: { scheduledAt: m.scheduled_at }, after: { scheduledAt: at } })
    const ids = [m.home_entry_id, m.away_entry_id].filter((x): x is number => x != null)
    if (at && ids.length)
      await notifyParticipants(t, `Матч №${m.number}: новое время ${at.toLocaleTimeString('ru-RU', { timeZone: 'Asia/Almaty', hour: '2-digit', minute: '2-digit' })}`, why, ids)
    changed(t.id)
    res.json({ ok: true })
  }),
)

// Settings

adminTournamentsRouter.patch(
  '/:id',
  handler(async (req, res) => {
    const { user, t } = await admin(req)
    const body = parseBody(updateSchema.extend({ reason: reason.optional() }), req)
    const { reason: why, ...patch } = body
    if (['draft', 'published', 'registration_closed'].includes(t.status)) {
      const result = await updateTournament(t.id, patch, user.id, why)
      if (t.status !== 'draft' && patch.startsAt && new Date(patch.startsAt).getTime() !== t.starts_at.getTime()) await notifyParticipants(t, 'Изменилось время начала турнира', why)
      changed(t.id)
      return void res.json(result)
    }
    // Started: texts and rating settings only (format of unplayed stages via the conduct format route), with a reason.
    if (!why) throw badRequest('adminT.reason_required')
    const set = {
      title: patch.title,
      description: patch.description,
      prizes: patch.prizes,
      comment_for_players: patch.commentForPlayers,
      staff_comment: patch.staffComment,
      cover_url: patch.coverUrl,
      rating_coefficient: patch.ratingCoefficient,
    }
    if (Object.values(set).every((v) => v === undefined)) throw badRequest('adminT.nothing_to_change')
    await db.transaction().execute(async (trx) => {
      await trx.updateTable('tournaments').set(set).where('id', '=', t.id).execute()
      await audit({ actorUserId: user.id, clubId: t.club_id, entity: 'tournament', entityId: t.id, action: 'admin.update', reason: why, before: { title: t.title, ratingCoefficient: t.rating_coefficient }, after: set }, trx)
    })
    if (patch.ratingCoefficient != null && (t.status === 'finished' || t.status === 'finished_early')) await requestRecalc(t.id)
    changed(t.id)
    res.json({ ok: true, status: t.status })
  }),
)

// Rating

adminTournamentsRouter.get(
  '/:id/rating',
  handler(async (req, res) => {
    const { t } = await admin(req)
    const events = await db.selectFrom('rating_events').select((eb) => eb.fn.countAll<number>().as('n')).where('tournament_id', '=', t.id).executeTakeFirstOrThrow()
    const effective = await db.transaction().execute((trx) => isRatingTournament(trx, t.id))
    res.json({ isRated: t.is_rated, effective, events: Number(events.n), finished: t.status === 'finished' || t.status === 'finished_early', recalc: await recalcStatus() })
  }),
)

adminTournamentsRouter.post(
  '/:id/rating',
  handler(async (req, res) => {
    const { user, t } = await admin(req)
    const body = parseBody(z.object({ action: z.enum(['recalc', 'include', 'exclude']), reason }), req)
    const finished = t.status === 'finished' || t.status === 'finished_early'
    if (body.action === 'recalc' && !finished) throw conflict('rating.tournament_not_finished')
    if (body.action !== 'recalc') await db.updateTable('tournaments').set({ is_rated: body.action === 'include' }).where('id', '=', t.id).execute()
    await audit({ actorUserId: user.id, clubId: t.club_id, entity: 'tournament', entityId: t.id, action: `admin.rating_${body.action}`, reason: body.reason, before: { isRated: t.is_rated }, after: { isRated: body.action === 'recalc' ? t.is_rated : body.action === 'include' } })
    if (finished) await requestRecalc(t.id)
    res.json({ ok: true, replay: finished })
  }),
)

// History

adminTournamentsRouter.get(
  '/:id/history',
  handler(async (req, res) => {
    const { t } = await admin(req)
    const { entity, action } = parseQuery(z.object({ entity: z.enum(['tournament', 'match', 'entry']).optional(), action: z.string().max(60).optional() }), req)
    const id = String(t.id)
    let q = db
      .selectFrom('audit_log as a')
      .leftJoin('users as u', 'u.id', 'a.actor_user_id')
      .select(['a.id', 'a.at', 'a.entity', 'a.entity_id', 'a.action', 'a.before', 'a.after', 'a.reason', 'u.email as actor', 'u.platform_role as actor_role'])
      .where((eb) =>
        eb.or([
          eb.and([eb('a.entity', '=', 'tournament'), eb('a.entity_id', '=', id)]),
          eb.and([eb('a.entity', '=', 'match'), eb('a.entity_id', 'in', eb.selectFrom('matches').select(sql<string>`id::text`.as('id')).where('tournament_id', '=', t.id))]),
          eb.and([eb('a.entity', '=', 'entry'), eb('a.entity_id', 'in', eb.selectFrom('entries').select(sql<string>`id::text`.as('id')).where('tournament_id', '=', t.id))]),
        ]),
      )
    if (entity) q = q.where('a.entity', '=', entity)
    if (action) q = q.where('a.action', 'ilike', `%${action}%`)
    res.json(await q.orderBy('a.at', 'desc').orderBy('a.id', 'desc').limit(500).execute())
  }),
)
