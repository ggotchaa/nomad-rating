import { useState } from 'react'
import { locale } from '../../i18n/locale.ts'
import type { TournamentCard as Card } from '../../api/types.ts'
import { useSession } from '../../app/auth.tsx'
import { useApi } from '../../app/hooks.ts'
import { t } from '../../i18n/index.ts'
import { Async, Seg, TournamentCard } from '../../ui/kit.tsx'

type When = 'upcoming' | 'live' | 'finished'

export function Calendar() {
  const { me, cities, city } = useSession()
  const [when, setWhen] = useState<When>('upcoming')
  const [where, setWhere] = useState(city)
  const [fitsMe, setFitsMe] = useState(false)
  const [hasSpots, setHasSpots] = useState(false)
  const query = new URLSearchParams({ when })
  if (where) query.set('city', where)
  if (fitsMe) query.set('fitsMe', 'true')
  if (hasSpots) query.set('hasSpots', 'true')
  const list = useApi<Card[]>(`/tournaments?${query}`)

  return (
    <main className="page">
      <header className="pagehead">
        <h1>{t.t.title}</h1>
        <div className="filters">
          <Seg
            label={t.t.title}
            value={when}
            onChange={setWhen}
            options={[
              ['upcoming', t.t.upcoming],
              ['live', t.t.live],
              ['finished', t.t.finished],
            ]}
          />
          <select aria-label={t.common.city} value={where} onChange={(e) => setWhere(e.target.value)}>
            <option value="">{t.common.anyCity}</option>
            {cities.map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.name[locale]}
              </option>
            ))}
          </select>
          {when === 'upcoming' && (
            <>
              <label className="check">
                <input type="checkbox" checked={hasSpots} onChange={(e) => setHasSpots(e.target.checked)} />
                {t.t.hasSpots}
              </label>
              {me.player && (
                <label className="check">
                  <input type="checkbox" checked={fitsMe} onChange={(e) => setFitsMe(e.target.checked)} />
                  {t.t.fitsMe}
                </label>
              )}
            </>
          )}
        </div>
      </header>
      <Async state={list} skeleton={3}>
        {(rows) =>
          rows.length ? (
            <div className="grid grid--cards">
              {rows.map((x) => (
                <TournamentCard key={x.id} slug={x.slug} title={x.title} startsAt={x.startsAt} fee={x.fee} max={x.maxParticipants} taken={x.taken} restrictions={x.restrictions} club={x.club.name} city={x.city} status={x.status} />
              ))}
            </div>
          ) : (
            <p className="empty">{t.t.empty}</p>
          )
        }
      </Async>
    </main>
  )
}
