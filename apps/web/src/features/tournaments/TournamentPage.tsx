import { useState } from 'react'
import { Link, useLocation, useParams } from 'react-router'
import { api } from '../../api/client.ts'
import type { TournamentDetail } from '../../api/types.ts'
import { useSession } from '../../app/auth.tsx'
import { MyTournamentStrip } from '../rating/widgets.tsx'
import { useApi, useRoom } from '../../app/hooks.ts'
import { errorText, t } from '../../i18n/index.ts'
import { formatDateTime, formatDuration, formatTenge, formatTime, restrictionLabel } from '../../i18n/format.ts'
import { Async, Delta, StatusChip } from '../../ui/kit.tsx'
import { Structure } from './Structure.tsx'
import { ShareBox } from './ShareBox.tsx'
import { TeamTournamentBlock } from '../teams/Teams.tsx'
import { ask } from '../../ui/dialogs.tsx'
import type { NotifySettings } from '../notifications/model.ts'

function Register({ d, reload }: { d: TournamentDetail; reload: () => void }) {
  const { me } = useSession()
  const location = useLocation()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const notif = useApi<NotifySettings>(d.myEntry && me.player ? '/notifications/settings' : null)
  const tg = notif.data?.telegram
  const noBot = tg?.enabled && !tg.accounts.some((a) => !a.stopped && !a.blocked)
  const act = async (method: 'POST' | 'DELETE') => {
    if (method === 'DELETE' && !(await ask.confirm(t.t.cancelConfirm))) return
    setBusy(true)
    setError(null)
    try {
      await api(method === 'POST' ? `/tournaments/${d.id}/entries` : `/tournaments/${d.id}/entries/me`, { method })
      reload()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  const open = d.status === 'published'
  return (
    <aside className="panel">
      <div className="total">
        <span className="muted">{t.t.fee}</span>
        <b>{d.fee ? formatTenge(d.fee) : t.common.free}</b>
      </div>
      <div className={`meter${d.free === 0 ? ' meter--full' : ''}`}>
        <div style={{ width: `${Math.min(100, (d.taken / d.maxParticipants) * 100)}%` }} />
      </div>
      <p className="small muted">{t.t.taken(d.taken, d.maxParticipants)}</p>
      {d.myEntry ? (
        <>
          <p className="note note--ok">{d.myEntry.status === 'waitlist' ? t.t.youWait(d.myEntry.waitlistPosition) : `${t.t.youIn} · ${t.t.payAtClub.toLowerCase()}`}</p>
          {noBot && (
            <p className="note small">
              {t.tg.reminder} <Link to="/notifications">{t.tg.connect}</Link>
            </p>
          )}
          {(open || d.status === 'registration_closed') && (
            <button className="button button--danger button--block" disabled={busy} onClick={() => void act('DELETE')}>
              {t.t.cancelEntry}
            </button>
          )}
        </>
      ) : !open ? (
        <p className="note">{d.status === 'registration_closed' ? t.t.closed : t.t.status[d.status]}</p>
      ) : !me.user ? (
        <Link className="button button--primary button--block" to="/login" state={{ from: location.pathname }}>
          {t.t.loginToRegister}
        </Link>
      ) : me.player ? (
        <>
          <button className="button button--primary button--block" disabled={busy} onClick={() => void act('POST')}>
            {d.free === 0 ? t.t.registerWait : t.t.register}
          </button>
          <p className="small muted">{t.t.payAtClub}</p>
        </>
      ) : (
        <p className="note">{t.errors['player.profile_required']}</p>
      )}
      {error && <p className="note note--error">{error}</p>}
    </aside>
  )
}

export function TournamentPage() {
  const { slug } = useParams()
  const { me } = useSession()
  const state = useApi<TournamentDetail>(`/tournaments/${slug}`)
  useRoom(state.data ? `tournament:${state.data.id}` : null, state.reload)

  return (
    <main className="page">
      <Async state={state} skeleton={3}>
        {(d) => {
          const finished = d.status === 'finished' || d.status === 'finished_early'
          const limits = restrictionLabel(d.restrictions)
          const active = d.participants.filter((p) => p.status !== 'waitlist' && p.status !== 'invited')
          const waiting = d.participants.filter((p) => p.status === 'waitlist' || p.status === 'invited')
          const ranked = finished ? [...active].sort((a, b) => (a.place ?? 999) - (b.place ?? 999)) : active
          return (
            <>
              <header className="pagehead">
                <Link className="crumb" to="/tournaments">
                  ← {t.t.title}
                </Link>
                <div className="row">
                  <StatusChip status={d.status} />
                  {d.isRated && <span className="chip chip--holo">{t.t.rated}</span>}
                  {limits && <span className="chip">{limits}</span>}
                </div>
                <h1>{d.title}</h1>
                <p>
                  <Link to={`/club/${d.club.slug}`}>{d.club.name}</Link> · {d.club.city}
                </p>
              </header>
              <MyTournamentStrip tournamentId={d.id} slug={slug!} status={d.status} />
              <div className="grid grid--2">
                <section className="panel">
                  <div className="facts">
                    <div className="fact">
                      <span>{t.t.start}</span>
                      <b>{formatDateTime(d.startsAt)}</b>
                    </div>
                    <div className="fact">
                      <span>{t.t.end}</span>
                      <b>{formatTime(d.estimatedEndAt)}</b>
                    </div>
                    <div className="fact">
                      <span>{t.t.where}</span>
                      <b>{d.hall.address}</b>
                    </div>
                    <div className="fact">
                      <span>{t.t.tables}</span>
                      <b>{d.tables}</b>
                    </div>
                    <div className="fact">
                      <span>{t.t.limits}</span>
                      <b>{limits ?? t.t.noLimits}</b>
                    </div>
                    {d.avgRating != null && (
                      <div className="fact">
                        <span>{t.t.avg}</span>
                        <b>{d.avgRating}</b>
                      </div>
                    )}
                  </div>
                  {d.description && <p className="prose">{d.description}</p>}
                  {d.prizes && (
                    <div className="stack">
                      <h3>{t.t.prizes}</h3>
                      <p className="prose">{d.prizes}</p>
                    </div>
                  )}
                  {(d.commentForPlayers || d.hall.commentForPlayers) && (
                    <p className="note prose">{[d.commentForPlayers, d.hall.commentForPlayers].filter(Boolean).join('\n')}</p>
                  )}
                </section>
                <div className="stack">
                  <div className="stack">
                    {!finished && d.status !== 'running' && <Register d={d} reload={state.reload} />}
                    <ShareBox slug={d.slug} url={(d as { shareUrl?: string }).shareUrl ?? location.href} text={d.title} live={d.status === 'running' || finished} />
                  </div>
                  <section className="panel">
                    <h2>{t.t.scheme}</h2>
                    <div className="stack">
                      {d.estimate.stages.map((s, i) => (
                        <div className="row row--between" key={s.id}>
                          <span>
                            {i + 1}. {s.name}
                            {s.groups ? ` · ${s.groups.length} × ${Math.max(...s.groups)}` : s.bracketSize ? ` · ${s.bracketSize}` : ''}
                          </span>
                          <span className="chip">
                            {s.matches} {t.t.matches}
                          </span>
                        </div>
                      ))}
                    </div>
                    <p className="small muted">
                      {d.estimate.totalMatches} {t.t.matches} · {t.t.duration} {formatDuration(d.estimate.minutes)} · {t.misc.winsTo(d.format.match.winsNeeded)} в партиях
                    </p>
                  </section>
                </div>
              </div>

              <section className="panel">
                <h2>
                  {finished ? t.t.results : t.t.participants} · {active.length}
                </h2>
                <div className="tablewrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>{finished ? t.t.place : '#'}</th>
                        <th>{t.t.player}</th>
                        <th>{t.common.city}</th>
                        <th className="num">{t.t.rating}</th>
                        {finished && <th className="num">{t.t.change}</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {ranked.map((p, i) => (
                        <tr key={p.entryId} className={p.playerId === me.player?.id ? 'is-me' : ''}>
                          <td className="rank">{finished ? (p.place == null ? '—' : p.placeTo && p.placeTo !== p.place ? `${p.place}–${p.placeTo}` : p.place) : i + 1}</td>
                          <td>
                            <Link to={`/players/${p.playerId}`}>{p.name}</Link>
                          </td>
                          <td className="muted">{p.city}</td>
                          <td className="num">
                            {p.rating ?? p.startLevel}
                            {p.calibrating && <span className="chip chip--warn" title={t.t.calibrating} style={{ marginLeft: 6 }}>{t.t.calibrating}</span>}
                          </td>
                          {finished && (
                            <td className="num">
                              <Delta value={p.ratingChange?.delta} />
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {active.length === 0 && <p className="empty">—</p>}
                {waiting.length > 0 && (
                  <>
                    <h3>
                      {t.t.waitlist} · {waiting.length}
                    </h3>
                    <p className="muted small">{waiting.map((p) => p.name).join(', ')}</p>
                  </>
                )}
              </section>

              {d.type !== 'singles' && <TeamTournamentBlock d={d} reload={state.reload} />}
              {d.structure && <Structure stages={d.structure} me={me.player?.id} />}
            </>
          )
        }}
      </Async>
    </main>
  )
}
