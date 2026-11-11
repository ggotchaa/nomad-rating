import type { Request } from 'express'
import { z } from 'zod'
import { badRequest } from './errors.ts'

export const parseBody = <T extends z.ZodType>(schema: T, req: Request): z.infer<T> => schema.parse(req.body ?? {})
export const parseQuery = <T extends z.ZodType>(schema: T, req: Request): z.infer<T> => schema.parse(req.query ?? {})

export function intParam(req: Request, name: string): number {
  const value = Number(req.params[name])
  if (!Number.isInteger(value) || value <= 0) throw badRequest('param.invalid', { name })
  return value
}

export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD')
export const optionalInt = z.coerce.number().int().optional()
export const pageQuery = {
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
}
