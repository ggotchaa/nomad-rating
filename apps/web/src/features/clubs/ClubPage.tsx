import { Link, useParams } from 'react-router'
import { intlTag } from '../../i18n/locale.ts'
import type { ClubDetail, OpeningHours } from '../../api/types.ts'
import { useApi } from '../../app/hooks.ts'
import { t } from '../../i18n/index.ts'
import { hhmm } from '../../i18n/format.ts'
import { Async, TournamentCard } from '../../ui/kit.tsx'
import { HallPlan } from '../booking/HallPlan.tsx'

export const HoursList = ({ hours }: { hours: OpeningHours }) => (
  <div className="stack">
    {[1, 2, 3, 4, 5, 6, 7].map((d) => {
      const h = hours[String(d)]
      return (
        <div className="row row--between small" key={d}>
          <span className="muted">{t.c.days[d]}</span>
          <span className="mono">{h ? `${hhmm(h.open)}–${hhmm(h.close)}` : t.c.closed}</span>
        </div>
      )
    })}
  </div>
)

export function ClubPage() {
  const { slug } = useParams()
  const state = useApi<ClubDetail>(`/clubs/${slug}`)
  return (
    <main className="page">
      <Async state={state} skeleton={3}>
        {(c) => {
          const hall = c.halls[0]
          const bookable = hall?.tables.some((x) => x.bookable && x.status === 'active')
          const contacts = [c.contacts.telegram, c.contacts.email, c.contacts.telegramChannel, c.contacts.instagram].filter(Boolean)
          return (
            <>
              <header className="pagehead">
                <Link className="crumb" to="/clubs">
                  ← {t.c.title}
                </Link>
                <h1>{c.name}</h1>
                <p>
                  {c.city}
                  {hall ? ` · ${hall.address}` : ''}
                </p>
                {bookable && (
                  <div className="row">
                    <Link className="button button--primary" to={`/club/${c.slug}/booking`}>
                      {t.c.book}
                    </Link>
                  </div>
                )}
              </header>
              <div className="grid grid--2">
                <section className="panel">
                  <p className="prose">{c.description}</p>
                  {hall && (
                    <>
                      <div className="facts">
                        <div className="fact">
                          <span>{t.c.address}</span>
                          <b>{hall.address}</b>
                        </div>
                        <div className="fact">
                          <span>{t.t.tables}</span>
                          <b>{hall.tables.length}</b>
                        </div>
                        {Object.values(hall.equipment).length > 0 && (
                          <div className="fact">
                            <span>{t.c.equipment}</span>
                            <b>{Object.values(hall.equipment).join(' · ')}</b>
                          </div>
                        )}
                      </div>
                      {hall.howToFind && (
                        <p className="small muted">
                          <b>{t.c.howToFind}:</b> {hall.howToFind}
                        </p>
                      )}
                      {hall.parking && (
                        <p className="small muted">
                          <b>{t.c.parking}:</b> {hall.parking}
                        </p>
                      )}
                      {hall.commentForPlayers && <p className="note prose">{hall.commentForPlayers}</p>}
                      <h3>{t.c.hallPlan}</h3>
                      <HallPlan plan={hall.plan} tables={hall.tables} />
                    </>
                  )}
                </section>
                <div className="stack">
                  {hall && (
                    <section className="panel">
                      <h2>{t.c.hours}</h2>
                      <HoursList hours={hall.openingHours} />
                    </section>
                  )}
                  {contacts.length > 0 && (
                    <section className="panel">
                      <h2>{t.c.contacts}</h2>
                      <div className="stack small">
                        {contacts.map((x) => (
                          <span key={x}>{x}</span>
                        ))}
                      </div>
                    </section>
                  )}
                </div>
              </div>
              {c.upcomingTournaments.length > 0 && (
                <section className="stack">
                  <h2>{t.c.upcoming}</h2>
                  <div className="grid grid--cards">
                    {c.upcomingTournaments.map((x) => (
                      <TournamentCard key={x.id} slug={x.slug} title={x.title} startsAt={x.starts_at} fee={x.fee} max={x.max_participants} taken={0} restrictions={x.restrictions} club={c.name} status={x.status} hideSpots />
                    ))}
                  </div>
                </section>
              )}
              {c.pastTournaments.length > 0 && (
                <section className="panel">
                  <h2>{t.c.past}</h2>
                  <div className="linklist">
                    {c.pastTournaments.map((x) => (
                      <Link key={x.id} to={`/t/${x.slug}`}>
                        <b>{x.title}</b>
                        <span className="mono">{new Date(x.starts_at).toLocaleDateString(intlTag)}</span>
                      </Link>
                    ))}
                  </div>
                </section>
              )}
            </>
          )
        }}
      </Async>
    </main>
  )
}
