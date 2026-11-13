import { z } from 'zod'

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().default(3010),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default(''),
  SESSION_DAYS: z.coerce.number().int().positive().default(30),
  SITE_URL: z.string().default('http://localhost:5173'),
  SMTP_URL: z.string().default(''),
  MAIL_FROM: z.string().default('Nomad <no-reply@nomad.kz>'),
  GOOGLE_CLIENT_ID: z.string().default(''),
  GOOGLE_CLIENT_SECRET: z.string().default(''),
  GOOGLE_REDIRECT_URI: z.string().default(''),
  ADMIN_2FA_REQUIRED: z
    .string()
    .default('false')
    .transform((v) => v === 'true' || v === '1'),
  UPLOADS_DIR: z.string().default('uploads'),
  VAPID_PUBLIC_KEY: z.string().default(''),
  VAPID_PRIVATE_KEY: z.string().default(''),
  VAPID_SUBJECT: z.string().default('mailto:admin@nomad.kz'),
  TELEGRAM_BOT_TOKEN: z.string().default(''),
  TELEGRAM_BOT_USERNAME: z.string().default(''),
})

export type Config = z.infer<typeof schema>

function load(): Config {
  const parsed = schema.safeParse(process.env)
  if (!parsed.success) {
    console.error('Invalid environment:', z.prettifyError(parsed.error))
    process.exit(1)
  }
  return parsed.data
}

export const config = load()
