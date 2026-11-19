import { Link, Navigate } from 'react-router'
import type { MyEntry } from '../../api/types.ts'
import { useSession } from '../../app/auth.tsx'
import { useApi } from '../../app/hooks.ts'
import { t } from '../../i18n/index.ts'
import { formatDateTime } from '../../i18n/format.ts'
import { Async, StatusChip } from '../../ui/kit.tsx'
import { LiveDeltas } from '../rating/widgets.tsx'
import { MyBookings } from '../booking/MyBookings.tsx'

const ACTIVE_ENTRY = ['awaiting_payment', 'paid', 'checked_in', 'playing', 'assembling', 'waitlist', 'invited']

/** «Ближайший турнир»: the nearest tournament I'm in that hasn't finished. */
function NextTournament({ rows }: { rows: MyEntry[] }) {
  const soon = Date.now() - 12 * 3600_000
  const next = rows
    .filter(
      (e) =>
        ['published', 'registration_closed', 'running'].includes(e.tournament_status) &&
        ACTIVE_ENTRY.includes(e.status) &&
        (e.tournament_status === 'running' || new Date(e.starts_at).getTime() > soon),
    )
    .sort((a, b) => +new Date(a.starts_at) - +new Date(b.starts_at))[0]
  return (
    <section className="panel">
      <div className="panel__head">
        <h2>{t.me.next}</h2>
        {next && <StatusChip status={next.tournament_status} />}
      </div>
      {next ? (
        <div className="row row--between">
          <div>
            <Link to={`/t/${next.slug}`}>
              <b>{next.title}</b>
            </Link>
            <div className="small muted">
              {formatDateTime(next.starts_at)} · {next.club}
            </div>
          </div>
          <Link className="button button--primary button--sm" to={`/t/${next.slug}`}>
            {t.me.nextMatch}
          </Link>
        </div>
      ) : (
        <p className="empty">{t.me.noNext}</p>
      )}
    </section>
  )
}

export function Cabinet() {
  const { me, ready } = useSession()
  const entries = useApi<MyEntry[]>(me.player ? '/my/entries' : null)

  if (ready && !me.user) return <Navigate to="/login" replace />
  if (!me.player)
    return <main className="page">{ready && <p className="note">{t.errors['player.profile_required']}</p>}</main>

  return (
    <main className="page">
      <header className="pagehead">
        <h1>{t.me.title}</h1>
        <p>
          {me.player.last_name} {me.player.first_name} · {me.player.city} · {t.p.rating.toLowerCase()}{' '}
          <b style={{ color: 'var(--holo)' }}>{me.player.rating ?? `— (${t.t.calibrating})`}</b>
        </p>
        <div className="row">
          <Link className="button button--sm" to={`/players/${me.player.id}`}>
            {t.me.profile}
          </Link>
          <Link className="button button--sm" to="/notifications">
            {t.notif.settings}
          </Link>
          <Link className="button button--sm" to="/me/teams">
            {t.teams.title}
          </Link>
          <Link className="button button--sm" to="/me/profile">
            {t.acc.profileEdit}
          </Link>
          <Link className="button button--sm" to="/me/security">
            {t.acc.security}
          </Link>
          <Link className="button button--sm" to="/me/rttf">
            {t.rttf.title}
          </Link>
          <Link className="button button--sm" to="/clubs/new">
            {t.clubreg.cta}
          </Link>
        </div>
      </header>
      <LiveDeltas />
      {entries.data && <NextTournament rows={entries.data} />}
      <div className="grid grid--half">
        <section className="panel">
          <h2>{t.me.entries}</h2>
          <Async state={entries}>
            {(rows) =>
              rows.length ? (
                <div className="linklist">
                  {rows.map((e) => (
                    <Link key={e.id} to={`/t/${e.slug}`}>
                      <div>
                        <b>{e.title}</b>
                        <span>
                          {formatDateTime(e.starts_at)} · {e.club}
                        </span>
                      </div>
                      <div className="stack" style={{ justifyItems: 'end' }}>
                        <StatusChip status={e.tournament_status} />
                        <span className="chip">
                          {e.final_place ? `${t.t.place}: ${e.final_place}` : (t.t.entryStatus[e.status] ?? e.status)}
                        </span>
                      </div>
                    </Link>
                  ))}
                </div>
              ) : (
                <p className="empty">{t.me.noEntries}</p>
              )
            }
          </Async>
        </section>
        <MyBookings
          title={t.me.bookings}
          footer={
            <Link className="crumb" to="/clubs">
              {t.c.book} →
            </Link>
          }
        />
      </div>
    </main>
  )
}
