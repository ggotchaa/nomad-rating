// Response shapes of the endpoints used by the web app (see apps/server/src/modules).

export type City = {
  id: number
  slug: string
  name: { ru: string; kk: string; en: string }
  region: string
  regionName?: { ru: string; kk: string; en: string }
  timezone: string
  /** Active clubs of the city that take online bookings. */
  bookingClubs?: number
}

export type Restrictions = { ratingMin?: number | null; ratingMax?: number | null; gender?: 'm' | 'f' | null; ageMin?: number | null; ageMax?: number | null }

export type HomeTournament = {
  id: number
  slug: string
  title: string
  startsAt: string
  fee: number
  max_participants: number
  restrictions: Restrictions
  status: string
  club: string
  city: string
  taken: number
}

export type Home = {
  upcoming: HomeTournament[]
  live: HomeTournament[]
  topPlayers: { rank: number; id: number; name: string; photoUrl: string | null; city: string | null; rating: number }[]
  clubsWithBooking: { id: number; slug: string; name: string; logo_url: string | null; city: string }[]
}

export type ClubCard = {
  id: number
  slug: string
  name: string
  description: string
  city: string
  citySlug: string
  address: string | null
  tables: number
  bookingAvailable: boolean
  nextTournamentAt: string | null
}

export type ClubRight = 'club' | 'tournaments' | 'conduct' | 'score_fix' | 'players' | 'bookings' | 'refunds' | 'finance'

export type Me = {
  user: {
    id: number
    email: string
    role: 'user' | 'admin'
    locale: string | null
    emailVerified?: boolean
    hasPassword?: boolean
    googleLinked?: boolean
    totpEnabled?: boolean
    mfaRequired?: boolean
    needsWelcome?: boolean
  } | null
  player: { id: number; first_name: string; last_name: string; gender: 'm' | 'f'; birth_year: number; photo_url: string | null; start_level: number; city: string | null; rating: number | null } | null
  clubs: { id: number; slug: string; name: string; role: 'organizer' | 'helper'; rights: ClubRight[] }[]
  activeClubId?: number | null
}


export type TournamentCard = {
  id: number
  slug: string
  title: string
  type: string
  status: string
  startsAt: string
  estimatedEndAt: string
  fee: number
  maxParticipants: number
  taken: number
  avgRating: number | null
  restrictions: Restrictions
  isRated: boolean
  club: { name: string; slug: string }
  hall: { name: string; address: string }
  city: string
}

export type Participant = {
  entryId: number
  playerId: number
  name: string
  city: string | null
  birthYear: number
  rating: number | null
  calibrating: boolean
  startLevel: number
  status: string
  waitlistPosition: number | null
  seed: number | null
  place: number | null
  placeTo: number | null
  paymentMethod?: string | null
  paymentStatus?: string | null
  registeredAt: string
  ratingChange?: { delta: number | null; rating_after: number | null; calibrated: boolean } | null
}

export type EntryRef = { entryId: number; playerId: number; name: string; rating: number | null; seed: number | null }

export type MatchView = {
  id: number
  number: number
  bracketNumber: number | null
  round: number | null
  label: string | null
  placeFrom: number | null
  placeTo: number | null
  status: string
  resultType: string | null
  home: EntryRef | null
  away: EntryRef | null
  homeSource: unknown
  awaySource: unknown
  setsHome: number | null
  setsAway: number | null
  games: { home: number; away: number }[]
  winnerEntryId: number | null
  table: number | null
}

export type StandingRow = { id: string; played: number; wins: number; losses: number; points: number; setsWon: number; setsLost: number; place: number; decidedBy: string | null; player?: EntryRef; tiedWith: string[]; tiedIds?: number[] }

export type GroupView = { code: string; members: (EntryRef | undefined)[]; standings: { needsDecision: boolean; rows: StandingRow[] } | null; matches: MatchView[] }

export type StageView =
  | { key: string; kind: 'groups' | 'round_robin'; name: string; status: string; groups: GroupView[] }
  | { key: string; kind: 'single_elim' | 'all_places'; name: string; status: string; size: number | null; matches: MatchView[] }

export type StageEstimate = { id: string; name: string; kind: string; players: number; matches: number; groups?: number[]; bracketSize?: number }
export type FormatEstimate = { stages: StageEstimate[]; totalMatches: number; minutes: number }

export type TournamentDetail = {
  id: number
  slug: string
  title: string
  type: string
  status: string
  startsAt: string
  estimatedEndAt: string
  registrationClosesAt: string | null
  fee: number
  maxParticipants: number
  minParticipants: number
  restrictions: Restrictions
  prizes: string
  description: string
  commentForPlayers: string
  isRated: boolean
  refundRules: { hoursBefore: number; percent: number }[]
  club: { id: number; slug: string; name: string; city: string }
  hall: { id: number; name: string; address: string; howToFind?: string; commentForPlayers?: string }
  tables: number
  format: { template: string; match: { winsNeeded: number } }
  estimate: FormatEstimate
  taken: number
  free: number
  avgRating: number | null
  participants: Participant[]
  myEntry: Participant | null
  structure: StageView[] | null
}

export type RatingRow = {
  rank: number | null
  calibrating?: boolean
  id: number
  name: string
  gender: 'm' | 'f'
  birthYear: number
  city: string | null
  rating: number | null
  provisional: boolean
  change30d: number | null
  matches: number
  winRate: number | null
}

export type PlayerRating = {
  kind: 'singles' | 'doubles'
  rating: number | null
  provisional: boolean
  maxRating: number | null
  tournaments: number
  matches: number
  wins: number
  winRate: number | null
  placeOverall: number | null
  placeCity: number | null
  calibration: { played: number; of: number; startLevel: number } | null
}

export type PlayerProfile = {
  id: number
  name: string
  gender: 'm' | 'f'
  birthYear: number
  hand: 'right' | 'left' | null
  photoUrl: string | null
  city: string | null
  addedByClub: boolean
  ratings: PlayerRating[]
}

export type RatingPoint = { tournamentId: number; title: string; slug: string; date: string; rating: number; delta: number | null; place: number | null }

export type PlayerTournament = { tournamentId: number; slug: string; title: string; date: string; club: string; place: number | null; placeTo: number | null; wins: number; losses: number; delta: number; ratingAfter: number | null }

export type PlayerMatch = {
  matchId: number
  tournament: { id: number; title: string; slug: string; date: string }
  stage: string
  round: string | null
  opponent: { id: number; name: string; rating: number | null }
  won: boolean
  score: string
  games: { home: number; away: number }[]
  resultType: string | null
  ratingDelta: number | null
}

export type H2H = { wins: number; losses: number; matches: PlayerMatch[] }

export type PlayerSearchItem = { id: number; name: string; birthYear: number; city: string | null; rating: number | null }

export type OpeningHours = Record<string, { open: number; close: number } | null>

export type HallPlanData = { width: number; length: number; landmarks: { kind: string; label: string; x: number; y: number; w?: number; h?: number }[] }

export type HallTable = { id: number; number: number; label: string; x: number; y: number; rotation: 0 | 90; bookable: boolean; pricePerHour: number | null; model: string | null; status: 'active' | 'broken' }

export type BookingSettings = {
  slotMinutes: 30 | 60
  minMinutes: number
  maxMinutes: number
  horizonDays: number
  holdMinutes: number
  freeCancelHours: number
  defaultPricePerHour: number
  tariffs: { name: string; days: number[]; from: number; to: number; pricePerHour: number }[]
}

export type Hall = {
  id: number
  clubId: number
  name: string
  address: string
  howToFind: string
  parking: string
  timezone: string
  openingHours: OpeningHours
  commentForPlayers: string
  equipment: Record<string, string>
  plan: HallPlanData
  tables: HallTable[]
  booking: BookingSettings
}

export type ClubTournamentBrief = { id: number; slug: string; title: string; starts_at: string; status: string; fee: number; max_participants: number; restrictions: Restrictions }

export type ClubDetail = {
  id: number
  slug: string
  name: string
  description: string
  city: string
  citySlug: string
  status: string
  contacts: { telegram: string | null; email: string | null; telegramChannel: string | null; instagram: string | null }
  halls: Hall[]
  upcomingTournaments: ClubTournamentBrief[]
  pastTournaments: ClubTournamentBrief[]
}

export type Slot = { start: string; end: string; free: boolean; reason: 'booked' | 'blocked' | 'past' | null; price: number }

export type AvailabilityTable = { id: number; number: number; label: string; x: number; y: number; rotation: 0 | 90; bookable: boolean; status: string; slots: Slot[]; blocks: { kind: string; start: string; end: string; note: string }[] }

export type Availability = {
  hallId: number
  date: string
  timezone: string
  plan: HallPlanData
  settings: { slotMinutes: number; minMinutes: number; maxMinutes: number; horizonDays: number; freeCancelHours: number }
  open: { open: number; close: number } | null
  tables: AvailabilityTable[]
}

export type BookingResult = { id: number; status: string; tableNumber: number; start: string; end: string; price: number; paymentMethod: string | null }

export type MyBooking = { id: number; starts_at: string; ends_at: string; status: string; price: number; table_number: number; hall: string; address: string; club: string; club_slug: string }

export type MyEntry = { id: number; status: string; waitlist_position: number | null; final_place: number | null; tournament_id: number; slug: string; title: string; starts_at: string; tournament_status: string; fee: number; club: string; payment_method: string | null }

export type MyClub = { id: number; slug: string; name: string; role: 'organizer' | 'helper'; rights: ClubRight[]; halls: { id: number; name: string }[] }

export type ManageTournament = { id: number; slug: string; title: string; status: string; starts_at: string; fee: number; max_participants: number; taken: number }

export type ClubPlayer = { id: number; name: string; birthYear: number; gender: 'm' | 'f'; city: string | null; rating: number | null; startLevel: number; hasAccount: boolean; addedByClub: boolean; tournaments: number; bookingNoShows: number }

export type DeskBooking = {
  id: number
  tableId: number
  start: string
  end: string
  status: string
  source: string
  price: number
  who: { playerId?: number; name?: string; guest?: string | null; contact?: string | null }
  note: string
  payment: { method: string | null; status: string | null }
}

export type Desk = {
  hallId: number
  date: string
  timezone: string
  openingHours: OpeningHours
  tables: { id: number; number: number; label: string | null; bookable: boolean; status: string }[]
  bookings: DeskBooking[]
  blocks: { id: number; kind: string; tableIds: number[]; start: string; end: string; note: string }[]
}

export type FormatOption = { id: string; name: string }
export type FormatPreview = { errors: string[]; estimate: FormatEstimate }
