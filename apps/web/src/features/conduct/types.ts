export type Side = { entryId: number; playerId: number; name: string; rating: number | null }
export type CallResponse = { answer: 'delivered' | 'going' | 'cannot'; reason?: string; at: string }
export type Game = { home: number; away: number }

export type ConductMatch = {
  id: number
  rules?: { winsNeeded: number; pointsToWin: number; gamePoints: 'none' | 'optional' | 'required' }
  number: number
  round: number
  label: string | null
  placeFrom: number | null
  placeTo: number | null
  status: string
  resultType: string | null
  home: Side | null
  away: Side | null
  tableId: number | null
  table: number | null
  calledAt: string | null
  callCount: number
  callResponses: Partial<Record<'home' | 'away', CallResponse>>
  setsHome: number | null
  setsAway: number | null
  games: Game[]
  winnerEntryId: number | null
  version: number
  reportedScore: { setsHome: number; setsAway: number; games: Game[] } | null
  disputed: boolean
}

export type QueueMatch = ConductMatch & { suggestedTableId: number | null; suggestedTable: number | null; waitReason: 'busy' | 'rest' | 'no_table' | null; readyAt: string | null }

export type ConductEntry = { entryId: number; playerId: number; name: string; status: string; seed: number | null; checkedInAt: string | null; members: { playerId: number; name: string; present: boolean }[] | null; rating: number; calibrating: boolean }

export type ConductState = {
  telegram?: Record<number, 'sent' | 'failed' | 'none'>
  tournament: {
    id: number
    slug: string
    title: string
    status: string
    startsAt: string
    settings: { scoreEntry?: string; checkinWindowMinutes?: number; requireCheckin?: boolean }
    match: { winsNeeded: number; pointsToWin: number; gamePoints: 'none' | 'optional' | 'required' }
    restMinutes: number
    minParticipants: number
  }
  tables: { id: number; number: number; match: ConductMatch | null }[]
  queue: QueueMatch[]
  attention: ConductMatch[]
  recent: ConductMatch[]
  entries: ConductEntry[]
}

export type ScorePayload = { setsHome: number; setsAway: number; games: Game[]; resultType: 'normal' | 'retired' | 'walkover'; winner?: 'home' | 'away'; version?: number }
