import { useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router'
import { api } from '../../api/client.ts'
import { useSession } from '../../app/auth.tsx'
import { useApi } from '../../app/hooks.ts'
import { errorText, t } from '../../i18n/index.ts'
import { formatDateTime } from '../../i18n/format.ts'
import { Async } from '../../ui/kit.tsx'
import { describe } from './model.ts'
import type { NotificationItem, NotifySettings } from './model.ts'
import { currentSubscription, disablePush, enablePush, isIos, isStandalone, pushSupported } from './push.ts'

export function Notifications() {
  const { me, ready } = useSession()
  const list = useApi<{ unread: number; items: NotificationItem[] }>(me.user ? '/notifications?limit=100' : null)
  const settings = useApi<NotifySettings>(me.user ? '/notifications/settings' : null)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  if (ready && !me.user) return <Navigate to="/login" replace />

  const run = async (fn: () => Promise<unknown>, done?: string) => {
    setError(null)
    setInfo(null)
    try {
      await fn()
      if (done) setInfo(done)
      settings.reload()
      list.reload()
    } catch (e) {
      setError(errorText(e))
    }
  }

  return (
    <main className="page">
      <header className="pagehead">
        <Link className="crumb" to="/me">
          ← {t.nav.cabinet}
        </Link>
        <h1>{t.notif.title}</h1>
      </header>
      {error && <p className="note note--error">{error}</p>}
      {info && <p className="note">{info}</p>}
      <div className="grid grid--half">
        <section className="panel">
          <div className="panel__head">
            <h2>{t.notif.all}</h2>
            <div className="row">
              <button className="button button--sm" onClick={() => void run(() => api('/notifications/read', { method: 'POST', json: {} }))}>
                {t.notif.readAll}
              </button>
            </div>
          </div>
          <Async state={list}>
            {(data) =>
              data.items.length ? (
                <ul className="notiflist">
                  {data.items.map((n) => {
                    const d = describe(n)
                    return (
                      <li key={n.id} className={n.read ? '' : 'is-unread'}>
                        <div>
                          <b>{d.link ? <Link to={d.link}>{d.title}</Link> : d.title}</b>
                          {d.text && <div className="small">{d.text}</div>}
                        </div>
                        <time className="mono small muted">{formatDateTime(n.createdAt)}</time>
                      </li>
                    )
                  })}
                </ul>
              ) : (
                <p className="empty">{t.notif.empty}</p>
              )
            }
          </Async>
        </section>
        <Async state={settings}>
          {(s) => (
            <div className="stack">
              <PushPanel s={s} run={run} />
              <TelegramPanel s={s} run={run} />
              <section className="panel">
                <h2>{t.notif.settings}</h2>
                <div className="tablewrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th />
                        {s.channels.map((c) => (
                          <th key={c} className="num">
                            {t.notif.channels[c]}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {s.types.map((ty) => (
                        <tr key={ty.type}>
                          <td>
                            {t.notif.types[ty.type] ?? ty.type}
                            {ty.mandatoryInTournament && <div className="small muted">{t.notif.mandatory}</div>}
                          </td>
                          {s.channels.map((c) => {
                            const pref = s.prefs.find((p) => p.type === ty.type && p.channel === c)
                            const on = pref ? pref.enabled : ty.defaults.includes(c)
                            const locked = c === 'email' && ty.type === 'match_call'
                            return (
                              <td key={c} className="num">
                                <input
                                  type="checkbox"
                                  aria-label={`${t.notif.types[ty.type]} · ${t.notif.channels[c]}`}
                                  checked={on && !locked}
                                  disabled={locked}
                                  onChange={(e) => void run(() => api('/notifications/prefs', { method: 'PUT', json: { type: ty.type, channel: c, enabled: e.target.checked } }))}
                                />
                              </td>
                            )
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
              <section className="panel">
                <h2>{t.notif.subs}</h2>
                <SubRow
                  label={t.notif.subRating}
                  sub={s.subscriptions.find((x) => x.kind === 'rating')}
                  onAdd={() => run(() => api('/notifications/subscriptions', { method: 'POST', json: { kind: 'rating' } }))}
                  onRemove={(id) => run(() => api(`/notifications/subscriptions/${id}`, { method: 'DELETE' }))}
                />
                {s.subscriptions
                  .filter((x) => x.kind === 'club')
                  .map((x) => (
                    <SubRow key={x.id} label={t.notif.subClub(x.club ?? '')} sub={x} onAdd={async () => undefined} onRemove={(id) => run(() => api(`/notifications/subscriptions/${id}`, { method: 'DELETE' }))} />
                  ))}
              </section>
            </div>
          )}
        </Async>
      </div>
    </main>
  )
}

function SubRow({ label, sub, onAdd, onRemove }: { label: string; sub?: { id: number }; onAdd: () => Promise<unknown>; onRemove: (id: number) => Promise<unknown> }) {
  return (
    <div className="row row--between">
      <span>{label}</span>
      {sub ? (
        <button className="button button--sm" onClick={() => void onRemove(sub.id)}>
          {t.notif.unsubscribe}
        </button>
      ) : (
        <button className="button button--sm button--primary" onClick={() => void onAdd()}>
          {t.notif.subscribe}
        </button>
      )}
    </div>
  )
}

type Run = (fn: () => Promise<unknown>, done?: string) => Promise<void>

function PushPanel({ s, run }: { s: NotifySettings; run: Run }) {
  const [active, setActive] = useState<boolean | null>(null)
  useEffect(() => {
    void currentSubscription().then((sub) => setActive(Boolean(sub)))
  }, [s.push.devices])
  let body
  if (!pushSupported) body = <p className="muted small">{t.notif.pushUnsupported}</p>
  else if (!s.push.enabled || !s.push.publicKey) body = <p className="muted small">{t.notif.pushDisabled}</p>
  else if (Notification.permission === 'denied') body = <p className="muted small">{t.notif.pushDenied}</p>
  else if (active)
    body = (
      <div className="row row--between">
        <span className="chip chip--ok">{t.notif.pushActive}</span>
        <button className="button button--sm" onClick={() => void run(disablePush)}>
          {t.notif.pushOff}
        </button>
      </div>
    )
  else
    body = (
      <button className="button button--sm button--primary" onClick={() => void run(() => enablePush(s.push.publicKey!))}>
        {t.notif.pushOn}
      </button>
    )
  return (
    <section className="panel">
      <h2>{t.notif.pushTitle}</h2>
      {body}
      {isIos && !isStandalone && <p className="note small">{t.notif.iosHint}</p>}
    </section>
  )
}

function TelegramPanel({ s, run }: { s: NotifySettings; run: Run }) {
  const { me } = useSession()
  const connect = () =>
    run(async () => {
      const { url } = await api<{ url: string }>('/notifications/telegram/link', { method: 'POST', json: {} })
      window.open(url, '_blank', 'noopener')
    })
  return (
    <section className="panel">
      <h2>{t.tg.title}</h2>
      {!s.telegram.enabled ? (
        <p className="muted small">{t.tg.disabled}</p>
      ) : (
        <>
          <p className="small muted">{t.tg.accounts(s.telegram.accounts.length, s.telegram.max)}</p>
          {s.telegram.accounts.map((a) => (
            <div className="row row--between" key={a.chatId}>
              <span>
                {a.username ? `@${a.username}` : a.chatId} {a.blocked && <span className="chip chip--bad">{t.tg.blocked}</span>} {a.stopped && <span className="chip chip--warn">{t.tg.stopped}</span>}
              </span>
              <button className="button button--sm" onClick={() => void run(() => api(`/notifications/telegram/${a.chatId}`, { method: 'DELETE' }))}>
                {t.tg.remove}
              </button>
            </div>
          ))}
          {me.player && s.telegram.accounts.length < s.telegram.max && (
            <>
              <button className="button button--sm button--primary" onClick={() => void connect()}>
                {t.tg.connect}
              </button>
              <p className="small muted">{t.tg.hint}</p>
            </>
          )}
        </>
      )}
    </section>
  )
}
