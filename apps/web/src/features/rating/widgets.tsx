import { useState } from 'react'
import { Link } from 'react-router'
import { api } from '../../api/client.ts'
import { useSession } from '../../app/auth.tsx'
import { useApi, useRoom } from '../../app/hooks.ts'
import { errorText, t } from '../../i18n/index.ts'
import { Delta } from '../../ui/kit.tsx'
import { ask } from '../../ui/dialogs.tsx'

/** «Рейтинг обновляется» while a replay after a correction runs. */
export function RecalcBanner() {
  const status = useApi<{ running: boolean }>('/rating/status')
  useRoom('rating', status.reload)
  return status.data?.running ? <p className="note">{t.rating2.updating}</p> : null
}

export const CalibratingMark = () => (
  <span className="chip chip--warn chip--mark" title={t.rating2.calibratingTitle} aria-label={t.rating2.calibratingTitle}>
    {t.rating2.calibratingMark}
  </span>
)

/** «К» and the start level next to a calibrating player's name. */
export const CalibTag = ({ e }: { e: { calibrating?: boolean; startLevel?: number } | null | undefined }) =>
  e?.calibrating ? (
    <>
      {' '}
      <CalibratingMark />
      {e.startLevel != null && (
        <span className="muted small mono" title={t.misc.startLevel}>
          {' '}
          {e.startLevel}
        </span>
      )}
    </>
  ) : null

/** Cabinet: tournaments I am playing right now with the preliminary delta. */
export function LiveDeltas() {
  const { me } = useSession()
  const rows = useApi<{ tournamentId: number; slug: string; title: string; delta: number }[]>(me.player ? '/rating/me/live' : null)
  if (!rows.data?.length) return null
  return (
    <section className="panel">
      <h2>{t.rating2.live}</h2>
      <div className="linklist">
        {rows.data.map((r) => (
          <Link key={r.tournamentId} to={`/t/${r.slug}`}>
            <div>
              <b>{r.title}</b>
              <span title={t.rating2.preliminaryHint}>{t.rating2.preliminary}</span>
            </div>
            <Delta value={r.delta} />
          </Link>
        ))}
      </div>
    </section>
  )
}

/** «Счёт неверный»: opens a dispute for the club on my finished match. */
export function DisputeButton({ matchId }: { matchId: number }) {
  const [state, setState] = useState<string | null>(null)
  const send = async () => {
    const reason = await ask.prompt(t.rating2.disputeReason)
    if (!reason?.trim()) return
    try {
      await api(`/rating/matches/${matchId}/dispute`, { method: 'POST', json: { reason } })
      setState(t.rating2.disputeSent)
    } catch (e) {
      setState(errorText(e))
    }
  }
  return state ? (
    <span className="small muted">{state}</span>
  ) : (
    <button className="linkbtn small" onClick={() => void send()}>
      {t.rating2.dispute}
    </button>
  )
}

type MyStatusView = {
  entry: { status: string; place: number | null; placeTo: number | null }
  next: {
    number: number
    status: string
    table: number | null
    opponent: { id: number; name: string } | null
    queuePosition: number
  } | null
  queueLength: number
}

/** The current player's essentials on the tournament page: check-in, next match, table and queue. */
export function MyStatus({ tournamentId, slug, status }: { tournamentId: number; slug: string; status: string }) {
  const { me } = useSession()
  const on = Boolean(me.player) && (status === 'running' || status === 'registration_closed' || status === 'published')
  const st = useApi<MyStatusView>(on ? `/rating/me/tournaments/${slug}` : null)
  useRoom(on ? `tournament:${tournamentId}` : null, st.reload)
  const d = st.data
  if (!d || d.entry.status === 'waitlist' || d.entry.status === 'invited') return null
  const checked = d.entry.status === 'checked_in'
  return (
    <section className="panel row row--between">
      <div className="row">
        <b>{t.t.myStatus}</b>
        <span className={`chip${checked ? ' chip--holo' : ''}`}>{checked ? t.t.checkedIn : t.t.notCheckedIn}</span>
        {d.next ? (
          <>
            {d.next.status === 'called' && <span className="chip chip--warn">{t.rating2.called}</span>}
            {d.next.status === 'playing' && <span className="chip chip--holo">{t.rating2.playing}</span>}
            <span>
              {t.rating2.next}: № {d.next.number}
              {d.next.opponent && (
                <>
                  {' · '}
                  <Link to={`/players/${d.next.opponent.id}`}>{d.next.opponent.name}</Link>
                </>
              )}
              {d.next.table != null && ` · ${t.rating2.table} ${d.next.table}`}
            </span>
            {d.next.queuePosition > 0 && <span className="small muted">{t.rating2.queue(d.next.queuePosition, d.queueLength)}</span>}
          </>
        ) : (
          status === 'running' && <span className="muted">{t.rating2.noNext}</span>
        )}
      </div>
      {!checked && status !== 'published' && (
        <Link className="button button--sm button--primary" to={`/t/${slug}/checkin`}>
          {t.t.checkinLink}
        </Link>
      )}
    </section>
  )
}
