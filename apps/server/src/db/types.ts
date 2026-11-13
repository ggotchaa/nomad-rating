// Kysely table types for migrations/0001_init.ts. JSON columns are written as JSON strings (see `json()`).

import type { ColumnType, Generated, Insertable, Selectable, Updateable } from 'kysely'
import type {
  BookingStatus,
  ClubStatus,
  EntryStatus,
  MatchStatus,
  PaymentStatus,
  TournamentStatus,
} from '@nomad/shared'

type Timestamp = ColumnType<Date, Date | string, Date | string>
type DefaultTimestamp = ColumnType<Date, Date | string | undefined, Date | string>
type Json<T> = ColumnType<T, string, string>
type JsonDefault<T> = ColumnType<T, string | undefined, string>
type Id = Generated<number>

export interface CitiesTable {
  id: Id
  slug: string
  name_ru: string
  name_kk: string
  name_en: string
  region_ru: Generated<string>
  region_kk: Generated<string>
  region_en: Generated<string>
  timezone: Generated<string>
  sort_order: Generated<number>
}

export interface UsersTable {
  id: Id
  email: string
  email_verified_at: Timestamp | null
  password_hash: string | null
  google_sub: string | null
  platform_role: Generated<'user' | 'admin'>
  /** Explicit choice; NULL means the site default (Kazakh). */
  locale: 'ru' | 'kk' | 'en' | null
  totp_secret: string | null
  totp_enabled_at: Timestamp | null
  consent_at: Timestamp | null
  blocked_at: Timestamp | null
  created_at: DefaultTimestamp
}

export interface SessionsTable {
  id: string
  user_id: number
  active_club_id: number | null
  user_agent: string | null
  mfa_verified_at: Timestamp | null
  created_at: DefaultTimestamp
  expires_at: Timestamp
}

export interface PlayersTable {
  id: Id
  user_id: number | null
  first_name: string
  last_name: string
  middle_name: string | null
  gender: 'm' | 'f'
  birth_year: number
  city_id: number | null
  hand: 'right' | 'left' | null
  photo_url: string | null
  start_level: Generated<number>
  added_by_club_id: number | null
  claim_code: string | null
  contact_email: string | null
  search_name: string
  created_at: DefaultTimestamp
  updated_at: DefaultTimestamp
}

export type CalibrationJson = {
  tournaments?: number
  bestWin?: number | null
  worstLoss?: number | null
  bestWinMatch?: string | null
  worstLossMatch?: string | null
}

export interface PlayerRatingsTable {
  player_id: number
  kind: 'singles' | 'doubles'
  rating: number | null
  source: 'calibration' | 'rttf' | 'admin' | null
  rated_matches: Generated<number>
  tournaments: Generated<number>
  matches: Generated<number>
  wins: Generated<number>
  max_rating: number | null
  calibration: JsonDefault<CalibrationJson>
  last_rated_at: Timestamp | null
  updated_at: DefaultTimestamp
}

export interface ClubFormatTemplatesTable {
  id: Id
  club_id: number
  name: string
  format: Json<import('@nomad/engine').TournamentFormat>
  created_by: number | null
  created_at: Generated<Timestamp>
}

export interface ClubsTable {
  id: Id
  slug: string
  name: string
  description: Generated<string>
  city_id: number
  logo_url: string | null
  cover_url: string | null
  status: Generated<ClubStatus>
  owner_user_id: number
  telegram_url: string | null
  instagram_url: string | null
  contact_email: string | null
  contact_telegram: string | null
  requisites: JsonDefault<Record<string, string>>
  commission: Json<{ percent: number; minimum: number | null } | null> | null
  hall_payment_enabled: Generated<boolean>
  tournament_defaults: JsonDefault<Record<string, unknown>>
  verified_at: Timestamp | null
  status_reason: string | null
  comment_for_players: Generated<string>
  created_at: DefaultTimestamp
}

export interface ClubMembersTable {
  club_id: number
  user_id: number
  role: 'organizer' | 'helper'
  rights: ColumnType<string[], string[] | undefined, string[]>
  scope: JsonDefault<ClubScope>
  invited_by: number | null
  created_at: DefaultTimestamp
}

export type HallPlan = {
  width: number
  length: number
  landmarks: { kind: 'entrance' | 'locker' | 'window' | 'zone' | 'other'; label: string; x: number; y: number; w?: number; h?: number }[]
}

export interface HallsTable {
  id: Id
  club_id: number
  name: string
  address: Generated<string>
  lat: number | null
  lng: number | null
  how_to_find: Generated<string>
  parking: Generated<string>
  timezone: Generated<string>
  opening_hours: JsonDefault<Record<string, { open: number; close: number } | null>>
  comment_for_players: Generated<string>
  equipment: JsonDefault<Record<string, string>>
  plan: JsonDefault<HallPlan>
  is_default: Generated<boolean>
  created_at: DefaultTimestamp
}

export interface HallTablesTable {
  id: Id
  hall_id: number
  number: number
  label: string | null
  x: Generated<number>
  y: Generated<number>
  rotation: Generated<0 | 90>
  bookable: Generated<boolean>
  price_per_hour: number | null
  model: string | null
  status: Generated<'active' | 'broken'>
}

export interface BookingSettingsTable {
  hall_id: number
  settings: Json<import('@nomad/engine').BookingSettings>
}

export type TournamentRestrictions = {
  ratingMin?: number | null
  ratingMax?: number | null
  gender?: 'm' | 'f' | null
  ageMin?: number | null
  ageMax?: number | null
  /** Pairs: maximum of the pair rating sum; teams: maximum of the top-3 sum (D-9). */
  ratingSumMax?: number | null
}

export type TournamentSettings = {
  scoreEntry?: 'staff' | 'players'
  checkinWindowMinutes?: number
  sameDayRegistration?: boolean
  callResponseMinutes?: number
  avgMatchMinutes?: number
  restMinutes?: number
  requireCheckin?: boolean
  meeting?: MeetingSchemeJson
}

export type RefundRule = { hoursBefore: number; percent: number }

export interface TournamentsTable {
  rating_coefficient: Generated<number>
  id: Id
  club_id: number
  hall_id: number
  slug: string
  title: string
  type: Generated<'singles' | 'doubles' | 'team'>
  status: Generated<TournamentStatus>
  starts_at: Timestamp
  estimated_end_at: Timestamp
  registration_closes_at: Timestamp | null
  max_participants: number
  min_participants: Generated<number>
  fee: Generated<number>
  restrictions: JsonDefault<TournamentRestrictions>
  prizes: Generated<string>
  description: Generated<string>
  comment_for_players: Generated<string>
  staff_comment: Generated<string>
  cover_url: string | null
  format: Json<import('@nomad/engine').TournamentFormat>
  settings: JsonDefault<TournamentSettings>
  refund_rules: JsonDefault<RefundRule[]>
  table_ids: ColumnType<number[], number[] | undefined, number[]>
  is_rated: Generated<boolean>
  series_id: number | null
  address_snapshot: Json<Record<string, unknown>> | null
  cancelled_reason: string | null
  checkin_secret: Generated<string>
  copied_from: number | null
  created_by: number | null
  created_at: DefaultTimestamp
  published_at: Timestamp | null
  started_at: Timestamp | null
  finished_at: Timestamp | null
  league_tour_id: Generated<number | null>
  league_division_id: Generated<number | null>
}

export interface PaymentsTable {
  id: Id
  provider: string
  method: 'online' | 'at_club'
  purpose: 'tournament_entry' | 'booking' | 'season'
  amount: number
  commission: Generated<number>
  status: Generated<PaymentStatus>
  external_id: string | null
  idempotency_key: string
  user_id: number | null
  club_id: number
  metadata: JsonDefault<Record<string, unknown>>
  created_at: DefaultTimestamp
  updated_at: DefaultTimestamp
}

export interface EntriesTable {
  id: Id
  tournament_id: number
  player_id: number
  status: EntryStatus
  hold_until: Timestamp | null
  waitlist_position: number | null
  payment_id: number | null
  seed: number | null
  final_place: number | null
  final_place_to: number | null
  rating_at_start: number | null
  registered_by: number | null
  checked_in_at: Timestamp | null
  team_id: Generated<number | null>
  roster: ColumnType<number[] | null, number[] | null | undefined, number[] | null>
  checked_in_players: ColumnType<number[], number[] | undefined, number[]>
  created_at: DefaultTimestamp
  updated_at: DefaultTimestamp
}

export interface StagesTable {
  id: Id
  tournament_id: number
  stage_key: string
  kind: 'groups' | 'round_robin' | 'single_elim' | 'all_places'
  name: string
  order_index: number
  status: Generated<'pending' | 'running' | 'finished'>
  bracket: Json<import('@nomad/engine').Bracket> | null
  seeds: Json<(number | null)[]> | null
}

export interface GroupsTable {
  id: Id
  stage_id: number
  code: string
  order_index: number
  standings: Json<import('@nomad/engine').StandingsResult> | null
}

export interface GroupMembersTable {
  group_id: number
  entry_id: number
  seed_index: number
}

export interface MatchesTable {
  id: Id
  tournament_id: number
  stage_id: number
  group_id: number | null
  number: number
  bracket_number: number | null
  round: number
  tour: number | null
  stage_label: string | null
  place_from: number | null
  place_to: number | null
  home_source: Json<import('@nomad/engine').Source> | null
  away_source: Json<import('@nomad/engine').Source> | null
  home_entry_id: number | null
  away_entry_id: number | null
  status: MatchStatus
  result_type: 'normal' | 'walkover' | 'retired' | 'bye' | null
  table_id: number | null
  called_at: Timestamp | null
  started_at: Timestamp | null
  finished_at: Timestamp | null
  sets_home: number | null
  sets_away: number | null
  games: JsonDefault<import('@nomad/engine').GameScore[]>
  winner_entry_id: number | null
  is_rated: Generated<boolean>
  version: Generated<number>
  call_count: Generated<number>
  call_responses: JsonDefault<CallResponses>
  reported_score: Json<ReportedScore> | null
  reported_by: number | null
  disputed: Generated<boolean>
}

export interface RatingEventsTable {
  id: Generated<number>
  tournament_id: number
  match_id: number
  player_id: number
  opponent_id: number
  kind: 'singles' | 'doubles'
  rating_before: number
  opponent_rating: number
  expected: number
  k: number
  score: number
  delta: number
  created_at: DefaultTimestamp
}

export interface RatingSnapshotsTable {
  state_before: Json<RatingStateJson | null> | null
  state_after: Json<RatingStateJson | null> | null
  player_id: number
  kind: 'singles' | 'doubles'
  tournament_id: number
  rating_before: number | null
  rating_after: number | null
  delta: Generated<number>
  place: number | null
  matches: Generated<number>
  wins: Generated<number>
  calibrated: Generated<boolean>
  at: Timestamp
}

export interface TableBlocksTable {
  id: Id
  hall_id: number
  table_ids: ColumnType<number[], number[] | undefined, number[]>
  starts_at: Timestamp
  ends_at: Timestamp
  kind: 'training' | 'closed' | 'tournament' | 'maintenance'
  tournament_id: number | null
  note: Generated<string>
  created_by: number | null
  created_at: DefaultTimestamp
}

export interface BookingsTable {
  id: Id
  hall_id: number
  table_id: number
  club_id: number
  player_id: number | null
  guest_name: string | null
  guest_contact: string | null
  created_by: number | null
  starts_at: Timestamp
  ends_at: Timestamp
  period: ColumnType<string, never, never>
  status: BookingStatus
  hold_until: Timestamp | null
  price: Generated<number>
  payment_id: number | null
  source: Generated<'online' | 'phone'>
  note: Generated<string>
  created_at: DefaultTimestamp
  updated_at: DefaultTimestamp
  cancel_token: Generated<string>
  reminded_at: Timestamp | null
}

export interface AuditLogTable {
  id: Generated<number>
  at: DefaultTimestamp
  actor_user_id: number | null
  club_id: number | null
  entity: string
  entity_id: string
  action: string
  before: Json<unknown> | null
  after: Json<unknown> | null
  reason: string | null
}

export interface PlatformSettingsTable {
  key: string
  value: Json<unknown>
  updated_at: DefaultTimestamp
}

export interface Database {
  disputes: DisputesTable
  notifications: NotificationsTable
  notification_prefs: NotificationPrefsTable
  notification_log: NotificationLogTable
  push_subscriptions: PushSubscriptionsTable
  telegram_accounts: TelegramAccountsTable
  telegram_bind_tokens: TelegramBindTokensTable
  telegram_messages: TelegramMessagesTable
  subscriptions: SubscriptionsTable
  notification_dedupe: NotificationDedupeTable
  cities: CitiesTable
  users: UsersTable
  sessions: SessionsTable
  players: PlayersTable
  player_ratings: PlayerRatingsTable
  clubs: ClubsTable
  club_format_templates: ClubFormatTemplatesTable
  club_members: ClubMembersTable
  halls: HallsTable
  hall_tables: HallTablesTable
  booking_settings: BookingSettingsTable
  tournaments: TournamentsTable
  payments: PaymentsTable
  entries: EntriesTable
  stages: StagesTable
  groups: GroupsTable
  group_members: GroupMembersTable
  matches: MatchesTable
  rating_events: RatingEventsTable
  rating_snapshots: RatingSnapshotsTable
  table_blocks: TableBlocksTable
  bookings: BookingsTable
  audit_log: AuditLogTable
  platform_settings: PlatformSettingsTable
  auth_tokens: AuthTokensTable
  club_invitations: ClubInvitationsTable
  player_merge_requests: PlayerMergeRequestsTable
  rttf_profiles: RttfProfilesTable
  rttf_claims: RttfClaimsTable
  series: SeriesTable
  recurring_blocks: RecurringBlocksTable
  rating_adjustments: RatingAdjustmentsTable
  teams: TeamsTable
  team_members: TeamMembersTable
  team_invitations: TeamInvitationsTable
  meeting_lineups: MeetingLineupsTable
  meeting_games: MeetingGamesTable
  leagues: LeaguesTable
  league_seasons: LeagueSeasonsTable
  league_divisions: LeagueDivisionsTable
  league_participants: LeagueParticipantsTable
  league_tours: LeagueToursTable
  league_results: LeagueResultsTable
  league_moves: LeagueMovesTable
  league_fixtures: LeagueFixturesTable
}

export type Tournament = Selectable<TournamentsTable>
export type NewTournament = Insertable<TournamentsTable>
export type TournamentUpdate = Updateable<TournamentsTable>
export type Player = Selectable<PlayersTable>
export type Club = Selectable<ClubsTable>
export type Hall = Selectable<HallsTable>
export type HallTable = Selectable<HallTablesTable>
export type Booking = Selectable<BookingsTable>
export type Entry = Selectable<EntriesTable>
export type Match = Selectable<MatchesTable>
export type User = Selectable<UsersTable>

// --- Stage 1 ---

export type ClubScope = { kind: 'club' | 'halls' | 'tournaments' | 'tables'; ids?: number[] }

export interface AuthTokensTable {
  id: Id
  user_id: number
  kind: 'verify_email' | 'reset_password'
  token_hash: string
  expires_at: Timestamp
  used_at: Timestamp | null
  created_at: DefaultTimestamp
}

export interface ClubInvitationsTable {
  id: Id
  club_id: number
  email: string | null
  token_hash: string
  rights: ColumnType<string[], string[] | undefined, string[]>
  scope: JsonDefault<ClubScope>
  template: string | null
  status: Generated<'sent' | 'accepted' | 'declined' | 'expired' | 'revoked'>
  expires_at: Timestamp
  invited_by: number | null
  accepted_by: number | null
  created_at: DefaultTimestamp
}

export interface PlayerMergeRequestsTable {
  id: Id
  club_id: number | null
  source_player_id: number
  target_player_id: number
  reason: Generated<string>
  status: Generated<'open' | 'merged' | 'rejected'>
  requested_by: number | null
  resolved_by: number | null
  resolved_at: Timestamp | null
  created_at: DefaultTimestamp
}

export interface RttfProfilesTable {
  id: Id
  rttf_id: string | null
  full_name: string
  search_name: string
  birth_year: number | null
  city: Generated<string>
  rating: number
  player_id: number | null
  updated_at: DefaultTimestamp
}

export interface RttfClaimsTable {
  id: Id
  kind: 'claim' | 'add_request'
  rttf_profile_id: number | null
  player_id: number
  status: 'approved' | 'pending' | 'conflict' | 'rejected'
  reason: Generated<string>
  payload: JsonDefault<Record<string, unknown>>
  resolved_by: number | null
  resolved_at: Timestamp | null
  created_at: DefaultTimestamp
}

// --- Stage 3 ---

/** Full player_ratings row values, stored in snapshots so a replay can restore the state before a tournament. */
export type RatingStateJson = {
  rating: number | null
  source: 'calibration' | 'rttf' | 'admin' | null
  rated_matches: number
  tournaments: number
  matches: number
  wins: number
  max_rating: number | null
  calibration: CalibrationJson
  last_rated_at: string | null
}

export interface DisputesTable {
  id: Id
  entity: string
  entity_id: string
  tournament_id: number | null
  club_id: number | null
  user_id: number
  reason: string
  status: Generated<'open' | 'resolved' | 'rejected'>
  resolution: string | null
  resolved_by: number | null
  resolved_at: Timestamp | null
  created_at: DefaultTimestamp
}

export interface NotificationsTable {
  id: Id
  user_id: number
  type: string
  data: JsonDefault<Record<string, unknown>>
  urgent: Generated<boolean>
  read_at: Timestamp | null
  created_at: DefaultTimestamp
}

export type NotifyChannel = 'push' | 'telegram' | 'email'

export interface NotificationPrefsTable {
  user_id: number
  type: string
  channel: NotifyChannel
  enabled: boolean
}

export interface NotificationLogTable {
  id: Id
  notification_id: number | null
  user_id: number
  type: string
  channel: string
  attempt: number
  status: 'sent' | 'failed' | 'skipped'
  error: string | null
  latency_ms: number | null
  created_at: DefaultTimestamp
}

export interface PushSubscriptionsTable {
  id: Id
  user_id: number
  endpoint: string
  keys: Json<{ p256dh: string; auth: string }>
  created_at: DefaultTimestamp
}

export interface TelegramAccountsTable {
  chat_id: number
  player_id: number
  username: string | null
  lang: string | null
  stopped: Generated<boolean>
  blocked_at: Timestamp | null
  created_at: DefaultTimestamp
}

export interface TelegramBindTokensTable {
  token: string
  player_id: number
  expires_at: Timestamp
}

export interface TelegramMessagesTable {
  ref: string
  chat_id: number
  message_id: number
  created_at: DefaultTimestamp
}

export interface SubscriptionsTable {
  id: Id
  user_id: number
  kind: 'club' | 'rating'
  club_id: number | null
  created_at: DefaultTimestamp
}

export interface NotificationDedupeTable {
  key: string
  created_at: DefaultTimestamp
}

// --- Stage 2 ---

export type CallAnswer = 'delivered' | 'going' | 'cannot'
export type CallResponses = Partial<Record<'home' | 'away', { answer: CallAnswer; reason?: string; at: string }>>
export type ReportedScore = { setsHome: number; setsAway: number; games: import('@nomad/engine').GameScore[] }

export interface SeriesTable {
  id: Id
  club_id: number
  name: string
  created_at: DefaultTimestamp
}

// --- Stage 6 ---

export interface RecurringBlocksTable {
  id: Id
  hall_id: number
  table_ids: ColumnType<number[], number[] | undefined, number[]>
  weekdays: ColumnType<number[], number[], number[]>
  start_minutes: number
  end_minutes: number
  valid_from: string
  valid_until: string | null
  kind: 'training' | 'closed' | 'maintenance'
  note: Generated<string>
  created_by: number | null
  created_at: DefaultTimestamp
}

export interface RatingAdjustmentsTable {
  id: Id
  player_id: number
  rating_before: number | null
  rating_after: number
  from_tournament_id: number | null
  reason: string
  created_by: number | null
  created_at: DefaultTimestamp
}
// --- Stage 5 ---

type IntArray = ColumnType<number[], number[], number[]>

export type MeetingSchemeJson = import('@nomad/engine').MeetingScheme

export interface TeamsTable {
  id: Id
  kind: 'pair' | 'team'
  name: string
  captain_player_id: number
  min_size: number
  max_size: number
  join_token: string
  approve_joins: Generated<boolean>
  payer: Generated<'captain' | 'each'>
  copied_from: number | null
  created_at: DefaultTimestamp
}

export interface TeamMembersTable {
  team_id: number
  player_id: number
  role: Generated<'captain' | 'member'>
  status: Generated<'active' | 'left'>
  joined_at: DefaultTimestamp
}

export interface TeamInvitationsTable {
  id: Id
  team_id: number
  player_id: number
  direction: 'invite' | 'request'
  status: Generated<import('@nomad/shared').InvitationStatus>
  invited_by: number | null
  expires_at: Timestamp
  responded_at: Timestamp | null
  created_at: DefaultTimestamp
}

export interface MeetingLineupsTable {
  match_id: number
  side: 'home' | 'away'
  lineup: IntArray
  submitted_by: number | null
  by_organizer: Generated<boolean>
  submitted_at: DefaultTimestamp
}

export interface MeetingGamesTable {
  id: Id
  match_id: number
  game_index: number
  kind: 'singles' | 'doubles'
  home_players: IntArray
  away_players: IntArray
  status: Generated<'scheduled' | 'called' | 'finished' | 'skipped'>
  table_id: number | null
  called_at: Timestamp | null
  sets_home: number | null
  sets_away: number | null
  games: JsonDefault<import('@nomad/engine').GameScore[]>
  winner: 'home' | 'away' | null
  finished_at: Timestamp | null
}

export type LeagueFormat = 'divisions' | 'common_tour' | 'season_rr' | 'free_dates'

export type SeasonRules = {
  boundaries?: { promote: number; relegate: number }[]
  missedRule?: 'relegate' | 'last' | 'stay'
  pointsTable?: number[]
  participationPoints?: number
  bestTours?: number | null
  minDivisionSize?: number
  playoffSize?: number
  toursPlanned?: number
  transferWindow?: { from: string; to: string } | null
  confirmBy?: string | null
  reminderHours?: number
}

export type SeasonPayment = { mode?: 'season' | 'per_tour' | 'combined'; seasonPrice?: number; tourPrice?: number; topUp?: number }

export interface LeaguesTable {
  id: Id
  club_id: number
  slug: string
  name: string
  description: Generated<string>
  format: LeagueFormat
  created_by: number | null
  created_at: DefaultTimestamp
}

export interface LeagueSeasonsTable {
  id: Id
  league_id: number
  name: string
  status: Generated<'draft' | 'registration' | 'active' | 'finished'>
  starts_on: ColumnType<Date, string, string>
  ends_on: ColumnType<Date, string, string>
  rules: JsonDefault<SeasonRules>
  payment: JsonDefault<SeasonPayment>
  previous_season_id: number | null
  created_at: DefaultTimestamp
}

export interface LeagueDivisionsTable {
  id: Id
  season_id: number
  name: string
  level: number
  merged_into: number | null
}

export interface LeagueParticipantsTable {
  id: Id
  season_id: number
  player_id: number
  division_id: number | null
  status: Generated<'invited' | 'active' | 'frozen' | 'left' | 'declined'>
  joined_tour: Generated<number>
  missed_tours: Generated<number>
  created_at: DefaultTimestamp
}

export interface LeagueToursTable {
  id: Id
  season_id: number
  number: number
  kind: Generated<'regular' | 'playoff'>
  starts_at: Timestamp
  deadline_at: Timestamp | null
  status: Generated<'planned' | 'running' | 'applied'>
  reminded_at: Timestamp | null
}

export interface LeagueResultsTable {
  tour_id: number
  participant_id: number
  division_id: number | null
  place: number | null
  points: Generated<number>
  missed: Generated<boolean>
}

export interface LeagueMovesTable {
  id: Id
  season_id: number
  tour_id: number | null
  participant_id: number
  from_division: number | null
  to_division: number | null
  reason: string
  created_at: DefaultTimestamp
}

export interface LeagueFixturesTable {
  id: Id
  season_id: number
  division_id: number | null
  home_participant: number
  away_participant: number
  round: number
  status: Generated<'pending' | 'proposed' | 'scheduled' | 'reported' | 'confirmed'>
  proposed_by: number | null
  starts_at: Timestamp | null
  table_id: number | null
  booking_id: number | null
  deadline_at: Timestamp | null
  sets_home: number | null
  sets_away: number | null
  reported_by: number | null
  created_at: DefaultTimestamp
}
