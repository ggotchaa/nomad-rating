import { randomUUID } from 'node:crypto'
import { commission, DEFAULT_COMMISSION } from '@nomad/shared'
import type { CommissionRate } from '@nomad/shared'
import type { Transaction } from '../db/index.ts'
import { json } from '../db/index.ts'
import type { Database } from '../db/types.ts'
import { PayAtClubProvider } from './provider.ts'
import type { PaymentProvider } from './provider.ts'

const providers = new Map<string, PaymentProvider>([['at_club', new PayAtClubProvider()]])

/** The provider used for new online payments. Demo: everything is paid at the club. */
export function activeProvider(): PaymentProvider {
  return providers.get('at_club') as PaymentProvider
}

export async function commissionRate(trx: Transaction<Database>, clubId: number): Promise<CommissionRate> {
  const club = await trx.selectFrom('clubs').select('commission').where('id', '=', clubId).executeTakeFirstOrThrow()
  if (club.commission) return club.commission
  const setting = await trx.selectFrom('platform_settings').select('value').where('key', '=', 'commission').executeTakeFirst()
  return (setting?.value as CommissionRate | undefined) ?? DEFAULT_COMMISSION
}

export type StartPaymentInput = {
  purpose: 'tournament_entry' | 'booking'
  amount: number
  clubId: number
  userId: number | null
  description: string
  returnUrl: string
  metadata?: Record<string, unknown>
}

export type StartedPayment = { paymentId: number; confirmed: boolean; redirectUrl: string | null; method: 'online' | 'at_club' }

/**
 * Creates the payment row (with the platform commission, spec 4.3 — charged on hall payments too, B-12)
 * and asks the provider. `confirmed` tells the caller to confirm the booking / entry right away.
 */
export async function startPayment(trx: Transaction<Database>, input: StartPaymentInput): Promise<StartedPayment> {
  const provider = activeProvider()
  const rate = await commissionRate(trx, input.clubId)
  const row = await trx
    .insertInto('payments')
    .values({
      provider: provider.id,
      method: provider.method,
      purpose: input.purpose,
      amount: input.amount,
      commission: commission(input.amount, rate),
      idempotency_key: randomUUID(),
      user_id: input.userId,
      club_id: input.clubId,
      metadata: json(input.metadata ?? {}),
    })
    .returning('id')
    .executeTakeFirstOrThrow()
  const result = await provider.createPayment({
    paymentId: row.id,
    amount: input.amount,
    description: input.description,
    returnUrl: input.returnUrl,
  })
  if (result.status !== 'created' || result.externalId) {
    await trx
      .updateTable('payments')
      .set({ status: result.status, external_id: result.externalId ?? null, updated_at: new Date() })
      .where('id', '=', row.id)
      .execute()
  }
  return {
    paymentId: row.id,
    confirmed: provider.confirmsImmediately,
    redirectUrl: result.redirectUrl ?? null,
    method: provider.method,
  }
}
