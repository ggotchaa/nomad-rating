import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { api } from '../../api/client.ts'
import type { ManageTournament, Participant, TournamentCategory, TournamentDetail } from '../../api/types.ts'
import { useApi, useRoom } from '../../app/hooks.ts'
import { errorText, t } from '../../i18n/index.ts'
import { formatDateTime, formatDuration, formatTenge, formatTime, restrictionLabel } from '../../i18n/format.ts'
import { Async, StatusChip } from '../../ui/kit.tsx'
import { TournamentForm } from '../conduct/TournamentForm.tsx'
import type { TournamentInput } from '../conduct/TournamentForm.tsx'
import { RegistrationQr } from '../tournaments/ShareBox.tsx'
import { Structure } from '../tournaments/Structure.tsx'
import { PlayerSearch, useClub } from './ManageLayout.tsx'
import { NewPlayer } from './ManagePlayers.tsx'
import { TournamentDefaults } from './ClubSettings.tsx'
import type { ClubDefaults } from './ClubSettings.tsx'
import { ask } from '../../ui/dialogs.tsx'

export function ManageTournaments() {
  const { club, can } = useClub()
  const list = useApi<ManageTournament[]>(`/clubs/${club.id}/tournaments`)
  return (
    <div className="stack">
      <section className="panel">
        <div className="panel__head">
          <h2>{t.m.tournaments}</h2>
          {club.status === 'blocked' ? (
            <span className="chip chip--bad">{t.errors['club.blocked']}</span>
          ) : (
            <Link className="button button--primary button--sm" to="new">
              + {t.m.newTournament}
            </Link>
          )}
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
      {can('club') && <TournamentDefaults />}
    </div>
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
          initial={{
            fee: d.fee,
            refundRules: d.refundRules,
            template: d.template,
            maxParticipants: d.maxParticipants,
            settings: d.settings,
          }}
          onSaved={(id) => navigate(`../tournaments/${id}`)}
        />
      )}
    </Async>
  )
}

const WAITING = new Set(['waitlist', 'invited'])
const GONE = new Set(['withdrew', 'cancelled_by_player', 'removed_by_club'])

/** Entry list with the status filter of the console. */
function Entries({
  d,
  run,
}: {
  d: TournamentDetail
  run: (path: string, json?: unknown, ok?: string) => Promise<void>
}) {
  const [filter, setFilter] = useState('all')
  const active = d.participants.filter((p) => !WAITING.has(p.status) && !GONE.has(p.status))
  const counts: Record<string, number> = { all: d.participants.length }
  for (const p of d.participants) counts[p.status] = (counts[p.status] ?? 0) + 1
  const rows = filter === 'all' ? d.participants : d.participants.filter((p) => p.status === filter)
  const statuses = Object.keys(counts).filter((k) => k !== 'all')
  const withdraw = async (p: Participant) => {
    if (await ask.confirm(t.m.withdrawConfirm(p.name))) await run(`/tournaments/${d.id}/entries/${p.entryId}/withdraw`)
  }
  return (
    <>
      <div className="tiles">
        <div className="tile">
          <span>{t.m.totalEntries}</span>
          <b>{d.participants.length}</b>
        </div>
        <div className="tile tile--ok">
          <span>{t.m.confirmed}</span>
          <b>{active.length}</b>
        </div>
        <div className="tile tile--warn">
          <span>{t.m.awaitingFee}</span>
          <b>{counts.awaiting_payment ?? 0}</b>
        </div>
        <div className="tile">
          <span>{t.m.inWaitlist}</span>
          <b>{(counts.waitlist ?? 0) + (counts.invited ?? 0)}</b>
        </div>
      </div>
      <div className="chipbar" role="group" aria-label={t.misc.status}>
        <button type="button" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
          {t.m.allEntries} · {counts.all}
        </button>
        {statuses.map((s) => (
          <button key={s} type="button" aria-pressed={filter === s} onClick={() => setFilter(s)}>
            {t.t.entryStatus[s] ?? s} · {counts[s]}
          </button>
        ))}
      </div>
      <div className="tablewrap">
        <table className="table">
          <thead>
            <tr>
              <th>#</th>
              <th>{t.t.player}</th>
              <th className="num">{t.m.year}</th>
              <th className="num">{t.t.rating}</th>
              <th>{t.misc.status}</th>
              <th>{t.m.payment}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((p, i) => (
              <tr key={p.entryId}>
                <td className="rank">{p.waitlistPosition ?? i + 1}</td>
                <td>
                  <Link to={`/players/${p.playerId}`}>{p.name}</Link> <span className="muted small">{p.city}</span>
                </td>
                <td className="num muted">{p.birthYear}</td>
                <td className="num">{p.rating ?? `${p.startLevel} ${t.t.calibrating}`}</td>
                <td>
                  <span
                    className={`chip ${WAITING.has(p.status) ? 'chip--warn' : GONE.has(p.status) ? 'chip--bad' : 'chip--ok'}`}
                  >
                    {t.t.entryStatus[p.status] ?? p.status}
                  </span>
                </td>
                <td className="muted small">{p.paymentMethod ? t.m.paymentMethod[p.paymentMethod] : '—'}</td>
                <td className="num">
                  <div className="row" style={{ justifyContent: 'flex-end' }}>
                    {p.status === 'paid' && (
                      <button
                        className="button button--sm"
                        onClick={() => void run(`/tournaments/${d.id}/entries/${p.entryId}/checkin`)}
                      >
                        {t.conduct.checkin}
                      </button>
                    )}
                    {!GONE.has(p.status) && (
                      <button className="button button--sm button--ghost" onClick={() => void withdraw(p)}>
                        {t.m.withdraw}
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length === 0 && <p className="empty">—</p>}
    </>
  )
}

/** Categories of the tournament day: the main tournament is the first one, each category is run on its own page. */
function Categories({ d, clubId }: { d: TournamentDetail; clubId: number }) {
  const navigate = useNavigate()
  const [adding, setAdding] = useState(false)
  const list: TournamentCategory[] = d.categories.length
    ? d.categories
    : [{ id: d.id, slug: d.slug, name: d.categoryName, isMain: true, startsAt: d.startsAt, status: d.status, type: d.type, restrictions: d.restrictions, fee: d.fee, maxParticipants: d.maxParticipants, taken: d.taken, myStatus: null }]
  const open = ['draft', 'published', 'registration_closed', 'running'].includes(d.status)
  return (
    <section className="panel">
      <div className="panel__head">
        <h2>
          {t.cat.title} · {list.length}
        </h2>
        {open && (
          <button className="button button--sm" onClick={() => setAdding(!adding)}>
            {adding ? t.common.close : `+ ${t.cat.add}`}
          </button>
        )}
      </div>
      <div className="tablewrap">
        <table className="table">
          <thead>
            <tr>
              <th>{t.cat.name}</th>
              <th>{t.cat.start}</th>
              <th>{t.cat.limits}</th>
              <th>{t.misc.status}</th>
              <th className="num">{t.t.participants}</th>
            </tr>
          </thead>
          <tbody>
            {list.map((c) => (
              <tr key={c.id}>
                <td>
                  {c.id === d.id ? (
                    <>
                      {c.name ?? t.cat.main} <span className="muted small">· {t.cat.thisPage}</span>
                    </>
                  ) : (
                    <Link to={`/manage/tournaments/${c.id}`}>{c.name ?? t.cat.main}</Link>
                  )}
                </td>
                <td className="mono">{formatTime(c.startsAt)}</td>
                <td className="muted small">{restrictionLabel(c.restrictions) ?? t.t.noLimits}</td>
                <td>
                  <StatusChip status={c.status} />
                </td>
                <td className="num">
                  {c.taken} / {c.maxParticipants}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {adding && (
        <TournamentForm
          clubId={clubId}
          hallId={d.hall.id}
          parent={{ id: d.id, startsAt: d.startsAt }}
          initial={{ type: d.type, maxParticipants: d.maxParticipants, fee: d.fee, startsAt: d.startsAt }}
          onSaved={(id) => navigate(`/manage/tournaments/${id}`)}
        />
      )}
    </section>
  )
}

/** Manager console of one tournament: basics and registration on one tab, the draw on the other. */
export function ManageTournamentPage() {
  const { id } = useParams()
  const { club } = useClub()
  const navigate = useNavigate()
  const state = useApi<TournamentDetail & TournamentInput>(`/tournaments/${id}`)
  useRoom(`tournament:${id}`, state.reload)
  const [tab, setTab] = useState<'info' | 'tournament'>('info')
  const [editing, setEditing] = useState(false)
  const [creating, setCreating] = useState(false)
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
      {(d) => {
        const editable = ['draft', 'published', 'registration_closed'].includes(d.status)
        const live = ['published', 'registration_closed', 'running', 'finished', 'finished_early'].includes(d.status)
        return (
          <>
            <section className="panel">
              {d.parentId && d.event ? (
                <Link className="crumb" to={`/manage/tournaments/${d.event.id}`}>
                  ← {t.cat.ofEvent(d.event.title)}
                </Link>
              ) : (
                <Link className="crumb" to="..">
                  ← {t.m.tournaments}
                </Link>
              )}
              <div className="panel__head">
                <h2>{d.title}</h2>
                <div className="row">
                  <StatusChip status={d.status} />
                  {d.isRated && <span className="chip chip--holo">{t.t.rated}</span>}
                </div>
              </div>
              <p className="muted small">
                {formatDateTime(d.startsAt)} · {d.club.name} · {d.tables} {t.common.tables} · {d.taken} /{' '}
                {d.maxParticipants} · {formatTenge(d.fee)}
              </p>
              {message && <p className={`note ${message.ok ? 'note--ok' : 'note--error'}`}>{message.text}</p>}
              <div className="toolbar">
                {d.status === 'draft' && (
                  <button
                    className="button button--primary"
                    onClick={() => void run(`/tournaments/${d.id}/publish`, undefined, t.m.published)}
                  >
                    {t.m.publish}
                  </button>
                )}
                {live && (
                  <Link className="button button--primary" to="conduct">
                    {t.conduct.open}
                  </Link>
                )}
                {d.status !== 'draft' && (
                  <Link className="button" to={`/t/${d.slug}?view=public`}>
                    {t.m.publicView}
                  </Link>
                )}
                {live && (
                  <Link className="button" to={`/t/${d.slug}/live`}>
                    {t.m.scoreboard}
                  </Link>
                )}
                <Link className="button" to="/manage/audit">
                  {t.m.auditLog}
                </Link>
                <span className="spacer" />
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
                {editable && (
                  <button
                    className="button button--danger"
                    onClick={async () => {
                      const reason = (await ask.prompt(t.ctor.cancelReason))?.trim()
                      if (reason && reason.length >= 3)
                        void run(`/tournaments/${d.id}/cancel`, { reason }, t.ctor.cancelled)
                    }}
                  >
                    {t.ctor.cancel}
                  </button>
                )}
              </div>
            </section>

            <div className="tabs" role="tablist">
              <button type="button" role="tab" aria-selected={tab === 'info'} onClick={() => setTab('info')}>
                {t.m.consoleInfo}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'tournament'}
                onClick={() => setTab('tournament')}
              >
                {t.m.consoleTournament}
              </button>
            </div>

            {tab === 'info' ? (
              <div className="tabpanel">
                <section className="panel">
                  <div className="panel__head">
                    <h2>{t.m.settingsTitle}</h2>
                    {editable && (
                      <button className="button button--sm" onClick={() => setEditing(!editing)}>
                        {editing ? t.common.close : t.ctor.edit}
                      </button>
                    )}
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
                </section>
                {editing && (
                  <TournamentForm
                    clubId={club.id}
                    hallId={d.hall.id}
                    initial={d}
                    parent={d.parentId && d.event ? { id: d.event.id, startsAt: d.event.startsAt } : undefined}
                    categories={!d.parentId && d.categories.length > 1}
                    onSaved={() => state.reload()}
                  />
                )}
                {!d.parentId && <Categories d={d} clubId={club.id} />}

                <section className="panel">
                  <div className="panel__head">
                    <h2>
                      {t.m.registration} · {d.participants.length}
                    </h2>
                  </div>
                  {(d.status === 'published' || d.status === 'registration_closed') && (
                    <div className="stack" style={{ maxWidth: 520 }}>
                      <div className="row row--between">
                        <h3>{t.m.addManually}</h3>
                        <button className="button button--sm" onClick={() => setCreating(true)}>
                          + {t.m.createAndAdd}
                        </button>
                      </div>
                      <PlayerSearch
                        onPick={(p) => void run(`/tournaments/${d.id}/entries/manual`, { playerId: p.id })}
                      />
                    </div>
                  )}
                  {creating && (
                    <NewPlayer
                      onClose={() => setCreating(false)}
                      onCreated={(code, id) => {
                        setCreating(false)
                        void run(`/tournaments/${d.id}/entries/manual`, { playerId: id }, t.m.claimCode(code))
                      }}
                    />
                  )}
                  <Entries d={d} run={run} />
                </section>

                {d.status !== 'draft' && <RegistrationQr url={d.shareUrl ?? `${location.origin}/t/${d.slug}`} />}
              </div>
            ) : (
              <div className="tabpanel">
                {d.structure?.length ? <Structure stages={d.structure} format={d.format} /> : <p className="empty">{t.m.noStages}</p>}
              </div>
            )}
          </>
        )
      }}
    </Async>
  )
}
