import { useState } from 'react'
import { Link, Navigate } from 'react-router'
import { api } from '../../api/client.ts'
import type { MyBooking, MyEntry } from '../../api/types.ts'
import { useSession } from '../../app/auth.tsx'
import { useApi } from '../../app/hooks.ts'
import { errorText, t } from '../../i18n/index.ts'
import { formatDate, formatDateTime, formatTenge, formatTime } from '../../i18n/format.ts'
import { Async, StatusChip } from '../../ui/kit.tsx'
import { LiveDeltas } from '../rating/widgets.tsx'
import { ask } from '../../ui/dialogs.tsx'

const BOOKING_TONE: Record<string, string> = { confirmed: 'chip--ok', arrived: 'chip--ok', no_show: 'chip--bad', cancelled_by_player: '', cancelled_by_club: 'chip--bad' }

export function Cabinet() {
  const { me, ready } = useSession()
  const entries = useApi<MyEntry[]>(me.player ? '/my/entries' : null)
  const bookings = useApi<MyBooking[]>(me.player ? '/my/bookings' : null)
  const [error, setError] = useState<string | null>(null)

  if (ready && !me.user) return <Navigate to="/login" replace />
  if (!me.player) return <main className="page">{ready && <p className="note">{t.errors['player.profile_required']}</p>}</main>

  const cancel = async (id: number) => {
    if (!(await ask.confirm(t.me.cancelBookingConfirm))) return
    setError(null)
    try {
      await api(`/bookings/${id}`, { method: 'DELETE' })
      bookings.reload()
    } catch (e) {
      setError(errorText(e))
    }
  }

  return (
    <main className="page">
      <header className="pagehead">
        <h1>{t.me.title}</h1>
        <p>
          {me.player.last_name} {me.player.first_name} · {me.player.city} · {t.p.rating.toLowerCase()} <b style={{ color: 'var(--holo)' }}>{me.player.rating ?? `— (${t.t.calibrating})`}</b>
        </p>
        <div className="row">
          <Link className="button button--sm" to={`/players/${me.player.id}`}>
            {t.me.profile}
          </Link>
          <Link className="button button--sm" to="/notifications">
            {t.notif.settings}
          </Link>
          <Link className="button button--sm" to="/me/teams">
            {t.teams.title}
          </Link>
          <Link className="button button--sm" to="/me/profile">
            {t.acc.profileEdit}
          </Link>
          <Link className="button button--sm" to="/me/security">
            {t.acc.security}
          </Link>
          <Link className="button button--sm" to="/me/rttf">
            {t.rttf.title}
          </Link>
          <Link className="button button--sm" to="/clubs/new">
            {t.clubreg.cta}
          </Link>
        </div>
      </header>
      <LiveDeltas />
      <div className="grid grid--half">
        <section className="panel">
          <h2>{t.me.entries}</h2>
          <Async state={entries}>
            {(rows) =>
              rows.length ? (
                <div className="linklist">
                  {rows.map((e) => (
                    <Link key={e.id} to={`/t/${e.slug}`}>
                      <div>
                        <b>{e.title}</b>
                        <span>
                          {formatDateTime(e.starts_at)} · {e.club}
                        </span>
                      </div>
                      <div className="stack" style={{ justifyItems: 'end' }}>
                        <StatusChip status={e.tournament_status} />
                        <span className="chip">{e.final_place ? `${t.t.place}: ${e.final_place}` : (t.t.entryStatus[e.status] ?? e.status)}</span>
                      </div>
                    </Link>
                  ))}
                </div>
              ) : (
                <p className="empty">{t.me.noEntries}</p>
              )
            }
          </Async>
        </section>
        <section className="panel">
          <div className="panel__head">
            <h2>{t.me.bookings}</h2>
            <Link className="crumb" to="/clubs">
              {t.c.book} →
            </Link>
          </div>
          {error && <p className="note note--error">{error}</p>}
          <Async state={bookings}>
            {(rows) =>
              rows.length ? (
                <div className="stack">
                  {rows.map((b) => (
                    <div className="row row--between" key={b.id} style={{ borderBottom: '1px solid rgba(94,242,255,.07)', paddingBottom: 10 }}>
                      <div>
                        <b>
                          {formatDate(b.starts_at)}, {formatTime(b.starts_at)}–{formatTime(b.ends_at)}
                        </b>
                        <div className="small muted">
                          <Link to={`/club/${b.club_slug}`}>{b.club}</Link> · {t.me.table} {b.table_number} · {formatTenge(b.price)}
                        </div>
                      </div>
                      <div className="row">
                        <span className={`chip ${BOOKING_TONE[b.status] ?? ''}`}>{t.b.status[b.status] ?? b.status}</span>
                        {b.status === 'confirmed' && new Date(b.starts_at) > new Date() && (
                          <button className="button button--sm button--danger" onClick={() => void cancel(b.id)}>
                            {t.me.cancelBooking}
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="empty">{t.me.noBookings}</p>
              )
            }
          </Async>
        </section>
      </div>
    </main>
  )
}
