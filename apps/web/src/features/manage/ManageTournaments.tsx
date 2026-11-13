import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { api } from '../../api/client.ts'
import type { ManageTournament, TournamentDetail } from '../../api/types.ts'
import { useApi, useRoom } from '../../app/hooks.ts'
import { errorText, t } from '../../i18n/index.ts'
import { formatDateTime, formatDuration, formatTenge } from '../../i18n/format.ts'
import { Async, StatusChip } from '../../ui/kit.tsx'
import { TournamentForm } from '../conduct/TournamentForm.tsx'
import type { TournamentInput } from '../conduct/TournamentForm.tsx'
import { PlayerSearch, useClub } from './ManageLayout.tsx'
import type { ClubDefaults } from './ClubSettings.tsx'
import { ask } from '../../ui/dialogs.tsx'

export function ManageTournaments() {
  const { club } = useClub()
  const list = useApi<ManageTournament[]>(`/clubs/${club.id}/tournaments`)
  return (
    <section className="panel">
      <div className="panel__head">
        <h2>{t.m.tournaments}</h2>
        <Link className="button button--primary button--sm" to="new">
          + {t.m.newTournament}
        </Link>
      </div>
      <Async state={list}>
        {(rows) => (
          <div className="tablewrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t.m.date}</th>
                  <th>{t.m.name}</th>
                  <th>{t.misc.status}</th>
                  <th className="num">{t.t.participants}</th>
                  <th className="num">{t.t.fee}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((x) => (
                  <tr key={x.id}>
                    <td className="mono small muted">{formatDateTime(x.starts_at)}</td>
                    <td>
                      <Link to={String(x.id)}>{x.title}</Link>
                    </td>
                    <td>
                      <StatusChip status={x.status} />
                    </td>
                    <td className="num">
                      {x.taken} / {x.max_participants}
                    </td>
                    <td className="num">{formatTenge(x.fee)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Async>
    </section>
  )
}

export function NewTournament() {
  const { club } = useClub()
  const navigate = useNavigate()
  const hallId = club.halls[0]?.id
  const defaults = useApi<{ tournamentDefaults: ClubDefaults }>(`/clubs/${club.id}/manage`)
  if (!hallId) return <p className="note">{t.m.noClub}</p>
  return (
    <Async state={defaults}>
      {({ tournamentDefaults: d }) => (
        <TournamentForm
          clubId={club.id}
          hallId={hallId}
          initial={{ fee: d.fee, refundRules: d.refundRules, template: d.template, maxParticipants: d.maxParticipants, settings: d.settings }}
          onSaved={(id) => navigate(`../tournaments/${id}`)}
        />
      )}
    </Async>
  )
}

export function ManageTournamentPage() {
  const { id } = useParams()
  const { club } = useClub()
  const navigate = useNavigate()
  const state = useApi<TournamentDetail & TournamentInput>(`/tournaments/${id}`)
  useRoom(`tournament:${id}`, state.reload)
  const [editing, setEditing] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  const run = async (path: string, json?: unknown, ok?: string) => {
    setMessage(null)
    try {
      await api(path, { method: 'POST', json })
      if (ok) setMessage({ ok: true, text: ok })
      state.reload()
    } catch (e) {
      setMessage({ ok: false, text: errorText(e) })
    }
  }

  return (
    <Async state={state} skeleton={2}>
      {(d) => (
        <>
          <section className="panel">
            <Link className="crumb" to="..">
              ← {t.m.tournaments}
            </Link>
            <div className="panel__head">
              <h2>{d.title}</h2>
              <StatusChip status={d.status} />
            </div>
            <div className="facts">
              <div className="fact">
                <span>{t.t.start}</span>
                <b>{formatDateTime(d.startsAt)}</b>
              </div>
              <div className="fact">
                <span>{t.t.fee}</span>
                <b>{formatTenge(d.fee)}</b>
              </div>
              <div className="fact">
                <span>{t.t.participants}</span>
                <b>
                  {d.taken} / {d.maxParticipants}
                </b>
              </div>
              <div className="fact">
                <span>{t.t.scheme}</span>
                <b>
                  {d.estimate.totalMatches} {t.t.matches} · {formatDuration(d.estimate.minutes)}
                </b>
              </div>
            </div>
            {message && <p className={`note ${message.ok ? 'note--ok' : 'note--error'}`}>{message.text}</p>}
            <div className="row">
              {d.status === 'draft' && (
                <button className="button button--primary" onClick={() => void run(`/tournaments/${d.id}/publish`, undefined, t.m.published)}>
                  {t.m.publish}
                </button>
              )}
              {d.status !== 'draft' && (
                <Link className="button" to={`/t/${d.slug}`}>
                  {t.m.publicPage} →
                </Link>
              )}
              {['published', 'registration_closed', 'running', 'finished', 'finished_early'].includes(d.status) && (
                <Link className="button button--primary" to="conduct">
                  {t.conduct.open}
                </Link>
              )}
              {['draft', 'published', 'registration_closed'].includes(d.status) && (
                <button className="button" onClick={() => setEditing(!editing)}>
                  {t.ctor.edit}
                </button>
              )}
              <button
                className="button"
                onClick={() =>
                  void api<{ id: number }>(`/tournaments/${d.id}/copy`, { method: 'POST', json: {} })
                    .then((c) => navigate(`/manage/tournaments/${c.id}`))
                    .catch((e: unknown) => setMessage({ ok: false, text: errorText(e) }))
                }
              >
                {t.ctor.copy}
              </button>
              {['draft', 'published', 'registration_closed'].includes(d.status) && (
                <button
                  className="button button--danger"
                  onClick={async () => {
                    const reason = (await ask.prompt(t.ctor.cancelReason))?.trim()
                    if (reason && reason.length >= 3) void run(`/tournaments/${d.id}/cancel`, { reason }, t.ctor.cancelled)
                  }}
                >
                  {t.ctor.cancel}
                </button>
              )}
            </div>
          </section>
          {editing && <TournamentForm clubId={club.id} hallId={d.hall.id} initial={d} onSaved={() => state.reload()} />}
          <section className="panel">
            <h2>
              {t.t.participants} · {d.participants.length}
            </h2>
            {(d.status === 'published' || d.status === 'registration_closed') && (
              <div className="stack" style={{ maxWidth: 420 }}>
                <h3>{t.m.addManually}</h3>
                <PlayerSearch onPick={(p) => void run(`/tournaments/${d.id}/entries/manual`, { playerId: p.id })} />
              </div>
            )}
            <div className="tablewrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>{t.t.player}</th>
                    <th className="num">{t.t.rating}</th>
                    <th>{t.misc.status}</th>
                    <th>{t.m.payment}</th>
                  </tr>
                </thead>
                <tbody>
                  {d.participants.map((p, i) => (
                    <tr key={p.entryId}>
                      <td className="rank">{i + 1}</td>
                      <td>
                        <Link to={`/players/${p.playerId}`}>{p.name}</Link> <span className="muted small">{p.city}</span>
                      </td>
                      <td className="num">{p.rating ?? `${p.startLevel} ${t.t.calibrating}`}</td>
                      <td>
                        <span className={`chip ${p.status === 'waitlist' ? 'chip--warn' : 'chip--ok'}`}>{t.t.entryStatus[p.status] ?? p.status}</span>
                      </td>
                      <td className="muted small">{p.paymentMethod ? t.m.paymentMethod[p.paymentMethod] : '—'}</td>
                      <td>
                        {p.status === 'paid' && (
                          <button className="button button--sm" onClick={() => void run(`/tournaments/${d.id}/entries/${p.entryId}/checkin`)}>
                            {t.conduct.checkin}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {d.participants.length === 0 && <p className="empty">—</p>}
          </section>
        </>
      )}
    </Async>
  )
}
