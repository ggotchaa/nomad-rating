import { describe, expect, it, vi } from 'vitest'

vi.mock('../config.ts', () => ({ config: { SITE_URL: 'https://x.kz' } }))
import { NOTIFY_TYPES } from './prefs.ts'
import { LANGS, render } from './text.ts'

describe('notification texts', () => {
  it('every configurable type has its own text in every language', () => {
    for (const type of Object.keys(NOTIFY_TYPES)) {
      const titles = LANGS.map((lang) => render(type, { title: 'X', table: 3, status: 'accepted' }, lang).title)
      expect(titles.every((t) => t && t !== 'Nomad'), type).toBe(true)
      expect(new Set(titles).size, type).toBe(LANGS.length)
    }
  })
})
