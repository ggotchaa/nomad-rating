import { Fragment, useState } from 'react'
import { Link, useParams } from 'react-router'
import type { H2H, PlayerMatch, PlayerProfile, PlayerTournament, RatingPoint } from '../../api/types.ts'
import { useSession } from '../../app/auth.tsx'
import { useApi } from '../../app/hooks.ts'
import { t } from '../../i18n/index.ts'
import { formatDateShort } from '../../i18n/format.ts'
import { Async, Delta, Seg } from '../../ui/kit.tsx'
import { RatingChart } from './RatingChart.tsx'
import { CalibratingMark, DisputeButton, RecalcBanner } from '../rating/widgets.tsx'

type Period = '3m' | '1y' | 'all'

function Matches({ rows, withTournament, mine }: { rows: PlayerMatch[]; withTournament?: boolean; mine?: boolean }) {
  return (
    <table className="table">
      <tbody>
        {rows.map((m) => (
          <tr key={m.matchId}>
            <td>
              <span className={`chip ${m.won ? 'chip--ok' : 'chip--bad'}`}>{m.score}</span>
            </td>
            <td>
              <Link to={`/players/${m.opponent.id}`}>{m.opponent.name}</Link> <span className="muted small mono">{m.opponent.rating ?? ''}</span>
              <div className="games">
                {withTournament ? `${formatDateShort(m.tournament.date)} · ${m.tournament.title}` : [m.stage, m.round].filter(Boolean).join(' · ')}
                {m.games.length > 0 && ` · ${m.games.map((g) => `${g.home}:${g.away}`).join(' ')}`}
              </div>
            </td>
            <td className="num">
              <Delta value={m.ratingDelta} />
              {mine && m.resultType !== 'walkover' && (
                <div>
                  <DisputeButton matchId={m.matchId} />
                </div>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function TournamentMatches({ playerId, tournamentId, mine }: { playerId: number; tournamentId: number; mine: boolean }) {
  const state = useApi<PlayerMatch[]>(`/players/${playerId}/tournaments/${tournamentId}/matches`)
  return <Async state={state}>{(rows) => <Matches rows={rows} mine={mine} />}</Async>
}

export function Profile() {
  const id = Number(useParams().id)
  const { me } = useSession()
  const [period, setPeriod] = useState<Period>('1y')
  const [kind, setKind] = useState<'singles' | 'doubles'>('singles')
  const [open, setOpen] = useState<number | null>(null)
  const profile = useApi<PlayerProfile>(`/players/${id}`)
  const history = useApi<RatingPoint[]>(`/players/${id}/rating-history?period=${period}&kind=${kind}`)
  const tournaments = useApi<PlayerTournament[]>(`/players/${id}/tournaments`)
  const best = useApi<PlayerMatch[]>(`/players/${id}/best-matches`)
  const myId = me.player?.id
  const h2h = useApi<H2H>(myId && myId !== id ? `/players/${myId}/h2h/${id}` : null)

  return (
    <main className="page">
      <Async state={profile} skeleton={3}>
        {(p) => {
          const r = p.ratings.find((x) => x.kind === 'singles')
          return (
            <>
              <header className="pagehead">
                <Link className="crumb" to="/rating">
                  ← {t.r.title}
                </Link>
                <div className="profile">
                  <div className="avatar" aria-hidden="true">
                    {p.name
                      .split(' ')
                      .map((w) => w[0])
                      .join('')}
                  </div>
                  <div className="stack">
                    <h1>
                      {p.name} {r && r.rating == null && <CalibratingMark />}
                    </h1>
                    <p>
                      {[p.city, `${p.birthYear} ${t.p.born}`, p.hand && t.p.hand[p.hand]].filter(Boolean).join(' · ')}
                    </p>
                    <div className="row">
                      {r?.provisional && r.rating != null && <span className="chip chip--warn">{t.t.calibrating} · {t.misc.ratingRefining}</span>}
                      {p.addedByClub && <span className="chip">{t.p.addedByClub}</span>}
                    </div>
                  </div>
                </div>
              </header>
              <RecalcBanner />
              {r && (
                <section className="panel">
                  <div className="facts">
                    <div className="fact stat">
                      <span>{t.p.rating}</span>
                      <b style={{ color: 'var(--holo)' }}>{r.rating ?? '—'}</b>
                    </div>
                    <div className="fact stat">
                      <span>{t.p.max}</span>
                      <b>{r.maxRating ?? '—'}</b>
                    </div>
                    <div className="fact stat">
                      <span>{t.p.placeKz}</span>
                      <b>{r.placeOverall ?? '—'}</b>
                    </div>
                    <div className="fact stat">
                      <span>{t.p.placeCity}</span>
                      <b>{r.placeCity ?? '—'}</b>
                    </div>
                    <div className="fact stat">
                      <span>{t.p.tournaments}</span>
                      <b>{r.tournaments}</b>
                    </div>
                    <div className="fact stat">
                      <span>{t.p.matches}</span>
                      <b>{r.matches}</b>
                    </div>
                    <div className="fact stat">
                      <span>{t.p.winRate}</span>
                      <b>{r.winRate == null ? '—' : `${r.winRate}%`}</b>
                    </div>
                  </div>
                  {r.calibration && <p className="note">{t.p.calibration(r.calibration.played, r.calibration.of)} · {t.misc.startLevel} {r.calibration.startLevel}</p>}
                </section>
              )}
              <section className="panel">
                <div className="panel__head">
                  <h2>{t.p.graph}</h2>
                  <Seg label={t.doubles.kind} value={kind} onChange={setKind} options={[['singles', t.doubles.singles], ['doubles', t.doubles.doubles]]} />
                  <Seg label={t.p.graph} value={period} onChange={setPeriod} options={(['3m', '1y', 'all'] as const).map((k) => [k, t.p.period[k]!] as const)} />
                </div>
                <Async state={history}>{(points) => <RatingChart points={points} />}</Async>
              </section>
              <div className="grid grid--2">
                <section className="panel">
                  <h2>{t.p.history}</h2>
                  <Async state={tournaments}>
                    {(rows) =>
                      rows.length ? (
                        <div className="tablewrap">
                          <table className="table">
                            <thead>
                              <tr>
                                <th>{t.m.date}</th>
                                <th>{t.t.title}</th>
                                <th className="num">{t.t.place}</th>
                                <th className="num">
                                  {t.t.w}–{t.t.l}
                                </th>
                                <th className="num">{t.t.change}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {rows.map((x) => (
                                <Fragment key={x.tournamentId}>
                                  <tr className="clickable" onClick={() => setOpen(open === x.tournamentId ? null : x.tournamentId)} aria-expanded={open === x.tournamentId}>
                                    <td className="mono small muted">{formatDateShort(x.date)}</td>
                                    <td>
                                      <Link to={`/t/${x.slug}`} onClick={(e) => e.stopPropagation()}>
                                        {x.title}
                                      </Link>
                                      <div className="small muted">{x.club}</div>
                                    </td>
                                    <td className="num">{x.place ?? '—'}</td>
                                    <td className="num">
                                      {x.wins}–{x.losses}
                                    </td>
                                    <td className="num">
                                      <Delta value={x.delta} />
                                    </td>
                                  </tr>
                                  {open === x.tournamentId && (
                                    <tr>
                                      <td colSpan={5}>
                                        <TournamentMatches playerId={id} tournamentId={x.tournamentId} mine={myId === id} />
                                      </td>
                                    </tr>
                                  )}
                                </Fragment>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <p className="empty">{t.p.noHistory}</p>
                      )
                    }
                  </Async>
                </section>
                <div className="stack">
                  {h2h.data && (
                    <section className="panel">
                      <h2>{t.p.h2h}</h2>
                      {h2h.data.matches.length ? (
                        <>
                          <p className="stat">
                            <b>
                              <span className="up">{h2h.data.wins}</span> : <span className="down">{h2h.data.losses}</span>
                            </b>
                          </p>
                          <Matches rows={h2h.data.matches} withTournament />
                        </>
                      ) : (
                        <p className="muted">{t.p.h2hNone}</p>
                      )}
                    </section>
                  )}
                  <section className="panel">
                    <h2>{t.p.best}</h2>
                    <Async state={best}>{(rows) => (rows.length ? <Matches rows={rows} withTournament /> : <p className="empty">—</p>)}</Async>
                  </section>
                </div>
              </div>
            </>
          )
        }}
      </Async>
    </main>
  )
}
