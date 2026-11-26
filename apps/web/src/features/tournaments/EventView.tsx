// A tournament day with several categories: categories and all participants on one page, registration
// into several categories at once. Each category opens as an ordinary tournament page.

import { useState } from 'react'
import { Link, useLocation } from 'react-router'
import { api } from '../../api/client.ts'
import type { TournamentCategory, TournamentDetail } from '../../api/types.ts'
import { useSession } from '../../app/auth.tsx'
import { errorText, t } from '../../i18n/index.ts'
import { formatDate, formatTenge, formatTime, restrictionLabel } from '../../i18n/format.ts'
import { Modal, StatusChip } from '../../ui/kit.tsx'
import { RegistrationQr, ShareBox } from './ShareBox.tsx'

export const categoryName = (c: Pick<TournamentCategory, 'name'>) => c.name ?? t.cat.main
export const categoryLink = (c: Pick<TournamentCategory, 'slug' | 'isMain'>) => (c.isMain ? `/t/${c.slug}?cat=main` : `/t/${c.slug}`)

function RegisterCategories({ d, reload }: { d: TournamentDetail; reload: () => void }) {
  const { me } = useSession()
  const location = useLocation()
  const [open, setOpen] = useState(false)
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<string[]>([])
  const [done, setDone] = useState(false)
  const openable = d.categories.filter((c) => c.status === 'published' && !c.myStatus)
  const mine = d.categories.filter((c) => c.myStatus)

  const submit = async () => {
    if (!picked.size) return setErrors([t.cat.pickOne])
    setBusy(true)
    setErrors([])
    const failed: string[] = []
    for (const c of d.categories.filter((x) => picked.has(x.id))) {
      try {
        await api(`/tournaments/${c.id}/entries`, { method: 'POST' })
      } catch (e) {
        failed.push(`${categoryName(c)}: ${errorText(e)}`)
      }
    }
    setBusy(false)
    setErrors(failed)
    setPicked(new Set())
    setDone(failed.length === 0)
    if (!failed.length) setOpen(false)
    reload()
  }

  return (
    <aside className="panel stack">
      {mine.length > 0 && (
        <p className="note note--ok">
          {t.t.youIn}: {mine.map(categoryName).join(', ')}
        </p>
      )}
      {done && <p className="note note--ok">{t.cat.done}</p>}
      {!me.user ? (
        <Link className="button button--primary button--block" to="/login" state={{ from: location.pathname }}>
          {t.t.loginToRegister}
        </Link>
      ) : !me.player ? (
        <p className="note">{t.errors['player.profile_required']}</p>
      ) : openable.length ? (
        <button className="button button--primary button--block" onClick={() => setOpen(true)}>
          {t.cat.register}
        </button>
      ) : (
        !mine.length && <p className="note">{t.t.closed}</p>
      )}
      <p className="small muted">{t.t.payAtClub}</p>
      {open && (
        <Modal title={t.cat.choose} onClose={() => setOpen(false)}>
          <div className="stack">
            {d.categories.map((c) => {
              const disabled = c.status !== 'published' || Boolean(c.myStatus)
              return (
                <label key={c.id} className="check row row--between">
                  <span className="row">
                    <input
                      type="checkbox"
                      disabled={disabled}
                      checked={Boolean(c.myStatus) || picked.has(c.id)}
                      onChange={(e) => {
                        const next = new Set(picked)
                        if (e.target.checked) next.add(c.id)
                        else next.delete(c.id)
                        setPicked(next)
                      }}
                    />
                    <span>
                      <b>{categoryName(c)}</b>{' '}
                      <span className="muted small">
                        · {formatTime(c.startsAt)}
                        {restrictionLabel(c.restrictions) ? ` · ${restrictionLabel(c.restrictions)}` : ''} · {t.t.taken(c.taken, c.maxParticipants)}
                      </span>
                    </span>
                  </span>
                  <span className="chip">
                    {c.myStatus ? t.cat.registered : c.status !== 'published' ? t.cat.closed : c.fee ? formatTenge(c.fee) : t.common.free}
                  </span>
                </label>
              )
            })}
            {errors.map((e) => (
              <p key={e} className="note note--error">
                {e}
              </p>
            ))}
            <button className="button button--primary" disabled={busy} onClick={() => void submit()}>
              {t.cat.submit}
              {picked.size ? ` · ${picked.size}` : ''}
            </button>
          </div>
        </Modal>
      )}
      {!open && errors.length > 0 && errors.map((e) => <p key={e} className="note note--error">{e}</p>)}
    </aside>
  )
}

export function EventView({ d, reload, admin }: { d: TournamentDetail; reload: () => void; admin: boolean }) {
  const { me } = useSession()
  const [tab, setTab] = useState<'info' | 'categories'>('info')
  const byId = new Map(d.categories.map((c) => [c.id, c]))
  const shareUrl = d.shareUrl ?? location.href
  const notes = [d.commentForPlayers, d.hall.commentForPlayers].filter(Boolean).join('\n')
  return (
    <>
      <header className="pagehead">
        <Link className="crumb" to="/tournaments">
          ← {t.t.title}
        </Link>
        <div className="row row--between">
          <h1>{d.title}</h1>
          {admin && (
            <Link className="button button--sm" to={`/manage/tournaments/${d.id}`}>
              {t.t.editLink}
            </Link>
          )}
        </div>
        <div className="row">
          <StatusChip status={d.status} />
          {d.isRated && <span className="chip chip--holo">{t.t.rated}</span>}
          <span className="muted">
            <Link to={`/club/${d.club.slug}`}>{d.club.name}</Link> · {d.club.city}
          </span>
        </div>
      </header>

      <section className="panel">
        <div className="facts">
          <div className="fact">
            <span>{t.cat.date}</span>
            <b>{formatDate(d.startsAt)}</b>
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
            <span>{t.cat.title}</span>
            <b>{d.categories.length}</b>
          </div>
        </div>
        {notes && <p className="note prose">{notes}</p>}
      </section>

      <div className="grid grid--2">
        <div className="stack">
          <div className="tabs" role="tablist">
            <button type="button" role="tab" aria-selected={tab === 'info'} onClick={() => setTab('info')}>
              {t.cat.tabInfo}
              <span className="count">{d.eventParticipants.length}</span>
            </button>
            <button type="button" role="tab" aria-selected={tab === 'categories'} onClick={() => setTab('categories')}>
              {t.cat.tabCategories}
              <span className="count">{d.categories.length}</span>
            </button>
          </div>

          {tab === 'info' ? (
            <div className="tabpanel">
              <section className="panel">
                <h2>{t.cat.title}</h2>
                <div className="tablewrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>{t.cat.name}</th>
                        <th>{t.cat.start}</th>
                        <th>{t.cat.limits}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.categories.map((c) => (
                        <tr key={c.id}>
                          <td>
                            <Link to={categoryLink(c)}>{categoryName(c)}</Link>
                          </td>
                          <td className="mono">{formatTime(c.startsAt)}</td>
                          <td className="muted small">{restrictionLabel(c.restrictions) ?? t.t.noLimits}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
              <section className="panel">
                <h2>
                  {t.cat.participants} · {d.eventParticipants.length}
                </h2>
                <div className="tablewrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>{t.t.player}</th>
                        <th className="num">{t.t.rating}</th>
                        <th>{t.cat.title}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.eventParticipants.map((p, i) => (
                        <tr key={p.playerId} className={p.playerId === me.player?.id ? 'is-me' : ''}>
                          <td className="rank">{i + 1}</td>
                          <td>
                            <Link to={`/players/${p.playerId}`}>{p.name}</Link> <span className="muted small">{p.city}</span>
                          </td>
                          <td className="num">
                            {p.rating ?? p.startLevel}
                            {p.calibrating && (
                              <span className="chip chip--warn" style={{ marginLeft: 6 }}>
                                {t.t.calibrating}
                              </span>
                            )}
                          </td>
                          <td>
                            <div className="row" style={{ gap: 4 }}>
                              {p.categories.map((id) => {
                                const c = byId.get(id)
                                return c ? (
                                  <Link key={id} className="chip" to={categoryLink(c)}>
                                    {categoryName(c)}
                                  </Link>
                                ) : null
                              })}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {d.eventParticipants.length === 0 && <p className="empty">—</p>}
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
            </div>
          ) : (
            <div className="tabpanel grid grid--cards">
              {d.categories.map((c) => (
                <Link key={c.id} className="tcard" to={categoryLink(c)}>
                  <div className="tcard__date">
                    <span>{formatTime(c.startsAt)}</span>
                    <span>{c.fee ? formatTenge(c.fee) : t.common.free}</span>
                  </div>
                  <h3>{categoryName(c)}</h3>
                  <p className="muted small">{restrictionLabel(c.restrictions) ?? t.t.noLimits}</p>
                  <div className="row">
                    <StatusChip status={c.status} />
                    {c.myStatus && <span className="chip chip--ok">{t.cat.registered}</span>}
                  </div>
                  <div className={`meter${c.taken >= c.maxParticipants ? ' meter--full' : ''}`}>
                    <div style={{ width: `${Math.min(100, (c.taken / c.maxParticipants) * 100)}%` }} />
                  </div>
                  <p className="small muted">{t.t.taken(c.taken, c.maxParticipants)}</p>
                </Link>
              ))}
            </div>
          )}
        </div>

        <div className="stack noprint">
          {!admin && <RegisterCategories d={d} reload={reload} />}
          <ShareBox slug={d.slug} url={shareUrl} text={d.title} live={d.status === 'running'} />
          {admin && <RegistrationQr url={shareUrl} />}
        </div>
      </div>
    </>
  )
}
