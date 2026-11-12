// Stage 5 worker tick: 48-hour team invitation expiry, overdue team line-ups, league reminders.

import { db } from '../db/index.ts'
import { leagueReminders } from '../leagues/service.ts'
import { lineupOverdue } from '../teams/meeting.ts'
import { expireInvitations } from '../teams/service.ts'

export async function stage5Tick(now = new Date()) {
  const invitations = await db.transaction().execute((trx) => expireInvitations(trx, now))
  const lineups = await db.transaction().execute((trx) => lineupOverdue(trx, now))
  const reminders = await leagueReminders(now)
  return { invitations, lineups, reminders }
}
