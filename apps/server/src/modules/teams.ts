// Pairs and teams API (4.11): my teams, player search for invitations, link joins, team entries,
// team meetings (line-ups, per-game calls and results).

import { Router } from 'express'
import type { Request } from 'express'
import { z } from 'zod'
import { searchWords } from '@nomad/shared'
import { db } from '../db/index.ts'
import type { Tournament } from '../db/types.ts'
import { requireClubRight, requireUser } from '../auth/access.ts'
import { clubAccess } from '../auth/access.ts'
import { forbidden, handler, notFound } from '../http/errors.ts'
import { intParam, parseBody, parseQuery } from '../http/validate.ts'
import { bus } from '../realtime/bus.ts'
import { config } from '../config.ts'
import { answerInvitation, createTeam, invite, joinByLink, registerTeam, removeMember, repeatTeam } from '../teams/service.ts'
import { callGame, captainSide, loadMeeting, meetingView, recordGame, submitLineup } from '../teams/meeting.ts'
import { playerName } from './players.ts'

export const teamsRouter = Router()
export const teamEntriesRouter = Router()

function me(req: Request) {
  const user = requireUser(req)
  if (!user.playerId) throw forbidden('player.profile_required')
  return { userId: user.id, playerId: user.playerId }
}

async function teamView(teamId: number, viewerPlayerId: number | null) {
  const team = await db.selectFrom('teams').selectAll().where('id', '=', teamId).executeTakeFirst()
  if (!team) throw notFound('team.not_found')
  const members = await db
    .selectFrom('team_members as m')
    .innerJoin('players as p', 'p.id', 'm.player_id')
    .leftJoin('cities as c', 'c.id', 'p.city_id')
    .leftJoin('player_ratings as s', (j) => j.onRef('s.player_id', '=', 'p.id').on('s.kind', '=', 'singles'))
    .leftJoin('player_ratings as d', (j) => j.onRef('d.player_id', '=', 'p.id').on('d.kind', '=', 'doubles'))
    .select(['p.id', 'p.first_name', 'p.last_name', 'p.birth_year', 'c.region_ru as region', 'm.role', 'm.status', 's.rating as singles', 'd.rating as doubles'])
    .where('m.team_id', '=', teamId)
    .where('m.status', '=', 'active')
    .orderBy('m.joined_at')
    .execute()
  const captain = team.captain_player_id === viewerPlayerId
  const invitations = await db
    .selectFrom('team_invitations as i')
    .innerJoin('players as p', 'p.id', 'i.player_id')
    .select(['i.id', 'i.player_id', 'i.direction', 'i.status', 'i.expires_at', 'i.created_at', 'p.first_name', 'p.last_name'])
    .where('i.team_id', '=', teamId)
    .orderBy('i.created_at', 'desc')
    .execute()
  const entries = await db
    .selectFrom('entries as e')
    .innerJoin('tournaments as t', 't.id', 'e.tournament_id')
    .select(['e.id', 'e.status', 't.id as tournament_id', 't.slug', 't.title', 't.starts_at'])
    .where('e.team_id', '=', teamId)
    .orderBy('t.starts_at', 'desc')
    .execute()
  return {
    id: team.id,
    kind: team.kind,
    name: team.name,
    captainPlayerId: team.captain_player_id,
    minSize: team.min_size,
    maxSize: team.max_size,
    approveJoins: team.approve_joins,
    payer: team.payer,
    isCaptain: captain,
    joinUrl: captain ? `${config.SITE_URL}/teams/join/${team.join_token}` : undefined,
    joinToken: captain ? team.join_token : undefined,
    complete: members.length >= team.min_size,
    members: members.map((m) => ({ id: m.id, name: playerName(m), birthYear: m.birth_year, region: m.region, role: m.role, singles: m.singles, doubles: m.doubles })),
    invitations: invitations.map((i) => ({ id: i.id, playerId: i.player_id, name: playerName(i), direction: i.direction, status: i.status, expiresAt: i.expires_at })),
    entries: entries.map((e) => ({ id: e.id, status: e.status, tournamentId: e.tournament_id, slug: e.slug, title: e.title, startsAt: e.starts_at })),
  }
}

teamsRouter.get(
  '/my',
  handler(async (req, res) => {
    const { playerId } = me(req)
    const ids = await db.selectFrom('team_members').select('team_id').where('player_id', '=', playerId).where('status', '=', 'active').execute()
    const teams = await Promise.all(ids.map((r) => teamView(r.team_id, playerId)))
    const incoming = await db
      .selectFrom('team_invitations as i')
      .innerJoin('teams as t', 't.id', 'i.team_id')
      .innerJoin('players as c', 'c.id', 't.captain_player_id')
      .select(['i.id', 'i.expires_at', 't.id as team_id', 't.name', 't.kind', 'c.first_name', 'c.last_name'])
      .where('i.player_id', '=', playerId)
      .where('i.direction', '=', 'invite')
      .where('i.status', '=', 'sent')
      .execute()
    res.json({ teams, invitations: incoming.map((i) => ({ id: i.id, teamId: i.team_id, name: i.name, kind: i.kind, captain: playerName(i), expiresAt: i.expires_at })) })
  }),
)

/** Invitation search (D-2): name with region and birth year to tell namesakes apart. */
teamsRouter.get(
  '/players',
  handler(async (req, res) => {
    requireUser(req)
    const { q } = parseQuery(z.object({ q: z.string().trim().min(2).max(60) }), req)
    let query = db
      .selectFrom('players as p')
      .leftJoin('cities as c', 'c.id', 'p.city_id')
      .leftJoin('player_ratings as r', (j) => j.onRef('r.player_id', '=', 'p.id').on('r.kind', '=', 'singles'))
      .select(['p.id', 'p.first_name', 'p.last_name', 'p.birth_year', 'c.region_ru as region', 'c.name_ru as city', 'r.rating'])
      .orderBy('p.last_name')
      .limit(20)
    for (const word of searchWords(q)) query = query.where('p.search_name', 'like', `%${word}%`)
    const rows = await query.execute()
    res.json(rows.map((r) => ({ id: r.id, name: playerName(r), birthYear: r.birth_year, region: r.region, city: r.city, rating: r.rating })))
  }),
)

teamsRouter.post(
  '/',
  handler(async (req, res) => {
    const actor = me(req)
    const body = parseBody(
      z.object({
        kind: z.enum(['pair', 'team']),
        name: z.string().trim().min(2).max(60),
        minSize: z.number().int().min(2).max(8).optional(),
        maxSize: z.number().int().min(2).max(10).optional(),
        approveJoins: z.boolean().optional(),
        payer: z.enum(['captain', 'each']).optional(),
      }),
      req,
    )
    const team = await db.transaction().execute((trx) => createTeam(trx, actor.playerId, body, actor.userId))
    res.status(201).json(await teamView(team.id, actor.playerId))
  }),
)

teamsRouter.get(
  '/join/:token',
  handler(async (req, res) => {
    const team = await db.selectFrom('teams as t').innerJoin('players as c', 'c.id', 't.captain_player_id').select(['t.id', 't.name', 't.kind', 't.approve_joins', 'c.first_name', 'c.last_name']).where('t.join_token', '=', String(req.params.token)).executeTakeFirst()
    if (!team) throw notFound('team.not_found')
    res.json({ id: team.id, name: team.name, kind: team.kind, approveJoins: team.approve_joins, captain: playerName(team) })
  }),
)

teamsRouter.post(
  '/join/:token',
  handler(async (req, res) => {
    const actor = me(req)
    res.json(await db.transaction().execute((trx) => joinByLink(trx, String(req.params.token), actor)))
  }),
)

teamsRouter.get(
  '/:id',
  handler(async (req, res) => {
    res.json(await teamView(intParam(req, 'id'), req.user?.playerId ?? null))
  }),
)

teamsRouter.post(
  '/:id/invitations',
  handler(async (req, res) => {
    const actor = me(req)
    const { playerId } = parseBody(z.object({ playerId: z.number().int().positive() }), req)
    const inv = await db.transaction().execute((trx) => invite(trx, intParam(req, 'id'), playerId, actor))
    res.status(201).json({ id: inv.id, status: inv.status, expiresAt: inv.expires_at })
  }),
)

teamsRouter.post(
  '/invitations/:invId/:answer',
  handler(async (req, res) => {
    const actor = me(req)
    const answer = z.enum(['accept', 'decline', 'revoke']).parse(req.params.answer)
    const to = ({ accept: 'accepted', decline: 'declined', revoke: 'revoked' } as const)[answer]
    res.json(await db.transaction().execute((trx) => answerInvitation(trx, intParam(req, 'invId'), to, actor)))
  }),
)

teamsRouter.delete(
  '/:id/members/:playerId',
  handler(async (req, res) => {
    const actor = me(req)
    await db.transaction().execute((trx) => removeMember(trx, intParam(req, 'id'), intParam(req, 'playerId'), actor))
    res.json({ ok: true })
  }),
)

teamsRouter.post(
  '/:id/repeat',
  handler(async (req, res) => {
    const actor = me(req)
    const team = await db.transaction().execute((trx) => repeatTeam(trx, intParam(req, 'id'), actor))
    res.status(201).json(await teamView(team.id, actor.playerId))
  }),
)

// ---------------------------------------------------------------------------
// Under /tournaments: team entries and meetings

teamEntriesRouter.post(
  '/:id/team-entries',
  handler(async (req, res) => {
    const id = intParam(req, 'id')
    const { teamId, byClub } = parseBody(z.object({ teamId: z.number().int().positive(), byClub: z.boolean().default(false) }), req)
    let actor: { userId: number; playerId: number | null }
    if (byClub) {
      const t = await db.selectFrom('tournaments').select(['club_id']).where('id', '=', id).executeTakeFirstOrThrow()
      const user = await requireClubRight(req, t.club_id, 'tournaments', { tournamentId: id })
      actor = { userId: user.id, playerId: user.playerId }
    } else actor = me(req)
    const result = await db.transaction().execute((trx) => registerTeam(trx, id, teamId, actor, { byClub }))
    bus.publish(`tournament:${id}`, 'tournament.entries_changed', { tournamentId: id })
    res.status(201).json(result)
  }),
)

async function meetingContext(req: Request) {
  const user = requireUser(req)
  const t = (await db.selectFrom('tournaments').selectAll().where('id', '=', intParam(req, 'id')).executeTakeFirst()) as Tournament | undefined
  if (!t) throw notFound('tournament.not_found')
  const m = await db.transaction().execute((trx) => loadMeeting(trx, t, intParam(req, 'matchId')))
  const access = await clubAccess(user.id, t.club_id)
  const staff = Boolean(access && (access.role === 'organizer' || access.rights.includes('conduct')))
  const side = await db.transaction().execute((trx) => captainSide(trx, m, user.playerId))
  return { user, t, m, staff, side }
}

const changed = (tournamentId: number, matchId: number) => bus.publish(`tournament:${tournamentId}`, 'match.updated', { tournamentId, matchId })

teamEntriesRouter.get(
  '/:id/meetings/:matchId',
  handler(async (req, res) => {
    const { t, m, staff, side } = await meetingContext(req)
    res.json(await db.transaction().execute((trx) => meetingView(trx, t, m, { staff, side })))
  }),
)

teamEntriesRouter.post(
  '/:id/meetings/:matchId/lineup',
  handler(async (req, res) => {
    const { user, t, m, staff, side } = await meetingContext(req)
    const body = parseBody(z.object({ lineup: z.array(z.number().int().positive()).min(1).max(8), side: z.enum(['home', 'away']).optional() }), req)
    const target = body.side && staff ? body.side : side
    if (!target) throw forbidden('meeting.not_captain')
    const byOrganizer = staff && target !== side
    const result = await db.transaction().execute((trx) => submitLineup(trx, t, m, target, body.lineup, { userId: user.id, byOrganizer }))
    changed(t.id, m.id)
    res.json(result)
  }),
)

teamEntriesRouter.post(
  '/:id/meetings/:matchId/games/:game/call',
  handler(async (req, res) => {
    const { user, t, m, staff } = await meetingContext(req)
    if (!staff) throw forbidden('club.right_missing')
    const { tableId } = parseBody(z.object({ tableId: z.number().int().positive().nullable().default(null) }).default({ tableId: null }), req)
    const result = await db.transaction().execute((trx) => callGame(trx, t, m, intParam(req, 'game') - 1, tableId, user.id))
    changed(t.id, m.id)
    res.json(result)
  }),
)

teamEntriesRouter.post(
  '/:id/meetings/:matchId/games/:game/result',
  handler(async (req, res) => {
    const { user, t, m, staff } = await meetingContext(req)
    if (!staff) throw forbidden('club.right_missing')
    const body = parseBody(
      z.object({
        setsHome: z.number().int().min(0).max(4),
        setsAway: z.number().int().min(0).max(4),
        games: z.array(z.object({ home: z.number().int().min(0), away: z.number().int().min(0) })).max(7).default([]),
      }),
      req,
    )
    const result = await db.transaction().execute(async (trx) => recordGame(trx, t, await loadMeeting(trx, t, m.id), intParam(req, 'game') - 1, body, user.id))
    changed(t.id, m.id)
    res.json(result)
  }),
)
