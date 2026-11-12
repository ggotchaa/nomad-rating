import { useState } from 'react'
import { intlTag } from '../../i18n/locale.ts'
import { Link, useParams } from 'react-router'
import { api } from '../../api/client.ts'
import { useSession } from '../../app/auth.tsx'
import { useApi } from '../../app/hooks.ts'
import { errorText, t } from '../../i18n/index.ts'
import { formatTenge } from '../../i18n/format.ts'
import { Async, StatusChip } from '../../ui/kit.tsx'

export type LeagueRow = { id: number; slug: string; name: string; format: string; description: string; club: string; club_slug: string; season_id: number | null }
export type TableRow = { participantId: number; playerId: number; name: string; rating: number | null; divisionId: number | null; status: string; missedTours: number; total: number; tours: number; dropped: number[] }
type Fixture = { id: number; divisionId: number | null; round: number; status: string; home: { id: number; name?: string }; away: { id: number; name?: string }; startsAt: string | null; setsHome: number | null; setsAway: number | null; proposedBy: number | null; reportedBy: number | null }
export type SeasonView = {
  id: number
  name: string
  status: string
  startsOn: string
  endsOn: string
  format: string
  rules: { bestTours: number | null; boundaries: { promote: number; relegate: number }[] }
  payment: { mode?: string; seasonPrice?: number; tourPrice?: number; topUp?: number }
  divisions: { id: number; name: string; level: number; rows: TableRow[] }[]
  table: TableRow[]
  tours: { id: number; number: number; kind: string; startsAt: string; status: string; tournaments: { id: number; slug: string; title: string; status: string; league_division_id: number | null }[] }[]
  moves: { participantId: number; name?: string; from: number | null; to: number | null; reason: string }[]
  fixtures: Fixture[]
}
type LeaguePageData = LeagueRow & { isStaff: boolean; seasons: { id: number; name: string; status: string }[]; current: SeasonView | null }

export function LeaguesList() {
  const list = useApi<LeagueRow[]>('/leagues')
  return (
    <main className="page">
      <header className="pagehead">
        <h1>{t.leagues.title}</h1>
        <p>{t.leagues.lead}</p>
      </header>
      <Async state={list}>
        {(rows) =>
          rows.length ? (
            <div className="grid grid--cards">
              {rows.map((l) => (
                <Link key={l.id} className="panel stack" to={`/leagues/${l.slug}`}>
                  <h2>{l.name}</h2>
                  <span className="muted small">
                    {l.club} · {t.leagues.formats[l.format]}
                  </span>
                </Link>
              ))}
            </div>
          ) : (
            <p className="empty">{t.leagues.empty}</p>
          )
        }
      </Async>
    </main>
  )
}

export function SeasonTables({ s }: { s: SeasonView }) {
  const divs = s.divisions.length > 1 ? s.divisions : [{ id: 0, name: t.leagues.table, level: 1, rows: s.table }]
  return (
    <div className="grid grid--2">
      {divs.map((d) => (
        <section key={d.id} className="panel">
          <h2>{d.name}</h2>
          <div className="tablewrap">
            <table className="table">
              <tbody>
                {d.rows.map((r, i) => (
                  <tr key={r.participantId}>
                    <td>{i + 1}</td>
                    <td>
                      <Link to={`/players/${r.playerId}`}>{r.name}</Link> {r.status === 'frozen' && <span className="chip">{t.leagues.frozen}</span>}
                    </td>
                    <td className="muted small">{r.rating ?? '—'}</td>
                    <td className="muted small">{r.missedTours ? `${r.missedTours} ${t.leagues.missed}` : ''}</td>
                    <td>
                      <b>{r.total}</b>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  )
}

function FixtureRow({ f, me, reload }: { f: Fixture; me: number | null; reload: () => void }) {
  const [when, setWhen] = useState('')
  const [table, setTable] = useState('')
  const [score, setScore] = useState({ mine: 3, opp: 0 })
  const [error, setError] = useState('')
  const act = (action: string, json: unknown = {}) =>
    api(`/leagues/fixtures/${f.id}/${action}`, { method: 'POST', json })
      .then(reload)
      .catch((e: unknown) => setError(errorText(e)))
  return (
    <li className="stack">
      <div className="row row--between">
        <span>
          {f.round}. {f.home.name} — {f.away.name} {f.setsHome != null && <b>{f.setsHome}:{f.setsAway}</b>} {f.startsAt && <span className="muted small">{new Date(f.startsAt).toLocaleString(intlTag)}</span>}
        </span>
        <span className="chip">{t.leagues.fixtureStatus[f.status]}</span>
      </div>
      {me != null && (
        <div className="row">
          {['pending', 'proposed', 'scheduled'].includes(f.status) && (
            <>
              <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
              <input type="number" placeholder={t.misc.tableIdPlaceholder} value={table} onChange={(e) => setTable(e.target.value)} style={{ width: 90 }} />
              <button className="button button--sm" disabled={!when || !table} onClick={() => void act('propose', { startsAt: new Date(when).toISOString(), tableId: Number(table) })}>
                {t.leagues.propose}
              </button>
            </>
          )}
          {f.status === 'proposed' && f.proposedBy !== me && (
            <button className="button button--sm button--primary" onClick={() => void act('confirm')}>
              {t.leagues.confirm}
            </button>
          )}
          {['pending', 'scheduled', 'proposed'].includes(f.status) && (
            <>
              <input type="number" min={0} max={4} value={score.mine} onChange={(e) => setScore({ ...score, mine: Number(e.target.value) })} style={{ width: 52 }} />
              <input type="number" min={0} max={4} value={score.opp} onChange={(e) => setScore({ ...score, opp: Number(e.target.value) })} style={{ width: 52 }} />
              <button className="button button--sm" onClick={() => void act('report', { setsMine: score.mine, setsOpponent: score.opp })}>
                {t.leagues.report}
              </button>
            </>
          )}
          {f.status === 'reported' && f.reportedBy !== me && (
            <>
              <button className="button button--sm button--primary" onClick={() => void act('confirm-result', { accept: true })}>
                {t.leagues.confirmResult}
              </button>
              <button className="button button--sm" onClick={() => void act('confirm-result', { accept: false })}>
                {t.leagues.rejectResult}
              </button>
            </>
          )}
        </div>
      )}
      {error && <p className="note note--error">{error}</p>}
    </li>
  )
}

export function LeaguePage() {
  const { slug } = useParams()
  const data = useApi<LeaguePageData>(`/leagues/${slug}`)
  const { me } = useSession()
  const [error, setError] = useState('')
  const post = (path: string, json: unknown = {}) =>
    api(path, { method: 'POST', json })
      .then(data.reload)
      .catch((e: unknown) => setError(errorText(e)))
  return (
    <main className="page">
      <Async state={data} skeleton={3}>
        {(l) => {
          const s = l.current
          const mine = s?.table.find((r) => r.playerId === me.player?.id)
          const name = (id: number | null) => s?.divisions.find((d) => d.id === id)?.name ?? '—'
          return (
            <>
              <header className="pagehead">
                <Link className="crumb" to="/leagues">
                  ← {t.leagues.title}
                </Link>
                <h1>{l.name}</h1>
                <p>
                  {l.club} · {t.leagues.formats[l.format]}
                </p>
                {l.description && <p className="muted">{l.description}</p>}
              </header>
              {s && (
                <>
                  <section className="panel stack">
                    <div className="panel__head">
                      <h2>
                        {t.leagues.season}: {s.name}
                      </h2>
                      <span className="chip">{t.leagues.status[s.status]}</span>
                    </div>
                    <p className="small muted">
                      {s.startsOn.slice(0, 10)} — {s.endsOn.slice(0, 10)}
                      {s.rules.bestTours ? ` · ${t.leagues.bestTours(s.rules.bestTours)}` : ''}
                      {s.payment.mode && ` · ${t.leagues.payment}: ${t.leagues.paymentModes[s.payment.mode]}${s.payment.seasonPrice ? ` ${formatTenge(s.payment.seasonPrice)}` : ''}${s.payment.tourPrice ? ` / ${formatTenge(s.payment.tourPrice)}` : ''}`}
                    </p>
                    {me.player && !mine && ['registration', 'active'].includes(s.status) && (
                      <button className="button button--primary" onClick={() => void post(`/leagues/seasons/${s.id}/join`)}>
                        {t.leagues.join}
                      </button>
                    )}
                    {mine?.status === 'invited' && (
                      <div className="row">
                        <button className="button button--primary" onClick={() => void post(`/leagues/seasons/${s.id}/confirm`, { accept: true })}>
                          {t.leagues.confirmParticipation}
                        </button>
                        <button className="button" onClick={() => void post(`/leagues/seasons/${s.id}/confirm`, { accept: false })}>
                          {t.leagues.declineParticipation}
                        </button>
                      </div>
                    )}
                    {error && <p className="note note--error">{error}</p>}
                  </section>
                  <SeasonTables s={s} />
                  {s.tours.length > 0 && (
                    <section className="panel">
                      <h2>{t.leagues.tours}</h2>
                      <ul className="stack">
                        {s.tours.map((tour) => (
                          <li key={tour.id} className="stack">
                            <div className="row row--between">
                              <b>
                                {tour.kind === 'playoff' ? t.leagues.playoff : t.leagues.tour(tour.number)} · {new Date(tour.startsAt).toLocaleDateString(intlTag)}
                              </b>
                              <span className="chip">{t.leagues.tourStatus[tour.status] ?? tour.status}</span>
                            </div>
                            <div className="row">
                              {tour.tournaments.map((x) => (
                                <Link key={x.id} to={`/t/${x.slug}`} className="row">
                                  {name(x.league_division_id)} <StatusChip status={x.status} />
                                </Link>
                              ))}
                            </div>
                          </li>
                        ))}
                      </ul>
                    </section>
                  )}
                  {s.moves.length > 0 && (
                    <section className="panel">
                      <h2>{t.leagues.moves}</h2>
                      <ul className="stack small">
                        {s.moves.slice(0, 30).map((m, i) => (
                          <li key={i}>
                            {m.name} · {name(m.from)} → {name(m.to)} · {t.leagues.reasons[m.reason] ?? m.reason}
                          </li>
                        ))}
                      </ul>
                    </section>
                  )}
                  {s.fixtures.length > 0 && (
                    <section className="panel">
                      <h2>{t.leagues.fixtures}</h2>
                      <ul className="stack">
                        {s.fixtures.map((f) => (
                          <FixtureRow key={f.id} f={f} me={mine && (f.home.id === mine.participantId || f.away.id === mine.participantId) ? mine.participantId : null} reload={data.reload} />
                        ))}
                      </ul>
                    </section>
                  )}
                </>
              )}
            </>
          )
        }}
      </Async>
    </main>
  )
}
