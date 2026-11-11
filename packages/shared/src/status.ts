// Status machines from spec 4.9 (and 4.11 for invitations / team entries).
// A transition not listed here is rejected by the server; every accepted change
// is written to the audit log and broadcast over WebSocket.

export type StateMachine<S extends string> = {
  readonly states: readonly S[]
  readonly initial: S
  readonly transitions: Readonly<Record<S, readonly S[]>>
}

function machine<const S extends string>(initial: NoInfer<S>, transitions: Record<S, readonly NoInfer<S>[]>): StateMachine<S> {
  return { states: Object.keys(transitions) as S[], initial, transitions }
}

export const tournamentStatus = machine('draft', {
  draft: ['published', 'cancelled'],
  published: ['registration_closed', 'cancelled'],
  // «Запись закрыта» → «Опубликован» is allowed until «Старт».
  registration_closed: ['published', 'running', 'cancelled'],
  running: ['finished', 'finished_early'],
  finished: [],
  finished_early: [],
  cancelled: [],
})
export type TournamentStatus = (typeof tournamentStatus.states)[number]

export const entryStatus = machine('awaiting_payment', {
  assembling: ['awaiting_payment', 'cancelled_by_player', 'removed_by_club'], // pairs and teams (4.11)
  awaiting_payment: ['paid', 'expired', 'cancelled_by_player'],
  paid: ['checked_in', 'cancelled_by_player', 'removed_by_club'],
  checked_in: ['playing', 'removed_by_club'],
  playing: ['completed', 'withdrew'],
  completed: [],
  withdrew: [],
  expired: [],
  cancelled_by_player: [],
  removed_by_club: [],
  waitlist: ['invited', 'cancelled_by_player', 'removed_by_club'],
  invited: ['awaiting_payment', 'expired', 'cancelled_by_player'],
})
export type EntryStatus = (typeof entryStatus.states)[number]

/** Entry statuses that occupy a place in the tournament. */
export const ENTRY_OCCUPYING: readonly EntryStatus[] = ['awaiting_payment', 'paid', 'checked_in', 'playing', 'completed', 'withdrew']
/** Entry statuses that block a second registration of the same player. */
export const ENTRY_ACTIVE: readonly EntryStatus[] = [...ENTRY_OCCUPYING, 'assembling', 'waitlist', 'invited']

export const paymentStatus = machine('created', {
  created: ['processing', 'succeeded', 'declined', 'expired'],
  processing: ['succeeded', 'declined', 'expired'],
  succeeded: ['refunded_partial', 'refunded_full'],
  refunded_partial: ['refunded_partial', 'refunded_full'],
  refunded_full: [],
  declined: [],
  expired: [],
})
export type PaymentStatus = (typeof paymentStatus.states)[number]

export const bookingStatus = machine('held', {
  held: ['confirmed', 'expired'],
  confirmed: ['arrived', 'no_show', 'cancelled_by_player', 'cancelled_by_club', 'moved'],
  arrived: [],
  no_show: [],
  expired: [],
  cancelled_by_player: [],
  cancelled_by_club: [],
  moved: [],
})
export type BookingStatus = (typeof bookingStatus.states)[number]

/** Booking statuses that occupy the table (used by the DB EXCLUDE constraint too). */
export const BOOKING_OCCUPYING: readonly BookingStatus[] = ['held', 'confirmed', 'arrived', 'no_show']

export const clubStatus = machine('draft', {
  draft: ['review'],
  review: ['active', 'rejected'],
  rejected: ['review'],
  active: ['blocked'],
  blocked: ['active'],
})
export type ClubStatus = (typeof clubStatus.states)[number]

export const matchStatus = machine('scheduled', {
  waiting: ['scheduled', 'walkover'], // bracket match waiting for both players
  scheduled: ['called', 'walkover', 'annulled'],
  called: ['playing', 'scheduled', 'walkover'],
  playing: ['finished', 'retired', 'walkover'],
  finished: ['finished'], // correction keeps the status (M-7)
  walkover: [],
  retired: [],
  annulled: [],
})
export type MatchStatus = (typeof matchStatus.states)[number]

export const payoutStatus = machine('accrued', {
  accrued: ['available'],
  available: ['requested'],
  requested: ['paid', 'rejected'],
  paid: [],
  rejected: ['available'],
})
export type PayoutStatus = (typeof payoutStatus.states)[number]

export const invitationStatus = machine('sent', {
  sent: ['accepted', 'declined', 'expired', 'revoked'],
  accepted: [],
  declined: [],
  expired: [],
  revoked: [],
})
export type InvitationStatus = (typeof invitationStatus.states)[number]

export class TransitionError extends Error {
  constructor(
    readonly entity: string,
    readonly from: string,
    readonly to: string,
  ) {
    super(`${entity}: transition ${from} → ${to} is not allowed`)
  }
}

export function canTransition<S extends string>(m: StateMachine<S>, from: S, to: S): boolean {
  return m.transitions[from]?.includes(to) ?? false
}

export function assertTransition<S extends string>(entity: string, m: StateMachine<S>, from: S, to: S): void {
  if (!canTransition(m, from, to)) throw new TransitionError(entity, from, to)
}
