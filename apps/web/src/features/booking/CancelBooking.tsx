import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { api } from '../../api/client.ts'
import { useApi } from '../../app/hooks.ts'
import { errorText, t } from '../../i18n/index.ts'
import { formatDate, formatTenge, formatTime } from '../../i18n/format.ts'
import { Async } from '../../ui/kit.tsx'

type ByToken = { id: number; status: string; start: string; end: string; price: number; tableNumber: number; address: string; club: string; clubSlug: string; freeCancellation: boolean }

/** Cancel link from the confirmation message: works without signing in. */
export function CancelBooking() {
  const { token } = useParams()
  const state = useApi<ByToken>(`/bookings/token/${token}`)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const cancel = async () => {
    setBusy(true)
    setError(null)
    try {
      await api(`/bookings/token/${token}/cancel`, { method: 'POST' })
      state.reload()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <main className="page">
      <header className="pagehead">
        <h1>{t.bk2.cancelTitle}</h1>
      </header>
      <Async state={state}>
        {(b) => (
          <section className="panel">
            <span className="chip">{t.b.status[b.status] ?? b.status}</span>
            <h2>
              <Link to={`/club/${b.clubSlug}`}>{b.club}</Link> · {t.me.table} {b.tableNumber}
            </h2>
            <p>
              {formatDate(b.start)}, {formatTime(b.start)}–{formatTime(b.end)} · {formatTenge(b.price)} · {t.b.payAtClub.toLowerCase()}
            </p>
            <p className="muted">{b.address}</p>
            {['held', 'confirmed'].includes(b.status) ? (
              <>
                <p className="note">{b.freeCancellation ? t.bk2.free : t.bk2.late}</p>
                <button className="button button--danger" disabled={busy} onClick={() => void cancel()}>
                  {t.bk2.cancelBtn}
                </button>
              </>
            ) : (
              b.status === 'cancelled_by_player' && <p className="note note--ok">{t.bk2.cancelled}</p>
            )}
            {error && <p className="note note--error">{error}</p>}
          </section>
        )}
      </Async>
    </main>
  )
}
