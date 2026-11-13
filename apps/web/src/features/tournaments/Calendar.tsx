import { useState } from 'react'
import { Link } from 'react-router'
import { intlTag, locale } from '../../i18n/locale.ts'
import { formatTime, localDate } from '../../i18n/format.ts'
import type { TournamentCard as Card } from '../../api/types.ts'
import { useSession } from '../../app/auth.tsx'
import { useApi } from '../../app/hooks.ts'
import { t } from '../../i18n/index.ts'
import { Async, Seg, TournamentCard } from '../../ui/kit.tsx'

type When = 'upcoming' | 'live' | 'finished'

function MonthGrid({ rows }: { rows: Card[] }) {
  const first = rows.length ? localDate(new Date(rows[0]!.startsAt)) : localDate()
  const [ym, setYm] = useState(first.slice(0, 7))
  const [y, m] = ym.split('-').map(Number) as [number, number]
  const shift = (d: number) => {
    const x = new Date(Date.UTC(y, m - 1 + d, 1))
    setYm(x.toISOString().slice(0, 7))
  }
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const lead = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7
  const byDay = new Map<number, Card[]>()
  for (const r of rows) {
    const d = localDate(new Date(r.startsAt))
    if (d.startsWith(ym)) byDay.set(Number(d.slice(8)), [...(byDay.get(Number(d.slice(8))) ?? []), r])
  }
  const today = localDate()
  const weekday = new Intl.DateTimeFormat(intlTag, { weekday: 'short', timeZone: 'UTC' })
  return (
    <section className="panel stack">
      <div className="row row--between">
        <button className="button button--sm" onClick={() => shift(-1)} aria-label="←">
          ←
        </button>
        <h2>{new Intl.DateTimeFormat(intlTag, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, 1)))}</h2>
        <button className="button button--sm" onClick={() => shift(1)} aria-label="→">
          →
        </button>
      </div>
      <div className="monthgrid">
        {Array.from({ length: 7 }, (_, i) => (
          <span key={`w${i}`} className="monthgrid__wd">
            {weekday.format(new Date(Date.UTC(2024, 0, 1 + i)))}
          </span>
        ))}
        {Array.from({ length: lead }, (_, i) => (
          <span key={`e${i}`} />
        ))}
        {Array.from({ length: days }, (_, i) => {
          const list = byDay.get(i + 1) ?? []
          const iso = `${ym}-${String(i + 1).padStart(2, '0')}`
          return (
            <div key={iso} className={`monthgrid__day${iso === today ? ' is-today' : ''}${list.length ? ' has-events' : ''}`}>
              <span className="mono small">{i + 1}</span>
              {list.map((x) => (
                <Link key={x.id} to={`/t/${x.slug}`} title={`${x.title} · ${x.club.name}`}>
                  <span className="mono">{formatTime(x.startsAt)}</span> {x.title}
                </Link>
              ))}
            </div>
          )
        })}
      </div>
    </section>
  )
}

export function Calendar() {
  const { me, cities, city } = useSession()
  const [when, setWhen] = useState<When>('upcoming')
  const [where, setWhere] = useState(city)
  const [fitsMe, setFitsMe] = useState(false)
  const [hasSpots, setHasSpots] = useState(false)
  const [view, setView] = useState<'list' | 'month'>('list')
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
          <Seg
            label={t.t.view}
            value={view}
            onChange={setView}
            options={[
              ['list', t.t.viewList],
              ['month', t.t.viewMonth],
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
          view === 'month' ? (
            <MonthGrid rows={rows} />
          ) : rows.length ? (
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
