import { Link } from 'react-router'
import type { EntryRef, MatchView, StageView } from '../../api/types.ts'
import { t } from '../../i18n/index.ts'

const ROUND_NAMES: Record<string, string> = { final: 'Финал', '1/2': '1/2 финала', '1/4': '1/4 финала', '1/8': '1/8 финала', '1/16': '1/16 финала', '1/32': '1/32 финала' }

function sourceLabel(source: unknown): string {
  const s = source as { kind?: string; match?: number; seed?: number } | null
  if (s?.kind === 'winner') return `Поб. матча ${s.match}`
  if (s?.kind === 'loser') return `−${s.match}`
  if (s?.kind === 'seed') return `Посев ${s.seed}`
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
              <span>{ROUND_NAMES[label] ?? label}</span>
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
                              <td>{r.player ? <Link to={`/players/${r.player.playerId}`}>{r.player.name}</Link> : '—'}</td>
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
