import type { HallPlanData } from '../../api/types.ts'
import { useApi } from '../../app/hooks.ts'
import { HallPlan } from './HallPlan.tsx'
import type { PlanTable, TableState } from './HallPlan.tsx'

type TableMatch = { id: number; match: { status: string; home?: { name: string } | null; away?: { name: string } | null } | null }

const short = (name?: string) => name?.split(' ')[0] ?? '—'

/** Hall plan in `tournament` mode: who plays where, coloured by match state (tables screen, live page). */
export function TournamentPlan({ tournamentId, tables }: { tournamentId: number; tables: TableMatch[] }) {
  const state = useApi<{ plan: HallPlanData; tables: PlanTable[] }>(`/tournaments/${tournamentId}/plan`)
  if (!state.data || !state.data.tables.length) return null
  const byId = new Map(tables.map((x) => [x.id, x.match]))
  const tableState = (id: number): TableState => {
    const m = byId.get(id)
    if (!m) return 'free'
    return m.status === 'playing' ? 'playing' : m.status === 'called' ? 'called' : 'partly'
  }
  const caption = (id: number) => {
    const m = byId.get(id)
    return m ? `${short(m.home?.name)} – ${short(m.away?.name)}` : undefined
  }
  return <HallPlan plan={state.data.plan} tables={state.data.tables} mode="tournament" state={tableState} caption={caption} />
}
