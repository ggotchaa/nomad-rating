import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import type { City, ClubCard } from '../../api/types.ts'
import { useSession } from '../../app/auth.tsx'
import { useApi } from '../../app/hooks.ts'
import { t } from '../../i18n/index.ts'
import { locale } from '../../i18n/locale.ts'
import { Async } from '../../ui/kit.tsx'

/** Table booking entry: city from the reference list → clubs of that city that take online bookings. */
export function BookingIndex() {
  const { cities, city, setCity } = useSession()
  const [where, setWhere] = useState(city)
  const clubs = useApi<ClubCard[]>(where ? `/clubs?city=${where}` : null)
  const byRegion = useMemo(() => {
    const groups = new Map<string, City[]>()
    for (const c of cities) {
      const region = c.regionName?.[locale] || c.region
      groups.set(region, [...(groups.get(region) ?? []), c])
    }
    return [...groups.entries()]
  }, [cities])
  const withClubs = cities.filter((c) => (c.bookingClubs ?? 0) > 0)
  const pick = (slug: string) => {
    setWhere(slug)
    setCity(slug)
  }

  return (
    <main className="page">
      <header className="pagehead">
        <span className="kicker">{t.bookIdx.kicker}</span>
        <h1>{t.bookIdx.title}</h1>
        <p>{t.bookIdx.lead}</p>
        <div className="filters">
          <select aria-label={t.common.city} value={where} onChange={(e) => pick(e.target.value)}>
            {byRegion.map(([region, list]) => (
              <optgroup key={region} label={region}>
                {list.map((c) => (
                  <option key={c.slug} value={c.slug}>
                    {c.name[locale]}
                    {c.bookingClubs ? ` · ${c.bookingClubs}` : ''}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
      </header>
      <Async state={clubs} skeleton={2}>
        {(rows) => {
          const open = rows.filter((c) => c.bookingAvailable)
          if (!open.length)
            return (
              <div className="panel stack">
                <p className="empty">{t.bookIdx.empty}</p>
                {withClubs.length > 0 && (
                  <>
                    <p className="muted small">{t.bookIdx.citiesWith}</p>
                    <div className="row">
                      {withClubs.map((c) => (
                        <button key={c.slug} type="button" className="button button--sm" onClick={() => pick(c.slug)}>
                          {c.name[locale]} · {c.bookingClubs}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )
          return (
            <div className="grid grid--cards">
              {open.map((c) => (
                <article className="tcard" key={c.id}>
                  <div className="tcard__date">
                    <span>{c.city}</span>
                    <span>
                      {c.tables} {t.common.tables}
                    </span>
                  </div>
                  <h3>{c.name}</h3>
                  <p className="muted small">{c.address}</p>
                  <div className="row">
                    <Link className="button button--primary button--sm" to={`/club/${c.slug}/booking`}>
                      {t.bookIdx.book}
                    </Link>
                    <Link className="button button--sm" to={`/club/${c.slug}`}>
                      {t.common.more}
                    </Link>
                  </div>
                </article>
              ))}
            </div>
          )
        }}
      </Async>
    </main>
  )
}
