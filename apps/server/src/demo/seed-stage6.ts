// Stage 6 demo data: a zone on the main hall plan and a recurring children's training block.

import { utcToZoned } from '@nomad/shared'
import { db, json } from '../db/index.ts'
import type { HallPlan } from '../db/types.ts'

export async function seedStage6(log: (s: string) => void): Promise<void> {
  const hall = await db.selectFrom('halls').select(['id', 'plan', 'timezone']).where('is_default', '=', true).orderBy('id').executeTakeFirst()
  if (!hall) return
  const plan = hall.plan as HallPlan
  if (!plan.landmarks.some((l) => l.kind === 'zone')) {
    const zone = { kind: 'zone' as const, label: 'Зона отдыха', x: Math.max(2, plan.width - 2.5), y: 1.5, w: 3, h: 2 }
    await db.updateTable('halls').set({ plan: json({ ...plan, landmarks: [...plan.landmarks, zone] }) }).where('id', '=', hall.id).execute()
  }
  const tables = await db.selectFrom('hall_tables').select('id').where('hall_id', '=', hall.id).orderBy('number', 'desc').limit(2).execute()
  await db
    .insertInto('recurring_blocks')
    .values({ hall_id: hall.id, kind: 'training', table_ids: tables.map((x) => x.id), weekdays: [2, 4], start_minutes: 9 * 60, end_minutes: 11 * 60, valid_from: utcToZoned(new Date(), hall.timezone).date, valid_until: null, note: 'Детская секция' })
    .execute()
  log('stage 6: plan zone, recurring training block (Tue/Thu 09:00–11:00)')
}
