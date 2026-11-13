import { Link } from 'react-router'
import type { EntryRef, MatchView, StageView, StandingRow } from '../../api/types.ts'
import { t } from '../../i18n/index.ts'

function sourceLabel(source: unknown): string {
  const s = source as { kind?: string; match?: number; seed?: number } | null
  if (s?.kind === 'winner') return t.misc.winnerOf(s.match ?? 0)
  if (s?.kind === 'loser') return `−${s.match}`
  if (s?.kind === 'seed') return t.misc.seed(s.seed ?? 0)
  return '—'
}

function Side({ entry, source, sets, win }: { entry: EntryRef | null; source: unknown; sets: number | null; win: boolean }) {
  return (
    <div className={`match__side${win ? ' is-win' : ''}${entry ? '' : ' is-tbd'}`}>
      <span>{entry ? entry.name : sourceLabel(source)}</span>
      <span className="mono">{sets ?? ''}</span>
    </div>
  )
}

function Match({ m }: { m: MatchView }) {
  const done = m.winnerEntryId != null
  return (
    <div className="match">
      <div className="match__no">
        <span>№ {m.bracketNumber ?? m.number}</span>
        {m.table != null && !done && (
          <span>
            {t.t.table} {m.table}
          </span>
        )}
      </div>
      <Side entry={m.home} source={m.homeSource} sets={done ? m.setsHome : null} win={done && m.winnerEntryId === m.home?.entryId} />
      <Side entry={m.away} source={m.awaySource} sets={done ? m.setsAway : null} win={done && m.winnerEntryId === m.away?.entryId} />
    </div>
  )
}

function Bracket({ matches }: { matches: MatchView[] }) {
  const main = matches.filter((m) => m.placeFrom === 1 || m.placeFrom == null)
  const rounds = [...new Set(main.map((m) => m.round ?? 0))].sort((a, b) => a - b)
  const others = new Map<string, MatchView[]>()
  for (const m of matches.filter((x) => !main.includes(x))) {
    const key = `${m.placeFrom}-${m.placeTo}`
    others.set(key, [...(others.get(key) ?? []), m])
  }
  return (
    <div className="stack">
      <div className="bracket">
        {rounds.map((r) => {
          const col = main.filter((m) => (m.round ?? 0) === r)
          const label = col[0]?.label ?? ''
          return (
            <div className="bracket__col" key={r}>
              <span>{t.misc.rounds[label] ?? label}</span>
              {col.map((m) => (
                <Match key={m.id} m={m} />
              ))}
            </div>
          )
        })}
      </div>
      {others.size > 0 && (
        <div className="places">
          {[...others.entries()]
            .sort((a, b) => (a[1][0]!.placeFrom ?? 0) - (b[1][0]!.placeFrom ?? 0) || (a[1][0]!.placeTo ?? 0) - (b[1][0]!.placeTo ?? 0))
            .map(([key, list]) => (
              <div key={key}>
                <h3>{t.t.forPlaces(list[0]!.placeFrom ?? 0, list[0]!.placeTo ?? 0)}</h3>
                <div className="stack">
                  {list.map((m) => (
                    <Match key={m.id} m={m} />
                  ))}
                </div>
              </div>
            ))}
        </div>
      )}
    </div>
  )
}

const played = (m: MatchView) => m.winnerEntryId != null && m.resultType !== 'bye'

/** Head-to-head numbers among the tied players: the calculation behind the tie-break (spec 4.6). */
function TieBreak({ row, rows, matches }: { row: StandingRow; rows: StandingRow[]; matches: MatchView[] }) {
  if (!row.decidedBy || !row.tiedIds?.length) return null
  const ids = [Number(row.id), ...row.tiedIds]
  const h2h = matches.filter((m) => played(m) && ids.includes(m.home?.entryId ?? -1) && ids.includes(m.away?.entryId ?? -1))
  const calc = ids.map((id) => {
    const c = { id, wins: 0, setsW: 0, setsL: 0, ptsW: 0, ptsL: 0 }
    for (const m of h2h) {
      const home = m.home?.entryId === id
      if (!home && m.away?.entryId !== id) continue
      if (m.winnerEntryId === id) c.wins++
      c.setsW += (home ? m.setsHome : m.setsAway) ?? 0
      c.setsL += (home ? m.setsAway : m.setsHome) ?? 0
      for (const g of m.games ?? []) {
        c.ptsW += home ? g.home : g.away
        c.ptsL += home ? g.away : g.home
      }
    }
    return c
  })
  const name = (id: number) => rows.find((r) => Number(r.id) === id)?.player?.name ?? '—'
  const ratio = (w: number, l: number) => (l ? (w / l).toFixed(3) : w ? '∞' : '—')
  return (
    <details className="small muted">
      <summary>{t.t.decidedBy[row.decidedBy] ?? row.decidedBy}</summary>
      <p>{t.t.tiedWith(row.tiedWith.join(', '))}</p>
      <table className="table">
        <thead>
          <tr>
            <th>{t.t.player}</th>
            <th className="num">{t.t.w}</th>
            <th className="num">{t.t.sets}</th>
            <th className="num">{t.t.rallyPoints}</th>
          </tr>
        </thead>
        <tbody>
          {calc.map((c) => (
            <tr key={c.id}>
              <td>{name(c.id)}</td>
              <td className="num">{c.wins}</td>
              <td className="num">
                {c.setsW}:{c.setsL} ({ratio(c.setsW, c.setsL)})
              </td>
              <td className="num">
                {c.ptsW}:{c.ptsL} ({ratio(c.ptsW, c.ptsL)})
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  )
}

export function Structure({ stages, me }: { stages: StageView[]; me?: number }) {
  return (
    <>
      {stages.map((s) => (
        <section className="panel" key={s.key}>
          <h2>{s.name}</h2>
          {'groups' in s ? (
            <div className="groups">
              {s.groups.map((g) => (
                <div className="groupbox" key={g.code}>
                  <h3>
                    {s.groups.length > 1 ? `${t.t.group} ${g.code}` : s.name}
                  </h3>
                  {g.matches.some((m) => played(m) && m.resultType === 'normal' && !m.games?.length) && <p className="note small">{t.t.noGamePoints}</p>}
                  <table className="table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>{t.t.player}</th>
                        <th className="num">{t.t.w}</th>
                        <th className="num">{t.t.l}</th>
                        <th className="num">{t.t.sets}</th>
                        <th className="num">{t.t.pts}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {g.standings
                        ? g.standings.rows.map((r) => (
                            <tr key={r.id} className={r.player?.playerId === me ? 'is-me' : ''}>
                              <td className="rank">{r.place}</td>
                              <td>
                                {r.player ? <Link to={`/players/${r.player.playerId}`}>{r.player.name}</Link> : '—'}
                                <TieBreak row={r} rows={g.standings!.rows} matches={g.matches} />
                              </td>
                              <td className="num">{r.wins}</td>
                              <td className="num">{r.losses}</td>
                              <td className="num">
                                {r.setsWon}:{r.setsLost}
                              </td>
                              <td className="num">{r.points}</td>
                            </tr>
                          ))
                        : g.members.map((p, i) => (
                            <tr key={p?.entryId ?? i}>
                              <td className="rank">{i + 1}</td>
                              <td colSpan={5}>{p?.name}</td>
                            </tr>
                          ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          ) : s.matches.length ? (
            <Bracket matches={s.matches} />
          ) : (
            <p className="empty">{t.t.bracketLater}</p>
          )}
        </section>
      ))}
    </>
  )
}
