import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { api } from '../../api/client.ts'
import { useSession } from '../../app/auth.tsx'
import { useApi, useRoom, useStored } from '../../app/hooks.ts'
import { t } from '../../i18n/index.ts'
import { formatDateTime } from '../../i18n/format.ts'
import { describe } from './model.ts'
import type { NotificationItem, NotifySettings } from './model.ts'
import { enablePush, isIos, isStandalone, pushSupported } from './push.ts'

export function NotificationBell() {
  const { me } = useSession()
  const userId = me.user?.id ?? null
  const [open, setOpen] = useState(false)
  const list = useApi<{ unread: number; items: NotificationItem[] }>(userId ? '/notifications?limit=8' : null)
  useRoom(userId ? `user:${userId}` : null, (type) => type === 'notification' && list.reload())
  const box = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false)
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  if (!userId) return null
  const unread = list.data?.unread ?? 0
  const readAll = async () => {
    await api('/notifications/read', { method: 'POST', json: {} })
    list.reload()
  }
  const go = async (n: NotificationItem, link: string | null) => {
    if (!n.read) await api('/notifications/read', { method: 'POST', json: { ids: [n.id] } }).catch(() => undefined)
    setOpen(false)
    list.reload()
    navigate(link ?? '/notifications')
  }

  return (
    <div className="bell" ref={box}>
      <button className="bell__btn" aria-label={`${t.notif.bell}${unread ? `: ${unread}` : ''}`} aria-expanded={open} onClick={() => setOpen(!open)}>
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path d="M12 3a6 6 0 0 0-6 6v3.5L4.5 16h15L18 12.5V9a6 6 0 0 0-6-6Zm-2 15a2 2 0 0 0 4 0" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
        </svg>
        {unread > 0 && <span className="bell__count">{unread > 99 ? '99+' : unread}</span>}
      </button>
      {open && (
        <div className="bell__pop" role="dialog" aria-label={t.notif.title}>
          <div className="row row--between">
            <b>{t.notif.title}</b>
            {unread > 0 && (
              <button className="linkbtn small" onClick={() => void readAll()}>
                {t.notif.readAll}
              </button>
            )}
          </div>
          {list.data?.items.length ? (
            <ul className="bell__list">
              {list.data.items.map((n) => {
                const d = describe(n)
                return (
                  <li key={n.id} className={n.read ? '' : 'is-unread'}>
                    <button onClick={() => void go(n, d.link)}>
                      <b>{d.title}</b>
                      {d.text && <span>{d.text}</span>}
                      <time className="mono small muted">{formatDateTime(n.createdAt)}</time>
                    </button>
                  </li>
                )
              })}
            </ul>
          ) : (
            <p className="empty small">{t.notif.empty}</p>
          )}
          <Link className="crumb" to="/notifications" onClick={() => setOpen(false)}>
            {t.notif.all} →
          </Link>
        </div>
      )}
      <PushPrompt />
    </div>
  )
}

/** One-time offer to enable push on this device (shown after sign-in / registration). */
function PushPrompt() {
  const [asked, setAsked] = useStored('nomad.pushPrompt', '')
  const eligible = !asked && pushSupported && Notification.permission === 'default'
  const settings = useApi<NotifySettings>(eligible ? '/notifications/settings' : null)
  if (!eligible || !settings.data?.push.enabled || !settings.data.push.publicKey) return null
  const key = settings.data.push.publicKey
  return (
    <div className="bell__prompt" role="dialog">
      <p className="small">{t.notif.prompt}</p>
      {isIos && !isStandalone && <p className="small muted">{t.notif.iosHint}</p>}
      <div className="row">
        <button className="button button--sm button--primary" onClick={() => void enablePush(key).finally(() => setAsked('1'))}>
          {t.notif.promptYes}
        </button>
        <button className="button button--sm" onClick={() => setAsked('1')}>
          {t.notif.promptNo}
        </button>
      </div>
    </div>
  )
}
