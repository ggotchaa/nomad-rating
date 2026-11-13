import cookieParser from 'cookie-parser'
import express from 'express'
import helmet from 'helmet'
import { pinoHttp } from 'pino-http'
import { db } from '../db/index.ts'
import { logger } from '../logger.ts'
import { sessionMiddleware } from '../auth/sessions.ts'
import { authRouter } from '../modules/auth.ts'
import { catalogRouter } from '../modules/catalog.ts'
import { playersRouter } from '../modules/players.ts'
import { clubsRouter, hallsRouter, myRouter } from '../modules/clubs.ts'
import { clubTournamentsRouter, formatsRouter, formatTemplatesRouter, tournamentsRouter } from '../modules/tournaments.ts'
import { bookingsRouter, hallBookingsRouter, myBookingsRouter } from '../modules/bookings.ts'
import { accountRouter, myAccountRouter } from '../modules/account.ts'
import { clubManageRouter } from '../modules/club-manage.ts'
import { claimRouter, clubPlayersRouter } from '../modules/club-players.ts'
import { financeRouter } from '../modules/finance.ts'
import { helpersRouter, invitationsRouter } from '../modules/helpers.ts'
import { adminRouter } from '../modules/admin.ts'
import { adminRttfRouter, rttfRouter } from '../modules/rttf.ts'
import { UPLOADS_ROOT } from '../storage/index.ts'
import { ratingRouter } from '../modules/rating.ts'
import { notificationsRouter } from '../modules/notifications.ts'
import { conductRouter, myCallsRouter } from '../modules/conduct.ts'
import { teamEntriesRouter, teamsRouter } from '../modules/teams.ts'
import { clubLeaguesRouter, leaguesRouter } from '../modules/leagues.ts'
import { checkinRouter } from '../modules/checkin.ts'
import { liveRouter, ogRouter, shortRouter } from '../modules/live.ts'
import { seriesRouter, tournamentAdminRouter } from '../modules/tournament-admin.ts'
// --- Stage 6 ---
import { hallSettingsRouter } from '../modules/booking-settings.ts'
import { adminPlayersRouter } from '../modules/admin-players.ts'
import { adminSystemRouter, publicSettingsRouter } from '../modules/admin-system.ts'
import { tournamentPlanRouter } from '../modules/plan.ts'
import { opsRouter } from './ops.ts'
import { errorHandler, notFound } from './errors.ts'

export function createApp() {
  const app = express()
  app.disable('x-powered-by')
  app.set('trust proxy', 1)
  app.use(helmet())
  app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === '/api/health' } }))
  app.use(express.json({ limit: '1mb' }))
  app.use(cookieParser())
  app.use(sessionMiddleware)

  const api = express.Router()
  api.get('/health', async (_req, res) => {
    await db.selectFrom('cities').select('id').limit(1).execute()
    res.json({ ok: true })
  })
  api.use('/uploads', express.static(UPLOADS_ROOT, { maxAge: '7d', fallthrough: false }))
  api.use('/auth', authRouter)
  api.use('/auth', accountRouter)
  api.use('/clubs', clubManageRouter)
  api.use('/clubs', helpersRouter)
  api.use('/clubs', clubPlayersRouter)
  api.use('/clubs', financeRouter)
  api.use('/invitations', invitationsRouter)
  api.use('/my', myAccountRouter)
  api.use('/my', claimRouter)
  api.use('/rttf', rttfRouter)
  api.use('/admin/rttf', adminRttfRouter)
  api.use('/admin', adminRouter)
  api.use('/admin', adminPlayersRouter)
  api.use('/admin', adminSystemRouter)
  api.use('/settings', publicSettingsRouter)
  api.use('/', opsRouter)
  api.use('/', catalogRouter)
  api.use('/players', playersRouter)
  api.use('/clubs/:clubId/tournaments', clubTournamentsRouter)
  api.use('/clubs/:clubId/series', seriesRouter)
  api.use('/clubs/:clubId/format-templates', formatTemplatesRouter)
  api.use('/clubs', clubsRouter)
  api.use('/halls/:hallId', hallBookingsRouter)
  api.use('/halls/:hallId', hallSettingsRouter)
  api.use('/halls', hallsRouter)
  api.use('/formats', formatsRouter)
  api.use('/tournaments', tournamentsRouter)
  api.use('/tournaments', tournamentAdminRouter)
  api.use('/tournaments', conductRouter)
  api.use('/tournaments', checkinRouter)
  api.use('/tournaments', liveRouter)
  api.use('/tournaments', tournamentPlanRouter)
  api.use('/tournaments', teamEntriesRouter)
  api.use('/teams', teamsRouter)
  api.use('/leagues', leaguesRouter)
  api.use('/clubs/:clubId/leagues', clubLeaguesRouter)
  api.use('/og', ogRouter)
  api.use('/s', shortRouter)
  api.use('/bookings', bookingsRouter)
  api.use('/my/calls', myCallsRouter)
  api.use('/my', myRouter)
  api.use('/my', myBookingsRouter)
  api.use('/rating', ratingRouter)
  api.use('/notifications', notificationsRouter)
  api.use((_req, _res, next) => next(notFound('route.not_found')))

  app.use('/api', api)
  app.use(errorHandler)
  return app
}
