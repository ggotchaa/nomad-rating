// DEMO_MODE only: «Войти как…» for the client presentation. Mounted only when DEMO_MODE=true;
// delete this folder (and the mount in app.ts) to remove the demo helpers.

import { Router } from 'express'
import { z } from 'zod'
import { db } from '../db/index.ts'
import { createSession } from '../auth/sessions.ts'
import { handler, notFound } from '../http/errors.ts'
import { parseBody } from '../http/validate.ts'
import { currentUserView } from '../modules/auth.ts'
import { DEMO_ACCOUNTS } from './accounts.ts'

export const demoRouter = Router()

demoRouter.get('/accounts', (_req, res) => {
  res.json(DEMO_ACCOUNTS.map(({ key, role, title, description, email }) => ({ key, role, title, description, email })))
})

demoRouter.post(
  '/login-as',
  handler(async (req, res) => {
    const { key } = parseBody(z.object({ key: z.string() }), req)
    const account = DEMO_ACCOUNTS.find((a) => a.key === key)
    if (!account) throw notFound('demo.account_not_found')
    const user = await db.selectFrom('users').select('id').where('email', '=', account.email).executeTakeFirst()
    if (!user) throw notFound('demo.run_demo_reset')
    await createSession(res, user.id, 'demo')
    res.json(await currentUserView(user.id))
  }),
)
