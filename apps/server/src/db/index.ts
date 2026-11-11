import { Kysely, PostgresDialect } from 'kysely'
import pg from 'pg'
import { config } from '../config.ts'
import type { Database } from './types.ts'

// bigint (money, ids of large tables) as JS numbers — safe up to 9·10^15; numeric as float.
pg.types.setTypeParser(20, (v) => Number(v))
pg.types.setTypeParser(1700, (v) => Number.parseFloat(v))

export const pool = new pg.Pool({ connectionString: config.DATABASE_URL, max: 10 })

export const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) })

export type Db = Kysely<Database>
export type { Transaction } from 'kysely'

/** Serialises a value for a jsonb column (pg would turn JS arrays into Postgres arrays). */
export const json = (value: unknown): string => JSON.stringify(value)

/** Postgres error code helpers. */
export const isUniqueViolation = (e: unknown): boolean => (e as { code?: string })?.code === '23505'
export const isExclusionViolation = (e: unknown): boolean => (e as { code?: string })?.code === '23P01'
