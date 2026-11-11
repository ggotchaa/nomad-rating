import type { ErrorRequestHandler, NextFunction, Request, RequestHandler, Response } from 'express'
import { TransitionError } from '@nomad/shared'
import { ZodError } from 'zod'
import { isExclusionViolation, isUniqueViolation } from '../db/index.ts'
import { logger } from '../logger.ts'

/** Errors with a stable machine code; the web app translates `code` (RU/KK/EN). */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly details?: unknown,
  ) {
    super(code)
  }
}

export const badRequest = (code: string, details?: unknown) => new HttpError(400, code, details)
export const unauthorized = (code = 'auth.required') => new HttpError(401, code)
export const forbidden = (code = 'access.denied') => new HttpError(403, code)
export const notFound = (code = 'not_found') => new HttpError(404, code)
export const conflict = (code: string, details?: unknown) => new HttpError(409, code, details)
export const unprocessable = (code: string, details?: unknown) => new HttpError(422, code, details)

/** Wraps an async handler so rejections reach the error middleware (Express 5 does this too; kept explicit). */
export const handler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next)
  }

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.code, details: err.details })
    return
  }
  if (err instanceof ZodError) {
    res.status(422).json({
      error: 'validation.failed',
      details: err.issues.map((i) => ({ path: i.path.join('.'), code: i.code, message: i.message })),
    })
    return
  }
  if (err instanceof TransitionError) {
    res.status(409).json({ error: 'status.transition_not_allowed', details: { from: err.from, to: err.to, entity: err.entity } })
    return
  }
  if (isExclusionViolation(err)) {
    res.status(409).json({ error: 'booking.slot_taken' })
    return
  }
  if (isUniqueViolation(err)) {
    res.status(409).json({ error: 'conflict.duplicate', details: (err as { constraint?: string }).constraint })
    return
  }
  logger.error({ err, url: req.originalUrl }, 'unhandled error')
  res.status(500).json({ error: 'internal' })
}
