import type { NotifyChannel } from '../db/types.ts'

export const CHANNELS: readonly NotifyChannel[] = ['push', 'telegram', 'email']

/** Event types the user can configure, with their default channels. */
export const NOTIFY_TYPES: Record<string, { channels: NotifyChannel[]; mandatoryInTournament?: boolean }> = {
  match_call: { channels: ['push', 'telegram'], mandatoryInTournament: true },
  waitlist_invited: { channels: ['push', 'telegram', 'email'] },
  tournament_cancelled: { channels: ['push', 'telegram', 'email'] },
  tournament_reminder: { channels: ['push', 'telegram'] },
  tournament_results: { channels: ['push', 'telegram', 'email'] },
  calibration_done: { channels: ['push', 'telegram', 'email'] },
  new_tournament: { channels: ['telegram', 'email'] },
  dispute_update: { channels: ['push', 'email'] },
  booking_confirmed: { channels: ['push', 'telegram'] },
  booking_reminder: { channels: ['push', 'telegram'] },
  booking_moved: { channels: ['push', 'telegram', 'email'] },
  booking_cancelled: { channels: ['push', 'telegram', 'email'] },
  team_invitation: { channels: ['push', 'telegram', 'email'] },
  team_request: { channels: ['push', 'telegram'] },
  team_invitation_answer: { channels: ['push', 'telegram'] },
  team_captain: { channels: ['push', 'telegram'] },
  team_roster_short: { channels: ['push', 'telegram', 'email'] },
  league_move: { channels: ['push', 'telegram', 'email'] },
  league_confirm: { channels: ['push', 'telegram', 'email'] },
  league_fixture: { channels: ['push', 'telegram'] },
  league_reminder: { channels: ['push', 'telegram'] },
  league_lineup: { channels: ['push', 'telegram'] },
  league_tour_results: { channels: ['push', 'telegram'] },
  league_no_shows: { channels: ['push', 'telegram'] },
  lineup_overdue: { channels: ['push', 'telegram'] },
  score_confirm: { channels: ['push', 'telegram'] },
  match_next: { channels: ['push', 'telegram'] },
  match_table_changed: { channels: ['push', 'telegram'], mandatoryInTournament: true },
  match_call_cancelled: { channels: ['push', 'telegram'] },
  registration_confirmed: { channels: ['push', 'telegram', 'email'] },
  telegram_linked: { channels: ['push', 'telegram', 'email'] },
  telegram_moved: { channels: ['push', 'email'] },
  tournament_venue_changed: { channels: ['push', 'telegram', 'email'] },
  player_busy: { channels: ['push', 'telegram'] },
  tournament_underfilled: { channels: ['push', 'telegram', 'email'] },
}

const FALLBACK: NotifyChannel[] = ['push', 'telegram']

/**
 * Channels for one notification: defaults of the type, overridden by the user's prefs.
 * E-mail never carries urgent events; a call cannot be switched off while the user plays a tournament.
 */
export function resolveChannels(
  type: string,
  prefs: readonly { type: string; channel: NotifyChannel; enabled: boolean }[],
  ctx: { urgent: boolean; inActiveTournament: boolean },
): NotifyChannel[] {
  const def = NOTIFY_TYPES[type]
  const defaults = def?.channels ?? FALLBACK
  return CHANNELS.filter((channel) => {
    if (channel === 'email' && ctx.urgent) return false
    if (def?.mandatoryInTournament && ctx.inActiveTournament && channel !== 'email') return defaults.includes(channel)
    const pref = prefs.find((p) => p.type === type && p.channel === channel)
    return pref ? pref.enabled : defaults.includes(channel)
  })
}
