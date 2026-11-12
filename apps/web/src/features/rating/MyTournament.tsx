import { Link, Navigate, useParams } from 'react-router'
import { useSession } from '../../app/auth.tsx'
import { useApi, useRoom } from '../../app/hooks.ts'
import { t } from '../../i18n/index.ts'
import { formatDateTime } from '../../i18n/format.ts'
import { Async, Delta, StatusChip } from '../../ui/kit.tsx'

type MyTournamentView = {
  tournament: { id: number; slug: string; title: string; status: string; startsAt: string }
  entry: { status: string; seed: number | null; place: number | null; placeTo: number | null; ratingAtStart: number | null }
  group: { code: string; stage: string; place: number | null; wins: number; losses: number; size: number } | null
  next: {
    matchId: number
    number: number
    status: string
    round: string | null
    table: number | null
    opponent: { id: number; name: string; rating: number | null } | null
    queuePosition: number
  } | null
  queueLength: number
  preliminaryDelta: number | null
}

/** «Мой турнир» (S-7): where I am in the group, my next match and my place in the queue. */
export function MyTournament() {
  const { slug } = useParams()
  const { me, ready } = useSession()
  const state = useApi<MyTournamentView>(me.player ? `/rating/me/tournaments/${slug}` : null)
  useRoom(state.data ? `tournament:${state.data.tournament.id}` : null, state.reload)
  if (ready && !me.user) return <Navigate to="/login" replace />

  return (
    <main className="page">
      <Async state={state} skeleton={2}>
        {(d) => (
          <>
            <header className="pagehead">
              <Link className="crumb" to={`/t/${d.tournament.slug}`}>
                ← {d.tournament.title}
              </Link>
              <div className="row">
                <StatusChip status={d.tournament.status} />
              </div>
              <h1>{t.rating2.myTournament}</h1>
              <p>{formatDateTime(d.tournament.startsAt)}</p>
            </header>
            <div className="grid grid--half">
              <section className="panel">
                <h2>{t.rating2.next}</h2>
                {d.next ? (
                  <div className="stack">
                    {d.next.status === 'called' && <p className="note note--call">{t.rating2.called}</p>}
                    {d.next.status === 'playing' && <span className="chip chip--holo">{t.rating2.playing}</span>}
                    <div className="facts">
                      <div className="fact">
                        <span>№</span>
                        <b>{d.next.number}</b>
                      </div>
                      <div className="fact">
                        <span>{t.rating2.opponent}</span>
                        <b>{d.next.opponent ? <Link to={`/players/${d.next.opponent.id}`}>{d.next.opponent.name}</Link> : t.rating2.tbd}</b>
                      </div>
                      {d.next.table != null && (
                        <div className="fact">
                          <span>{t.rating2.table}</span>
                          <b>{d.next.table}</b>
                        </div>
                      )}
                      {d.next.round && (
                        <div className="fact">
                          <span>{t.rating2.group}</span>
                          <b>{d.next.round}</b>
                        </div>
                      )}
                    </div>
                    {d.next.queuePosition > 0 && <p className="small muted">{t.rating2.queue(d.next.queuePosition, d.queueLength)}</p>}
                  </div>
                ) : (
                  <p className="empty">{d.entry.place ? `${t.rating2.final}: ${d.entry.place}${d.entry.placeTo ? `–${d.entry.placeTo}` : ''}` : t.rating2.noNext}</p>
                )}
              </section>
              <section className="panel">
                <div className="facts">
                  {d.group && (
                    <>
                      <div className="fact">
                        <span>{t.rating2.group}</span>
                        <b>
                          {d.group.stage} · {d.group.code}
                        </b>
                      </div>
                      <div className="fact">
                        <span>{t.rating2.place}</span>
                        <b>{d.group.place ? `${d.group.place} / ${d.group.size}` : '—'}</b>
                      </div>
                      <div className="fact">
                        <span>
                          {t.t.w}–{t.t.l}
                        </span>
                        <b>
                          {d.group.wins}–{d.group.losses}
                        </b>
                      </div>
                    </>
                  )}
                  <div className="fact">
                    <span>{t.t.rating}</span>
                    <b>{d.entry.ratingAtStart ?? '—'}</b>
                  </div>
                  {d.preliminaryDelta != null && (
                    <div className="fact" title={t.rating2.preliminaryHint}>
                      <span>{t.rating2.preliminary}</span>
                      <b>
                        <Delta value={d.preliminaryDelta} />
                      </b>
                    </div>
                  )}
                </div>
              </section>
            </div>
          </>
        )}
      </Async>
    </main>
  )
}
