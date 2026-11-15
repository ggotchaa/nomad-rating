import { useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { api } from '../../api/client.ts'
import type { MyBooking } from '../../api/types.ts'
import { useSession } from '../../app/auth.tsx'
import { useApi } from '../../app/hooks.ts'
import { errorText, t } from '../../i18n/index.ts'
import { formatDate, formatTenge, formatTime } from '../../i18n/format.ts'
import { Async } from '../../ui/kit.tsx'
import { ask } from '../../ui/dialogs.tsx'

export const BOOKING_TONE: Record<string, string> = {
  confirmed: 'chip--ok',
  arrived: 'chip--ok',
  no_show: 'chip--bad',
  cancelled_by_player: '',
  cancelled_by_club: 'chip--bad',
}

/** My bookings with cancellation — the cabinet and the booking page share it. */
export function MyBookings({ title, footer }: { title?: string; footer?: ReactNode }) {
  const { me } = useSession()
  const bookings = useApi<MyBooking[]>(me.player ? '/my/bookings' : null)
  const [error, setError] = useState<string | null>(null)
  if (!me.player) return null

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
    <section className="panel">
      <div className="panel__head">
        <h2>{title ?? t.bookIdx.mine}</h2>
        {footer}
      </div>
      {error && <p className="note note--error">{error}</p>}
      <Async state={bookings}>
        {(rows) =>
          rows.length ? (
            <>
              <div className="linklist">
                {rows.map((b) => (
                  <div
                    className="row row--between"
                    key={b.id}
                    style={{ padding: '10px 0', borderBottom: '1px solid var(--line)' }}
                  >
                    <div>
                      <b>
                        {formatDate(b.starts_at)}, {formatTime(b.starts_at)}–{formatTime(b.ends_at)}
                      </b>
                      <div className="small muted">
                        <Link to={`/club/${b.club_slug}`}>{b.club}</Link> · {t.me.table} {b.table_number} ·{' '}
                        {formatTenge(b.price)}
                      </div>
                    </div>
                    <div className="row">
                      <span className={`chip ${BOOKING_TONE[b.status] ?? ''}`}>{t.b.status[b.status] ?? b.status}</span>
                      {b.status === 'confirmed' && new Date(b.starts_at) > new Date() && (
                        <>
                          <Link className="button button--sm" to={`/club/${b.club_slug}/booking`}>
                            {t.bookIdx.rebook}
                          </Link>
                          <button className="button button--sm button--danger" onClick={() => void cancel(b.id)}>
                            {t.me.cancelBooking}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <p className="small muted">{t.bookIdx.mineHint}</p>
            </>
          ) : (
            <p className="empty">{t.bookIdx.mineEmpty}</p>
          )
        }
      </Async>
    </section>
  )
}
