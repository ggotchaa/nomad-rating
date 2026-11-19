import { useMemo, useState } from 'react'
import { useApi, useRoom } from '../../app/hooks.ts'
import { t } from '../../i18n/index.ts'
import { Async } from '../../ui/kit.tsx'
import type { ConductMatch, MatchList, MatchRow } from './types.ts'

const DONE = ['finished', 'walkover', 'retired']

function where(m: MatchRow) {
  const part = m.groupCode ? `${t.t.group} ${m.groupCode}` : m.label?.startsWith('group:') ? '' : (m.label ?? '')
  return [m.stageName, part].filter(Boolean).join(' · ')
}

/** Every match of the tournament with filters; actions reuse the conduct endpoints. */
export function MatchesTab(p: {
  tournamentId: number
  running: boolean
  canCorrect: boolean
  run: (path: string, json?: unknown) => Promise<boolean>
  onScore: (m: ConductMatch, mode: 'result' | 'correct') => void
  onNoShow: (m: ConductMatch) => void
}) {
  const base = `/tournaments/${p.tournamentId}`
  const state = useApi<MatchList>(`${base}/matches`)
  useRoom(`tournament:${p.tournamentId}`, state.reload)
  const [stage, setStage] = useState('')
  const [status, setStatus] = useState('')
  const [table, setTable] = useState('')
  const [player, setPlayer] = useState('')
  const [q, setQ] = useState('')

  const players = useMemo(() => {
    const all = new Map<number, string>()
    for (const m of state.data?.matches ?? []) for (const s of [m.home, m.away]) if (s) all.set(s.entryId, s.name)
    return [...all].sort((a, b) => a[1].localeCompare(b[1]))
  }, [state.data])
  const tables = useMemo(() => [...new Set((state.data?.matches ?? []).map((m) => m.table).filter((x): x is number => x != null))].sort((a, b) => a - b), [state.data])

  return (
    <Async state={state} skeleton={3}>
      {(d) => {
        const text = q.trim().toLowerCase()
        const rows = d.matches.filter(
          (m) =>
            (!stage || m.stageKey === stage) &&
            (!status || m.status === status) &&
            (!table || String(m.table) === table) &&
            (!player || [m.home?.entryId, m.away?.entryId].includes(Number(player))) &&
            (!text || [m.home?.name, m.away?.name, `№ ${m.number}`, String(m.number), where(m)].some((x) => x?.toLowerCase().includes(text))),
        )
        const statuses = [...new Set(d.matches.map((m) => m.status))]
        return (
          <section className="panel">
            <div className="row" style={{ flexWrap: 'wrap' }}>
              <select value={stage} onChange={(e) => setStage(e.target.value)} aria-label={t.conduct.allStages}>
                <option value="">{t.conduct.allStages}</option>
                {d.stages.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.name}
                  </option>
                ))}
              </select>
              <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label={t.conduct.allStatuses}>
                <option value="">{t.conduct.allStatuses}</option>
                {statuses.map((s) => (
                  <option key={s} value={s}>
                    {t.conduct.matchStatus[s] ?? s}
                  </option>
                ))}
              </select>
              <select value={table} onChange={(e) => setTable(e.target.value)} aria-label={t.conduct.allTables}>
                <option value="">{t.conduct.allTables}</option>
                {tables.map((n) => (
                  <option key={n} value={n}>
                    № {n}
                  </option>
                ))}
              </select>
              <select value={player} onChange={(e) => setPlayer(e.target.value)} aria-label={t.conduct.allPlayers}>
                <option value="">{t.conduct.allPlayers}</option>
                {players.map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
              <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.conduct.searchMatches} />
            </div>
            <p className="small muted">{t.conduct.shown(rows.length, d.matches.length)}</p>
            <div className="tablewrap">
              <table className="table">
                <tbody>
                  {rows.map((m) => {
                    const ready = m.home && m.away
                    const done = DONE.includes(m.status) && m.resultType !== 'bye'
                    return (
                      <tr key={m.id}>
                        <td className="mono small">
                          № {m.number}
                          {m.bracketNumber != null && m.bracketNumber !== m.number && <span className="muted"> ({m.bracketNumber})</span>}
                        </td>
                        <td className="small muted">{where(m)}</td>
                        <td>
                          {m.home?.name ?? '—'} — {m.away?.name ?? '—'}
                        </td>
                        <td className="mono small">{m.table != null ? `№ ${m.table}` : ''}</td>
                        <td>
                          <span className="chip">{t.conduct.matchStatus[m.status] ?? m.status}</span>
                          {m.resultType === 'walkover' && <span className="chip chip--warn">{t.conduct.walkover}</span>}
                          {m.resultType === 'retired' && <span className="chip chip--warn">{t.conduct.retired}</span>}
                        </td>
                        <td className="mono">
                          {m.setsHome != null && m.resultType !== 'bye' && (
                            <>
                              <b>
                                {m.setsHome}:{m.setsAway}
                              </b>
                              {m.games.length > 0 && <span className="small muted"> ({m.games.map((g) => `${g.home}:${g.away}`).join(', ')})</span>}
                            </>
                          )}
                        </td>
                        <td>
                          <div className="row">
                            {p.running && ready && m.status === 'scheduled' && (
                              <button className="button button--sm" onClick={() => void p.run(`${base}/matches/${m.id}/call`)}>
                                {t.conduct.call}
                              </button>
                            )}
                            {m.status === 'called' && (
                              <button className="button button--sm" onClick={() => void p.run(`${base}/matches/${m.id}/uncall`)}>
                                {t.conduct.uncall}
                              </button>
                            )}
                            {p.running && ready && ['scheduled', 'called', 'playing'].includes(m.status) && (
                              <>
                                <button className="button button--sm button--primary" onClick={() => p.onScore(m, 'result')}>
                                  {t.conduct.score}
                                </button>
                                <button className="button button--sm" onClick={() => p.onNoShow(m)}>
                                  {t.conduct.noShow}
                                </button>
                              </>
                            )}
                            {done && p.canCorrect && (
                              <button className="button button--sm" onClick={() => p.onScore(m, 'correct')}>
                                {t.conduct.correct}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )
      }}
    </Async>
  )
}
