import { useState } from 'react'
import { Link } from 'react-router'
import { api } from '../../api/client.ts'
import { useApi } from '../../app/hooks.ts'
import { formatDateTime, formatTenge, formatTime } from '../../i18n/format.ts'
import { t } from '../../i18n/index.ts'
import { ask } from '../../ui/dialogs.tsx'
import { Async, Field, StatusChip } from '../../ui/kit.tsx'
import { useAction } from '../account/AccountFlows.tsx'
import { useClub } from './ManageLayout.tsx'

type Today = {
  date: string
  tournaments: { id: number; title: string; slug: string; startsAt: string; status: string; entries: number; checkedIn: number }[]
  bookings: { id: number; startsAt: string; endsAt: string; status: string; table: number; name: string | null }[]
  week: { from: string; expected: number; collected: number } | null
  tasks: { scores: number; checkin: number; disputes: number; invitations: number }
}

export function ClubToday() {
  const { club, can } = useClub()
  const state = useApi<Today>(`/clubs/${club.id}/today`)
  return (
    <Async state={state}>
      {(d) => {
        const tasks = [
          { n: d.tasks.scores, label: t.m.taskScores, to: 'tournaments', show: can('tournaments') },
          { n: d.tasks.checkin, label: t.m.taskCheckin, to: 'tournaments', show: can('conduct') },
          { n: d.tasks.disputes, label: t.m.taskDisputes, to: 'tournaments', show: can('tournaments') },
          { n: d.tasks.invitations, label: t.m.taskInvitations, to: 'helpers', show: can('organizer') },
        ].filter((x) => x.show && x.n > 0)
        return (
          <div className="grid grid--half">
            <section className="panel stack">
              <h2>{t.m.todayTournaments}</h2>
              {d.tournaments.length ? (
                d.tournaments.map((x) => (
                  <p key={x.id} className="row row--between">
                    <Link to={`tournaments/${x.id}`}>
                      {formatTime(x.startsAt)} · {x.title}
                    </Link>
                    <span className="small muted">
                      {x.checkedIn}/{x.entries} <StatusChip status={x.status} />
                    </span>
                  </p>
                ))
              ) : (
                <p className="empty">{t.m.noneToday}</p>
              )}
            </section>
            <section className="panel stack">
              <h2>{t.m.tasks}</h2>
              {tasks.length ? (
                tasks.map((x) => (
                  <p key={x.label} className="row row--between">
                    <Link to={x.to}>{x.label}</Link>
                    <b>{x.n}</b>
                  </p>
                ))
              ) : (
                <p className="empty">{t.m.noTasks}</p>
              )}
            </section>
            <section className="panel stack">
              <h2>{t.m.todayBookings}</h2>
              {d.bookings.length ? (
                d.bookings.map((b) => (
                  <p key={b.id} className="row row--between small">
                    <span>
                      {formatTime(b.startsAt)}–{formatTime(b.endsAt)} · {t.t.table} {b.table} · {b.name ?? '—'}
                    </span>
                    <StatusChip status={b.status} />
                  </p>
                ))
              ) : (
                <p className="empty">{t.m.noneToday}</p>
              )}
            </section>
            {d.week && (
              <section className="panel stack">
                <h2>{t.m.week}</h2>
                <p className="row row--between">
                  {t.m.expected} <b>{formatTenge(d.week.expected)}</b>
                </p>
                <p className="row row--between">
                  {t.finance.collected} <b>{formatTenge(d.week.collected)}</b>
                </p>
                <Link to="finance" className="small">
                  {t.finance.title}
                </Link>
              </section>
            )}
          </div>
        )
      }}
    </Async>
  )
}

type Doc = { id: number; name: string; url: string; size: number; createdAt: string }

export function ClubDocuments({ clubId }: { clubId: number }) {
  const state = useApi<Doc[]>(`/clubs/${clubId}/documents`)
  const act = useAction()
  return (
    <section className="panel stack">
      <h2>{t.clubreg.documents}</h2>
      <p className="small muted">{t.clubreg.documentsHint}</p>
      <Async state={state}>
        {(list) => (
          <>
            {list.map((d) => (
              <p key={d.id} className="row row--between small">
                <a href={d.url} target="_blank" rel="noreferrer">
                  {d.name}
                </a>
                <button
                  className="button button--sm"
                  disabled={act.busy}
                  onClick={async () => {
                    if (!(await ask.confirm(t.clubreg.documentRemove))) return
                    void act.run(async () => {
                      await api(`/clubs/${clubId}/documents/${d.id}`, { method: 'DELETE' })
                      state.reload()
                    })
                  }}
                >
                  ×
                </button>
              </p>
            ))}
          </>
        )}
      </Async>
      <input
        type="file"
        accept="application/pdf,image/jpeg,image/png"
        aria-label={t.clubreg.documents}
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file)
            void act.run(async () => {
              await api(`/clubs/${clubId}/documents`, { method: 'POST', body: file, headers: { 'Content-Type': file.type, 'X-File-Name': encodeURIComponent(file.name) } })
              state.reload()
            })
        }}
      />
      {act.notes}
    </section>
  )
}

const SUBJECTS = ['payment', 'booking', 'tournament', 'player', 'other'] as const

export function ClubDisputeForm({ clubId }: { clubId: number }) {
  const [subject, setSubject] = useState<(typeof SUBJECTS)[number]>('payment')
  const [ref, setRef] = useState('')
  const [reason, setReason] = useState('')
  const act = useAction()
  const list = useApi<{ id: number; entity: string; entityId: string; reason: string; status: string; resolution: string | null; createdAt: string }[]>(`/rating/clubs/${clubId}/disputes`)
  return (
    <section className="panel stack">
      <h2>{t.clubreg.disputeTitle}</h2>
      <p className="small muted">{t.clubreg.disputeHint}</p>
      <Field label={t.clubreg.disputeSubject}>
        <select value={subject} onChange={(e) => setSubject(e.target.value as typeof subject)}>
          {SUBJECTS.map((s) => (
            <option key={s} value={s}>
              {t.clubreg.disputeSubjects[s]}
            </option>
          ))}
        </select>
      </Field>
      <Field label={t.clubreg.disputeRef}>
        <input value={ref} maxLength={60} onChange={(e) => setRef(e.target.value)} />
      </Field>
      <Field label={t.clubreg.disputeReason}>
        <textarea rows={3} value={reason} maxLength={2000} onChange={(e) => setReason(e.target.value)} />
      </Field>
      {act.notes}
      <button
        className="button"
        disabled={act.busy || reason.trim().length < 3}
        onClick={() =>
          void act.run(async () => {
            await api(`/clubs/${clubId}/disputes`, { method: 'POST', json: { subject, ref, reason } })
            setReason('')
            setRef('')
            list.reload()
            return t.clubreg.disputeSent
          })
        }
      >
        {t.clubreg.disputeSend}
      </button>
      <Async state={list}>
        {(items) => (
          <>
            {items
              .filter((d) => d.entity.startsWith('club_'))
              .map((d) => (
                <p key={d.id} className="small">
                  {formatDateTime(d.createdAt)} · {t.clubreg.disputeSubjects[d.entity.slice(5) as (typeof SUBJECTS)[number]] ?? d.entity} · <StatusChip status={d.status} />
                  <br />
                  {d.reason}
                  {d.resolution && <span className="muted"> — {d.resolution}</span>}
                </p>
              ))}
          </>
        )}
      </Async>
    </section>
  )
}
