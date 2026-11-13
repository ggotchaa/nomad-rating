import { t } from '../../i18n/index.ts'

export type NotificationItem = { id: number; type: string; data: Record<string, unknown>; urgent: boolean; read: boolean; createdAt: string }

export type NotifySettings = {
  types: { type: string; defaults: string[]; mandatoryInTournament: boolean }[]
  channels: string[]
  prefs: { type: string; channel: string; enabled: boolean }[]
  push: { enabled: boolean; publicKey: string | null; devices: number }
  telegram: { enabled: boolean; bot: string | null; max: number; accounts: { chatId: string; username: string | null; stopped: boolean; blocked: boolean }[] }
  subscriptions: { id: number; kind: 'club' | 'rating'; clubId: number | null; club: string | null }[]
}

const s = (v: unknown) => (v == null ? '' : String(v))

/** Short line for the inbox: the type plus the most useful detail. */
export function describe(n: NotificationItem): { title: string; text: string; link: string | null } {
  const d = n.data
  const title = s(d.tournamentTitle || d.title)
  const link = d.slug ? (n.type === 'match_call' ? `/me/t/${s(d.slug)}` : `/t/${s(d.slug)}`) : null
  switch (n.type) {
    case 'match_call':
      return { title: `${t.notif.types.match_call}${d.table ? ` · ${t.rating2.table.toLowerCase()} ${s(d.table)}` : ''}`, text: [title, d.opponent && `${t.rating2.opponent}: ${s(d.opponent)}`].filter(Boolean).join(' · '), link }
    case 'calibration_done':
      return {
        title: `${t.notif.types.calibration_done}: ${s(d.rating)}`,
        text:
          d.bestWin != null && d.worstLoss != null
            ? `(${s(d.bestWin)} + ${s(d.worstLoss)}) / 2 = ${s(d.rating)}`
            : d.bestWin != null
              ? `${s(d.bestWin)} + 100 = ${s(d.rating)}`
              : `${s(d.worstLoss)} − 100 = ${s(d.rating)}`,
        link: null,
      }
    case 'tournament_results':
      return { title: `${t.notif.types.tournament_results}: ${title}`, text: `${t.t.place}: ${s(d.place) || '—'}${d.delta != null ? ` · ${Number(d.delta) > 0 ? '+' : ''}${s(d.delta)}` : ''}`, link }
    case 'tournament_reminder':
      return { title: `${title}`, text: `${s(d.hours)} ${t.common.hoursShort} · ${s(d.startsAtText)}`, link }
    case 'dispute_update':
      return { title: t.notif.types.dispute_update ?? '', text: s(d.resolution) || s(d.status), link: null }
    default:
      return { title: t.notif.types[n.type] ?? n.type, text: [title, s(d.division), s(d.club), s(d.startsAtText)].filter(Boolean).join(' · '), link }
  }
}
