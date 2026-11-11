import { Link } from 'react-router'
import type { Home as HomeData } from '../../api/types.ts'
import { useSession } from '../../app/auth.tsx'
import { useApi } from '../../app/hooks.ts'
import { t } from '../../i18n/index.ts'
import { Async, TournamentCard } from '../../ui/kit.tsx'

export function Home() {
  const { city } = useSession()
  const home = useApi<HomeData>(`/home?city=${city}`)
  return (
    <main className="page">
      <section className="hero">
        <span className="kicker">{t.home.eyebrow}</span>
        <h1>
          Играй. Расти. <em>Поднимайся в рейтинге.</em>
        </h1>
        <p>{t.home.lead}</p>
        <div className="row">
          <Link className="button button--primary" to="/tournaments">
            {t.home.allTournaments}
          </Link>
          <Link className="button" to="/clubs">
            {t.c.book}
          </Link>
        </div>
      </section>
      <Async state={home} skeleton={2}>
        {(h) => (
          <>
            {h.live.length > 0 && (
              <section className="stack">
                <h2>{t.home.live}</h2>
                <div className="grid grid--cards">
                  {h.live.map((x) => (
                    <TournamentCard key={x.id} slug={x.slug} title={x.title} startsAt={x.startsAt} fee={x.fee} max={x.max_participants} taken={x.taken} restrictions={x.restrictions} club={x.club} status={x.status} />
                  ))}
                </div>
              </section>
            )}
            <section className="stack">
              <div className="row row--between">
                <h2>{t.home.upcoming}</h2>
                <Link className="crumb" to="/tournaments">
                  {t.home.allTournaments} →
                </Link>
              </div>
              {h.upcoming.length ? (
                <div className="grid grid--cards">
                  {h.upcoming.map((x) => (
                    <TournamentCard key={x.id} slug={x.slug} title={x.title} startsAt={x.startsAt} fee={x.fee} max={x.max_participants} taken={x.taken} restrictions={x.restrictions} club={x.club} status={x.status} />
                  ))}
                </div>
              ) : (
                <p className="empty">{t.home.noUpcoming}</p>
              )}
            </section>
            <div className="grid grid--half">
              <section className="panel">
                <div className="panel__head">
                  <h2>{t.home.top}</h2>
                  <Link className="crumb" to="/rating">
                    {t.home.allRating} →
                  </Link>
                </div>
                <ol className="toplist">
                  {h.topPlayers.map((p) => (
                    <li key={p.id}>
                      <Link to={`/players/${p.id}`}>
                        <span className="rank">{String(p.rank).padStart(2, '0')}</span>
                        <b>{p.name}</b>
                        <span className="mono">{p.rating}</span>
                      </Link>
                    </li>
                  ))}
                </ol>
              </section>
              <section className="panel">
                <div className="panel__head">
                  <h2>{t.home.clubs}</h2>
                  <Link className="crumb" to="/clubs">
                    {t.home.allClubs} →
                  </Link>
                </div>
                <div className="linklist">
                  {h.clubsWithBooking.map((c) => (
                    <Link key={c.id} to={`/club/${c.slug}`}>
                      <div>
                        <b>{c.name}</b>
                        <span>{c.city}</span>
                      </div>
                      <span className="chip chip--ok">{t.c.booking}</span>
                    </Link>
                  ))}
                  {h.clubsWithBooking.length === 0 && <p className="empty">{t.c.empty}</p>}
                </div>
              </section>
            </div>
          </>
        )}
      </Async>
    </main>
  )
}
