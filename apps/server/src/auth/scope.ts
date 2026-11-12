import type { ClubScope } from '../db/types.ts'

export type ClubScopeTarget = { hallId?: number; tournamentId?: number; tableId?: number }

/** Whether a helper's scope covers the target. Tournament scope needs an explicit tournament. */
export function scopeAllows(scope: ClubScope, target: ClubScopeTarget): boolean {
  const ids = scope.ids ?? []
  if (scope.kind === 'halls') return target.hallId == null || ids.includes(target.hallId)
  if (scope.kind === 'tables') return target.tableId == null || ids.includes(target.tableId)
  if (scope.kind === 'tournaments') return target.tournamentId != null && ids.includes(target.tournamentId)
  return true
}
