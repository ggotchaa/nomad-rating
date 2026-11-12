// Live data under the story: upcoming tournaments by city, top players, clubs with booking.

import { forwardRef, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { api } from '../../api/client.ts'
import type { City, ClubCard, Home } from '../../api/types.ts'
import { t as m } from '../../i18n/index.ts'
import { locale } from '../../i18n/locale.ts'
import { LangLinks } from '../../ui/Lang.tsx'
import { formatDate, formatTenge, formatTime, restrictionLabel } from '../../i18n/format.ts'

export const LiveSection = forwardRef<HTMLElement>(function LiveSection(_props, ref) {
  const [cities, setCities] = useState<City[]>([])
  const [city, setCity] = useState('almaty')
  const [home, setHome] = useState<Home | null>(null)
  const [clubs, setClubs] = useState<ClubCard[]>([])
  const [error, setError] = useState(false)

  useEffect(() => {
    api<City[]>('/cities')
      .then(setCities)
      .catch(() => setError(true))
    api<ClubCard[]>('/clubs')
      .then(setClubs)
      .catch(() => setError(true))
  }, [])

  useEffect(() => {
    setHome(null)
    api<Home>(`/home?city=${encodeURIComponent(city)}`)
      .then(setHome)
      .catch(() => setError(true))
  }, [city])

  const cityClubs = clubs.filter((c) => c.citySlug === city)

  return (
    <section className="live" id="live" ref={ref}>
      <div className="live__inner">
        <header className="live__head">
          <div>
            <p className="eyebrow">{m.landing.liveEyebrow}</p>
            <h2>
              {m.landing.liveTitle} <em>{cities.find((c) => c.slug === city)?.name[locale] ?? ''}</em>
            </h2>
          </div>
          <div className="tabs" role="tablist" aria-label={m.landing.cityAria}>
            {cities
              .filter((c) => clubs.some((club) => club.citySlug === c.slug))
              .map((c) => (
                <button key={c.slug} role="tab" aria-selected={c.slug === city} className={c.slug === city ? 'is-active' : ''} onClick={() => setCity(c.slug)}>
                  {c.name[locale]}
                </button>
              ))}
          </div>
        </header>

        {error && <p className="live__error">{m.landing.loadFail}</p>}

        {home && home.live.length > 0 && (
          <div className="live__now">
            <span className="dot" /> {m.landing.liveNow}: {home.live.map((t) => t.title).join(', ')}
          </div>
        )}

        <div className="cards">
          {(home?.upcoming ?? Array.from({ length: 3 }, () => null)).map((t, i) =>
            t ? (
              <Link className="card" key={t.id} to={`/t/${t.slug}`}>
                <div className="card__date">
                  <b>{formatDate(t.startsAt)}</b>
                  <span>{formatTime(t.startsAt)}</span>
                </div>
                <h3>{t.title}</h3>
                <p className="card__club">{t.club}</p>
                <div className="card__meta">
                  {restrictionLabel(t.restrictions) && <span className="badge">{restrictionLabel(t.restrictions)}</span>}
                  <span className="badge badge--ghost">{formatTenge(t.fee)}</span>
                </div>
                <div className="meter" aria-label={m.landing.taken(t.taken, t.max_participants)}>
                  <div style={{ width: `${Math.min(100, (t.taken / t.max_participants) * 100)}%` }} />
                </div>
                <p className="card__spots">
                  {t.taken >= t.max_participants ? m.landing.full : m.landing.taken(t.taken, t.max_participants)}
                </p>
              </Link>
            ) : (
              <div className="card card--skeleton" key={i} />
            ),
          )}
          {home && home.upcoming.length === 0 && <p className="live__empty">{m.home.noUpcoming}</p>}
        </div>

        <div className="live__grid">
          <section className="panel" aria-labelledby="top-title">
            <h3 id="top-title">{m.landing.top10}</h3>
            <ol className="top">
              {(home?.topPlayers ?? []).map((p) => (
                <li key={p.id}>
                  <span className="top__rank">{String(p.rank).padStart(2, '0')}</span>
                  <Link className="top__name" to={`/players/${p.id}`}>{p.name}</Link>
                  <span className="top__rating">{p.rating}</span>
                </li>
              ))}
            </ol>
          </section>
          <section className="panel" id="clubs" aria-labelledby="clubs-title">
            <h3 id="clubs-title">{m.landing.clubsBooking}</h3>
            <ul className="clubs">
              {cityClubs.map((c) => (
                <li key={c.id}>
                  <div>
                    <Link to={`/club/${c.slug}`}><b>{c.name}</b></Link>
                    <span>{c.address}</span>
                  </div>
                  <span className="badge badge--ghost">{m.landing.tablesCount(c.tables)}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
      <footer className="footer">
        <span>© 2026 Nomad</span>
        <span>{m.landing.footer} · <LangLinks /></span>
      </footer>
    </section>
  )
})
