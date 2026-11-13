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

  it('call message carries table, opponent rating and link, stage, response time and answer', () => {
    const d = { title: 'Кубок', table: 5, opponent: 'Сейтов Арман', opponentId: 7, opponentRating: 1240, stage: 'Основная сетка', round: '1/4', minutes: 5, answer: 'going' }
    const r = render('match_call', d, 'ru')
    expect(r.body).toContain('Соперник: Сейтов Арман (рейтинг 1240)')
    expect(r.body).toContain('Этап: Основная сетка, 1/4 финала')
    expect(r.body).toContain('в течение 5 мин')
    expect(r.body).toContain('Ваш ответ: Иду')
    expect(r.bodyHtml).toContain('<a href="https://x.kz/players/7">Сейтов Арман</a>')
    expect(render('match_call', { stage: 'Группы', group: 'C', tour: 2 }, 'kk').body).toContain('Кезең: Группы, C тобы, 2-тур')
  })
})
