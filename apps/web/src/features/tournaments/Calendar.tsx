import { useState } from 'react'
import { Link } from 'react-router'
import { intlTag, locale } from '../../i18n/locale.ts'
import { formatTime, localDate } from '../../i18n/format.ts'
import type { TournamentCard as Card } from '../../api/types.ts'
import { useSession } from '../../app/auth.tsx'
import { useApi } from '../../app/hooks.ts'
import { t } from '../../i18n/index.ts'
import { Async, Seg, TournamentCard } from '../../ui/kit.tsx'

type When = 'all' | 'upcoming' | 'live' | 'finished'

const DAY = 86400000

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
        <h2>
          {new Intl.DateTimeFormat(intlTag, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
            new Date(Date.UTC(y, m - 1, 1)),
          )}
        </h2>
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
            <div
              key={iso}
              className={`monthgrid__day${iso === today ? ' is-today' : ''}${list.length ? ' has-events' : ''}`}
            >
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

const cards = (rows: Card[], past = false) => (
  <div className="grid grid--cards">
    {rows.map((x) => (
      <TournamentCard
        key={x.id}
        slug={x.slug}
        title={x.title}
        startsAt={x.startsAt}
        fee={x.fee}
        max={x.maxParticipants}
        taken={x.taken}
        restrictions={x.restrictions}
        club={x.club.name}
        city={x.city}
        status={x.status}
        tone={past ? 'past' : x.status === 'running' ? 'live' : undefined}
      />
    ))}
  </div>
)

/** «Все» (the default): running and upcoming; finished ones fold out above the «now» line on demand. */
function AllView({ rows }: { rows: Card[] }) {
  const [showPast, setShowPast] = useState(false)
  const past = new Set(['finished', 'finished_early', 'cancelled'])
  const finished = rows.filter((x) => past.has(x.status))
  const live = rows.filter((x) => x.status === 'running')
  const upcoming = rows.filter((x) => !past.has(x.status) && x.status !== 'running')
  if (!rows.length) return <p className="empty">{t.t.empty}</p>
  return (
    <>
      {finished.length > 0 && (
        <div>
          <button className="button button--sm" aria-expanded={showPast} onClick={() => setShowPast(!showPast)}>
            {showPast ? t.t.hidePast : t.t.showPast(finished.length)}
          </button>
        </div>
      )}
      {showPast && finished.length > 0 && (
        <section className="stack">
          <h2 className="muted">{t.t.finished}</h2>
          {cards(finished.slice().reverse(), true)}
        </section>
      )}
      <div className="row row--between">
        <h2>
          <span className="dot" style={{ display: 'inline-block', marginRight: 8, color: 'var(--accent)' }} />
          {t.t.nowLine}
        </h2>
        {showPast && <span className="small muted">{t.t.allHint}</span>}
      </div>
      {live.length > 0 && cards(live)}
      {upcoming.length > 0 && (
        <section className="stack">
          <h2 className="muted">{t.t.upcoming}</h2>
          {cards(upcoming)}
        </section>
      )}
      {!live.length && !upcoming.length && <p className="empty">{t.t.empty}</p>}
    </>
  )
}

export function Calendar() {
  const { me, cities, city } = useSession()
  const [when, setWhen] = useState<When>('all')
  const [where, setWhere] = useState(city)
  const [fitsMe, setFitsMe] = useState(false)
  const [hasSpots, setHasSpots] = useState(false)
  const [view, setView] = useState<'list' | 'month'>('list')
  const query = new URLSearchParams({ when })
  if (where) query.set('city', where)
  if (fitsMe) query.set('fitsMe', 'true')
  if (hasSpots) query.set('hasSpots', 'true')
  if (when === 'all') {
    // Day-aligned bounds: a timestamp that moves every render would make the URL — and the request — loop.
    const today = Math.floor(Date.now() / DAY) * DAY
    query.set('from', new Date(today - 60 * DAY).toISOString())
    query.set('to', new Date(today + 365 * DAY).toISOString())
    query.set('limit', '100')
  }
  const list = useApi<Card[]>(`/tournaments?${query}`)
  const canCreate = me.clubs.some((c) => c.role === 'organizer' || c.rights.includes('tournaments'))

  return (
    <main className="page">
      <header className="pagehead">
        <div className="row row--between">
          <h1>{t.t.title}</h1>
          {canCreate && (
            <Link className="button button--primary" to="/manage/tournaments/new">
              + {t.t.createTournament}
            </Link>
          )}
        </div>
        <div className="filters">
          <Seg
            label={t.t.title}
            value={when}
            onChange={setWhen}
            options={[
              ['all', t.t.all],
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
          {when !== 'finished' && (
            <>
              <label className="check check--pill">
                <input type="checkbox" checked={hasSpots} onChange={(e) => setHasSpots(e.target.checked)} />
                {t.t.hasSpots}
              </label>
              {me.player && (
                <label className="check check--pill">
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
          ) : when === 'all' ? (
            <AllView rows={rows} />
          ) : rows.length ? (
            cards(rows, when === 'finished')
          ) : (
            <p className="empty">{t.t.empty}</p>
          )
        }
      </Async>
    </main>
  )
}
