import { describe, expect, it } from 'vitest'
import { resolveChannels } from './prefs.ts'

describe('notification channel rules', () => {
  it('user prefs override defaults; urgent events never go by e-mail', () => {
    const prefs = [
      { type: 'tournament_results', channel: 'push' as const, enabled: false },
      { type: 'match_call', channel: 'email' as const, enabled: true },
    ]
    expect(resolveChannels('tournament_results', prefs, { urgent: false, inActiveTournament: false })).toEqual(['telegram', 'email'])
    expect(resolveChannels('match_call', prefs, { urgent: true, inActiveTournament: false })).toEqual(['push', 'telegram'])
  })

  it('a call cannot be disabled during an active tournament, but can outside it', () => {
    const off = [
      { type: 'match_call', channel: 'push' as const, enabled: false },
      { type: 'match_call', channel: 'telegram' as const, enabled: false },
    ]
    expect(resolveChannels('match_call', off, { urgent: true, inActiveTournament: true })).toEqual(['push', 'telegram'])
    expect(resolveChannels('match_call', off, { urgent: true, inActiveTournament: false })).toEqual([])
  })
})
