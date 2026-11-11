// Money is kept in tiyn (1 ₸ = 100 tiyn) as integers everywhere.

export const tenge = (amount: number): number => Math.round(amount * 100)
export const toTenge = (tiyn: number): number => tiyn / 100

export type CommissionRate = {
  /** Platform percent, spec default 8. */
  percent: number
  /** Minimum commission in tiyn, null = not set. */
  minimum: number | null
}

export const DEFAULT_COMMISSION: CommissionRate = { percent: 8, minimum: null }

/** Commission = max(fee · p / 100, C_min) (spec 4.3), rounded to whole tiyn. */
export function commission(fee: number, rate: CommissionRate = DEFAULT_COMMISSION): number {
  const byPercent = Math.round((fee * rate.percent) / 100)
  return rate.minimum == null ? byPercent : Math.max(byPercent, rate.minimum)
}

/** Amount payable to the club = fee − commission − acquiring (if the club pays it). */
export function clubShare(fee: number, rate: CommissionRate = DEFAULT_COMMISSION, acquiring = 0): number {
  return fee - commission(fee, rate) - acquiring
}
