// Shared domain vocabulary used by the API, the engine and the web app.

export const LOCALES = ['ru', 'kk', 'en'] as const
export type Locale = (typeof LOCALES)[number]

export const GENDERS = ['m', 'f'] as const
export type Gender = (typeof GENDERS)[number]

export const HANDS = ['right', 'left'] as const
export type Hand = (typeof HANDS)[number]

export const TOURNAMENT_TYPES = ['singles', 'doubles', 'team'] as const
export type TournamentType = (typeof TOURNAMENT_TYPES)[number]

export const RATING_KINDS = ['singles', 'doubles'] as const
export type RatingKind = (typeof RATING_KINDS)[number]

/** Start levels (spec 5). Used for seeding and eligibility while a player is calibrating. */
export const START_LEVELS = {
  novice: 800,
  amateur: 1000,
  experienced: 1200,
  advanced: 1400,
  ranked: 1600, // «разрядник», confirmed by an organiser
} as const
export type StartLevel = keyof typeof START_LEVELS

/** Club rights (spec 2). The organiser has all of them; a helper only the ticked ones. */
export const CLUB_RIGHTS = [
  'club', // Клуб и залы
  'tournaments', // Турниры, лиги, сезоны
  'conduct', // Проведение
  'score_fix', // Исправление счёта
  'players', // Игроки, импорт
  'bookings', // Брони
  'refunds', // Возвраты
  'finance', // Финансы (просмотр)
] as const
export type ClubRight = (typeof CLUB_RIGHTS)[number]
/** Rights that a helper can never receive. */
export const ORGANIZER_ONLY = ['requisites', 'payouts', 'helpers'] as const

export const RIGHT_TEMPLATES: Record<string, ClubRight[]> = {
  referee: ['conduct'],
  hall_admin: ['bookings', 'players'],
  tournament_manager: ['tournaments', 'conduct', 'score_fix', 'players'],
  accountant: ['finance'],
}

export type PlatformRole = 'user' | 'admin'
export type ClubRole = 'organizer' | 'helper'
