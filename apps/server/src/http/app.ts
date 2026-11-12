import cookieParser from 'cookie-parser'
import express from 'express'
import helmet from 'helmet'
import { pinoHttp } from 'pino-http'
import { config } from '../config.ts'
import { db } from '../db/index.ts'
import { logger } from '../logger.ts'
import { sessionMiddleware } from '../auth/sessions.ts'
import { authRouter } from '../modules/auth.ts'
import { catalogRouter } from '../modules/catalog.ts'
import { playersRouter } from '../modules/players.ts'
import { clubsRouter, hallsRouter, myRouter } from '../modules/clubs.ts'
import { clubTournamentsRouter, formatsRouter, tournamentsRouter } from '../modules/tournaments.ts'
import { bookingsRouter, hallBookingsRouter, myBookingsRouter } from '../modules/bookings.ts'
import { demoRouter } from '../demo/routes.ts'
import { accountRouter, myAccountRouter } from '../modules/account.ts'
import { clubManageRouter } from '../modules/club-manage.ts'
import { claimRouter, clubPlayersRouter } from '../modules/club-players.ts'
import { helpersRouter, invitationsRouter } from '../modules/helpers.ts'
import { adminRouter } from '../modules/admin.ts'
import { adminRttfRouter, rttfRouter } from '../modules/rttf.ts'
import { UPLOADS_ROOT } from '../storage/index.ts'
import { ratingRouter } from '../modules/rating.ts'
import { notificationsRouter } from '../modules/notifications.ts'
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
    res.json({ ok: true, demo: config.DEMO_MODE })
  })
  api.use('/uploads', express.static(UPLOADS_ROOT, { maxAge: '7d', fallthrough: false }))
  api.use('/auth', authRouter)
  api.use('/auth', accountRouter)
  api.use('/clubs', clubManageRouter)
  api.use('/clubs', helpersRouter)
  api.use('/clubs', clubPlayersRouter)
  api.use('/invitations', invitationsRouter)
  api.use('/my', myAccountRouter)
  api.use('/my', claimRouter)
  api.use('/rttf', rttfRouter)
  api.use('/admin/rttf', adminRttfRouter)
  api.use('/admin', adminRouter)
  api.use('/', catalogRouter)
  api.use('/players', playersRouter)
  api.use('/clubs/:clubId/tournaments', clubTournamentsRouter)
  api.use('/clubs', clubsRouter)
  api.use('/halls/:hallId', hallBookingsRouter)
  api.use('/halls', hallsRouter)
  api.use('/formats', formatsRouter)
  api.use('/tournaments', tournamentsRouter)
  api.use('/bookings', bookingsRouter)
  api.use('/my', myRouter)
  api.use('/my', myBookingsRouter)
  api.use('/rating', ratingRouter)
  api.use('/notifications', notificationsRouter)
  if (config.DEMO_MODE) api.use('/demo', demoRouter)
  api.use((_req, _res, next) => next(notFound('route.not_found')))

  app.use('/api', api)
  app.use(errorHandler)
  return app
}
