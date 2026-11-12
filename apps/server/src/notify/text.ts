// Message texts for push / Telegram / e-mail (RU; KK and EN come with the translations stage).

import { config } from '../config.ts'

export type Rendered = { title: string; body: string; url: string }

const s = (v: unknown) => (v == null ? '' : String(v))

/** Admin-edited templates (platform setting `notify_templates`): `{field}` is replaced by the event data. */
let overrides: Record<string, { title?: string; body?: string }> = {}
export const setTemplateOverrides = (value: typeof overrides) => void (overrides = value ?? {})
const fill = (tpl: string, data: Record<string, unknown>) => tpl.replace(/\{(\w+)\}/g, (_, k: string) => s(data[k]))

export function render(type: string, data: Record<string, unknown>): Rendered {
  const base = renderDefault(type, data)
  const o = overrides[type]
  return o ? { ...base, title: o.title ? fill(o.title, data) : base.title, body: o.body ? fill(o.body, data) : base.body } : base
}

function renderDefault(type: string, data: Record<string, unknown>): Rendered {
  const site = config.SITE_URL.replace(/\/$/, '')
  const tUrl = data.slug ? `${site}/t/${s(data.slug)}` : `${site}/me`
  const title = s(data.tournamentTitle || data.title)
  switch (type) {
    case 'match_call':
      return {
        title: `Вызов на матч${data.table ? ` · стол ${s(data.table)}` : ''}`,
        body: [
          title,
          data.matchNumber ? `Матч №${s(data.matchNumber)}` : '',
          data.opponent ? `Соперник: ${s(data.opponent)}` : '',
          data.table ? `Стол: ${s(data.table)}` : '',
          data.respondBy ? `Подойдите до ${new Date(s(data.respondBy)).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Almaty' })}` : '',
        ]
          .filter(Boolean)
          .join('\n'),
        url: data.slug ? `${site}/me/t/${s(data.slug)}` : tUrl,
      }
    case 'waitlist_invited':
      return { title: 'Освободилось место', body: `${title}\nПодтвердите участие в течение ${s(data.minutes || 30)} мин.`, url: tUrl }
    case 'tournament_cancelled':
      return { title: 'Турнир отменён', body: [title, s(data.reason)].filter(Boolean).join('\n'), url: tUrl }
    case 'tournament_reminder':
      return { title: `Турнир через ${s(data.hours)} ч`, body: `${title}\nНачало: ${s(data.startsAtText)}`, url: tUrl }
    case 'tournament_results':
      return {
        title: 'Итоги турнира',
        body: `${title}\nМесто: ${s(data.place) || '—'}${data.delta != null ? ` · рейтинг ${Number(data.delta) > 0 ? '+' : ''}${s(data.delta)}` : ''}`,
        url: tUrl,
      }
    case 'calibration_done':
      return {
        title: `Калибровка завершена: рейтинг ${s(data.rating)}`,
        body:
          data.bestWin != null && data.worstLoss != null
            ? `(лучшая победа ${s(data.bestWin)} + худшее поражение ${s(data.worstLoss)}) / 2 = ${s(data.rating)}`
            : data.bestWin != null
              ? `Лучшая победа ${s(data.bestWin)} + 100 = ${s(data.rating)}`
              : `Худшее поражение ${s(data.worstLoss)} − 100 = ${s(data.rating)}`,
        url: data.playerId ? `${site}/players/${s(data.playerId)}` : `${site}/me`,
      }
    case 'new_tournament':
      return { title: 'Новый турнир для вас', body: `${title}\n${s(data.club)} · ${s(data.startsAtText)}`, url: tUrl }
    case 'dispute_update':
      return { title: 'Ответ по спорному счёту', body: s(data.resolution) || s(data.status), url: `${site}/me` }
    case 'booking_confirmed':
      return { title: `Бронь подтверждена · стол ${s(data.table)}`, body: `${s(data.club)}, ${s(data.startsAtText)}\nОплата в клубе: ${Math.round(Number(data.price ?? 0) / 100)} ₸\nОтменить: ${s(data.cancelUrl)}`, url: s(data.cancelUrl) || `${site}/me` }
    case 'booking_reminder':
      return { title: `Через час: стол ${s(data.table)}`, body: `${s(data.club)}, ${s(data.address)}\n${s(data.startsAtText)}`, url: s(data.cancelUrl) || `${site}/me` }
    case 'booking_moved':
      return { title: 'Бронь перенесена', body: `${s(data.club)}: стол ${s(data.table)}, ${s(data.startsAtText)}`, url: s(data.cancelUrl) || `${site}/me` }
    case 'booking_cancelled':
      return { title: 'Бронь отменена клубом', body: [`${s(data.club)}: стол ${s(data.table)}, ${s(data.startsAtText)}`, s(data.reason)].filter(Boolean).join('\n'), url: `${site}/me` }
    default:
      return { title: 'Nomad', body: s(data.text) || type, url: `${site}/me` }
  }
}
