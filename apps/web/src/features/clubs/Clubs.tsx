import { useState } from 'react'
import { locale } from '../../i18n/locale.ts'
import { Link } from 'react-router'
import type { ClubCard } from '../../api/types.ts'
import { useSession } from '../../app/auth.tsx'
import { useApi } from '../../app/hooks.ts'
import { t } from '../../i18n/index.ts'
import { formatDate } from '../../i18n/format.ts'
import { Async } from '../../ui/kit.tsx'

export function Clubs() {
  const { cities, city } = useSession()
  const [where, setWhere] = useState(city)
  const list = useApi<ClubCard[]>(`/clubs${where ? `?city=${where}` : ''}`)
  return (
    <main className="page">
      <header className="pagehead">
        <h1>{t.c.title}</h1>
        <p>{t.c.lead}</p>
        <div className="filters">
          <select aria-label={t.common.city} value={where} onChange={(e) => setWhere(e.target.value)}>
            <option value="">{t.common.anyCity}</option>
            {cities.map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.name[locale]}
              </option>
            ))}
          </select>
        </div>
      </header>
      <Async state={list} skeleton={2}>
        {(rows) =>
          rows.length ? (
            <div className="grid grid--cards">
              {rows.map((c) => (
                <Link className="tcard" key={c.id} to={`/club/${c.slug}`}>
                  <div className="tcard__date">
                    <span>{c.city}</span>
                    <span>
                      {c.tables} {t.common.tables}
                    </span>
                  </div>
                  <h3>{c.name}</h3>
                  <p className="muted small">{c.address}</p>
                  <p className="muted small" style={{ display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                    {c.description}
                  </p>
                  <div className="row">
                    {c.bookingAvailable && <span className="chip chip--ok">{t.c.booking}</span>}
                    {c.nextTournamentAt && (
                      <span className="chip chip--holo">
                        {t.c.nextTournament}: {formatDate(c.nextTournamentAt)}
                      </span>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <p className="empty">{t.c.empty}</p>
          )
        }
      </Async>
    </main>
  )
}
