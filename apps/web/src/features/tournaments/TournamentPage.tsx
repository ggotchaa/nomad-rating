import { useState } from 'react'
import { Link, useLocation, useParams, useSearchParams } from 'react-router'
import { api } from '../../api/client.ts'
import type { TournamentDetail } from '../../api/types.ts'
import { useSession } from '../../app/auth.tsx'
import { useApi, useRoom } from '../../app/hooks.ts'
import { errorText, t } from '../../i18n/index.ts'
import { formatDateTime, formatDuration, formatTenge, formatTime, restrictionLabel } from '../../i18n/format.ts'
import { Async, Delta, StatusChip } from '../../ui/kit.tsx'
import { StageBlock } from './Structure.tsx'
import { RegistrationQr, ShareBox } from './ShareBox.tsx'
import { TeamTournamentBlock } from '../teams/Teams.tsx'
import { ask } from '../../ui/dialogs.tsx'
import type { NotifySettings } from '../notifications/model.ts'
import { MyStatus } from '../rating/widgets.tsx'
import { EventView } from './EventView.tsx'

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
  const waitlist = d.settings?.waitlist !== false
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
      {d.registrationClosesAt && open && (
        <p className="small muted">
          {t.t.regUntil} {formatDateTime(d.registrationClosesAt)}
        </p>
      )}
      {d.myEntry ? (
        <>
          <p className="note note--ok">
            {d.myEntry.status === 'waitlist'
              ? t.t.youWait(d.myEntry.waitlistPosition)
              : `${t.t.youIn} · ${t.t.payAtClub.toLowerCase()}`}
          </p>
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
          <button
            className="button button--primary button--block"
            disabled={busy || (d.free === 0 && !waitlist)}
            onClick={() => void act('POST')}
          >
            {d.free === 0 ? (waitlist ? t.t.registerWait : t.t.full) : t.t.register}
          </button>
          <p className="small muted">{d.free === 0 && !waitlist ? t.t.noWaitlist : t.t.payAtClub}</p>
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
  const [params] = useSearchParams()
  const asPlayer = params.get('view') === 'public'
  const asCategory = params.get('cat') === 'main'
  const state = useApi<TournamentDetail>(`/tournaments/${slug}`)
  const [tab, setTab] = useState('about')
  useRoom(state.data ? `tournament:${state.data.id}` : null, state.reload)
  const running = state.data?.status === 'running'
  const prelim = useApi<{ running: boolean; deltas: Record<string, number> }>(
    running && state.data ? `/rating/tournaments/${state.data.id}/preliminary` : null,
  )
  useRoom(
    running && state.data ? `tournament:${state.data.id}` : null,
    (type) => type === 'match.updated' && prelim.reload(),
  )

  return (
    <main className="page">
      <Async state={state} skeleton={3}>
        {(d) => {
          const admin = Boolean(d.isStaff) && !asPlayer
          if (d.categories.length > 1 && !d.parentId && !asCategory) return <EventView d={d} reload={state.reload} admin={admin} />
          const ofEvent = d.event && d.categories.length > 1 ? d.event : null
          const finished = d.status === 'finished' || d.status === 'finished_early'
          const limits = restrictionLabel(d.restrictions)
          const active = d.participants.filter((p) => p.status !== 'waitlist' && p.status !== 'invited')
          const waiting = d.participants.filter((p) => p.status === 'waitlist' || p.status === 'invited')
          const ranked = finished ? [...active].sort((a, b) => (a.place ?? 999) - (b.place ?? 999)) : active
          const stages = d.structure ?? []
          const current = stages.find((s) => s.key === tab)
          const shareUrl = d.shareUrl ?? location.href
          const notes = [d.commentForPlayers, d.hall.commentForPlayers].filter(Boolean).join('\n')
          return (
            <>
              <header className="pagehead">
                {ofEvent ? (
                  <Link className="crumb" to={`/t/${ofEvent.slug}`}>
                    ← {ofEvent.title}
                  </Link>
                ) : (
                  <Link className="crumb" to="/tournaments">
                    ← {t.t.title}
                  </Link>
                )}
                <div className="row row--between">
                  <h1>{ofEvent ? `${ofEvent.title} · ${d.categoryName ?? t.cat.main}` : d.title}</h1>
                  {d.isStaff && asPlayer && (
                    <Link className="button button--sm" to={`/t/${d.slug}`}>
                      {t.t.viewAsAdmin}
                    </Link>
                  )}
                  {!d.isStaff && me.user?.role === 'admin' && (
                    <Link className="button button--sm" to={`/admin/tournaments/${d.id}`}>
                      {t.adminT.manage}
                    </Link>
                  )}
                </div>
                <div className="row">
                  <StatusChip status={d.status} />
                  {d.isRated && <span className="chip chip--holo">{t.t.rated}</span>}
                  {limits && <span className="chip">{limits}</span>}
                  <span className="muted">
                    <Link to={`/club/${d.club.slug}`}>{d.club.name}</Link> · {d.club.city}
                  </span>
                </div>
              </header>

              {admin ? (
                <section className="panel row row--between noprint">
                  <b>{t.t.adminBar}</b>
                  <div className="row">
                    <Link className="button button--sm button--primary" to={`/manage/tournaments/${d.id}/conduct`}>
                      {t.t.conductLink}
                    </Link>
                    <Link className="button button--sm" to={`/manage/tournaments/${d.id}`}>
                      {t.t.editLink}
                    </Link>
                    <Link className="button button--sm" to={`/manage/tournaments/${d.id}/qr`}>
                      {t.t.qrPage}
                    </Link>
                    <Link className="button button--sm button--ghost" to={`/t/${d.slug}?view=public`}>
                      {t.t.viewAsPlayer}
                    </Link>
                  </div>
                </section>
              ) : (
                d.myEntry && <MyStatus tournamentId={d.id} slug={d.slug} status={d.status} />
              )}

              {/* Facts stay above the tabs: on open you see when and where it is. */}
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
                {notes && <p className="note prose">{notes}</p>}
              </section>

              <div className={tab === 'about' ? 'grid grid--2' : 'grid'}>
                <div className="stack">
                  <div className="tabs" role="tablist">
                    <button type="button" role="tab" aria-selected={tab === 'about'} onClick={() => setTab('about')}>
                      {t.t.tabAbout}
                      <span className="count">{active.length}</span>
                    </button>
                    {stages.map((s) => (
                      <button
                        key={s.key}
                        type="button"
                        role="tab"
                        aria-selected={tab === s.key}
                        onClick={() => setTab(s.key)}
                      >
                        {s.name}
                      </button>
                    ))}
                  </div>

                  {tab === 'about' ? (
                    <div className="tabpanel">
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
                                {running && <th className="num">{t.t.prelim}</th>}
                                {finished && <th className="num">{t.t.change}</th>}
                              </tr>
                            </thead>
                            <tbody>
                              {ranked.map((p, i) => (
                                <tr key={p.entryId} className={p.playerId === me.player?.id ? 'is-me' : ''}>
                                  <td className="rank">
                                    {finished
                                      ? p.place == null
                                        ? '—'
                                        : p.placeTo && p.placeTo !== p.place
                                          ? `${p.place}–${p.placeTo}`
                                          : p.place
                                      : i + 1}
                                  </td>
                                  <td>
                                    <Link to={`/players/${p.playerId}`}>{p.name}</Link>
                                  </td>
                                  <td className="muted">{p.city}</td>
                                  <td className="num">
                                    {p.rating ?? p.startLevel}
                                    {p.calibrating && (
                                      <span
                                        className="chip chip--warn"
                                        title={t.t.calibrating}
                                        style={{ marginLeft: 6 }}
                                      >
                                        {t.t.calibrating}
                                      </span>
                                    )}
                                  </td>
                                  {running && (
                                    <td className="num" title={t.rating2.preliminaryHint}>
                                      <Delta value={prelim.data?.deltas[String(p.playerId)]} />
                                    </td>
                                  )}
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
                      {(d.description || d.prizes) && (
                        <section className="panel">
                          <h2>{t.t.about}</h2>
                          {d.description && <p className="prose">{d.description}</p>}
                          {d.prizes && (
                            <div className="stack">
                              <h3>{t.t.prizes}</h3>
                              <p className="prose">{d.prizes}</p>
                            </div>
                          )}
                        </section>
                      )}
                      {d.type !== 'singles' && <TeamTournamentBlock d={d} reload={state.reload} />}
                    </div>
                  ) : current ? (
                    <div className="tabpanel">
                      <StageBlock s={current} stages={stages} format={d.format} me={me.player?.id} />
                    </div>
                  ) : null}
                </div>

                <div className="stack noprint">
                  {!admin && !finished && d.status !== 'running' && <Register d={d} reload={state.reload} />}
                  <ShareBox slug={d.slug} url={shareUrl} text={d.title} live={d.status === 'running' || finished} />
                  {admin && <RegistrationQr url={shareUrl} />}
                  <section className="panel">
                    <h2>{t.t.scheme}</h2>
                    <div className="stack">
                      {d.estimate.stages.map((s, i) => (
                        <div className="row row--between" key={s.id}>
                          <span>
                            {i + 1}. {s.name}
                            {s.groups
                              ? ` · ${s.groups.length} × ${Math.max(...s.groups)}`
                              : s.bracketSize
                                ? ` · ${s.bracketSize}`
                                : ''}
                          </span>
                          <span className="chip">
                            {s.matches} {t.t.matches}
                          </span>
                        </div>
                      ))}
                    </div>
                    <p className="small muted">
                      {d.estimate.totalMatches} {t.t.matches} · {t.t.duration} {formatDuration(d.estimate.minutes)} ·{' '}
                      {t.misc.winsTo(d.format.match.winsNeeded)}
                    </p>
                  </section>
                </div>
              </div>
            </>
          )
        }}
      </Async>
    </main>
  )
}
