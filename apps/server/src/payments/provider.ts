// Payment adapter (spec P-1). Callers never talk to a provider directly: they call
// `startPayment` (service.ts), which stores the payment row and asks the active provider.
//
//  - PayAtClubProvider (demo, and «оплата в зале» later): no money moves online,
//    the booking / entry is confirmed immediately and the club collects the money.
//  - MockOnlineProvider (stage 2): hosted-page simulation with webhooks and holds.
//  - Real provider (stage 4): Kaspi / Freedom Pay / Halyk ePay / ioka.

import type { PaymentStatus } from '@nomad/shared'

export type CreatePaymentInput = {
  paymentId: number
  amount: number // tiyn
  description: string
  returnUrl: string
}

export type CreatePaymentResult = {
  status: PaymentStatus
  /** Hosted payment page for online providers. */
  redirectUrl?: string
  externalId?: string
}

export interface PaymentProvider {
  readonly id: string
  readonly method: 'online' | 'at_club'
  /** True when the purchase is confirmed without waiting for a webhook (pay at the club). */
  readonly confirmsImmediately: boolean
  createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult>
}

export class PayAtClubProvider implements PaymentProvider {
  readonly id = 'at_club'
  readonly method = 'at_club' as const
  readonly confirmsImmediately = true
  async createPayment(): Promise<CreatePaymentResult> {
    // The payment stays «created» until the club marks it as collected.
    return { status: 'created' }
  }
}
