import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { api } from '../../api/client.ts'
import { useApi, useRoom } from '../../app/hooks.ts'
import { errorText, t } from '../../i18n/index.ts'
import { formatTime } from '../../i18n/format.ts'
import { Async, StatusChip } from '../../ui/kit.tsx'
import { PlayerSearch } from '../manage/ManageLayout.tsx'
import { useScoreQueue } from './offline.ts'
import { ScoreEntry } from './ScoreEntry.tsx'
import type { ConductEntry, ConductMatch, ConductState } from './types.ts'
import { TournamentPlan } from '../booking/TournamentPlan.tsx'
import { ask as dialog } from '../../ui/dialogs.tsx'

const label = (m: ConductMatch) => (m.label?.startsWith('group:') ? `${t.t.group} ${m.label.slice(6)}` : (m.label ?? ''))

function CallState({ m, telegram }: { m: ConductMatch; telegram?: ConductState['telegram'] }) {
  if (m.status !== 'called') return null
  return (
    <span className="small">
      {(['home', 'away'] as const).map((s) => {
        const r = m.callResponses[s]
        const cls = r?.answer === 'going' ? 'chip--ok' : r?.answer === 'cannot' ? 'chip--bad' : 'chip--warn'
        return (
          <span key={s} className={`chip ${cls}`} title={r?.reason}>
            {m[s]?.name.split(' ')[0]}: {r ? t.conduct.call_answer[r.answer] : t.conduct.noAnswer}
            {r?.reason ? ` · ${r.reason}` : ''}
            {m[s] && telegram && telegram[m[s]!.playerId] !== 'sent' && <span title={t.conduct.tgNotDeliveredHint}> · {t.conduct.tgNotDelivered}</span>}
          </span>
        )
      })}
      {m.callCount > 1 && <span className="muted"> · {t.conduct.callCount(m.callCount)}</span>}
    </span>
  )
}

function Seeding({ d, run }: { d: ConductState; run: (path: string, json?: unknown) => Promise<boolean> }) {
  const present = d.entries.filter((e) => (d.tournament.settings.requireCheckin ? e.status === 'checked_in' : ['paid', 'checked_in'].includes(e.status)))
  const [order, setOrder] = useState<ConductEntry[]>(() => [...present].sort((a, b) => b.rating - a.rating))
  const move = (i: number, dir: -1 | 1) => {
    const next = [...order]
    const j = i + dir
    if (j < 0 || j >= next.length) return
    ;[next[i], next[j]] = [next[j]!, next[i]!]
    setOrder(next)
  }
  const s = d.structure
  const shape = s ? (s.groups ? t.conduct.structureGroups(s.players, s.groups.join(' + ')) : s.bracket ? t.conduct.structureBracket(s.players, s.bracket) : '') : ''
  const under = d.entries.filter((e) => ['paid', 'checked_in', 'awaiting_payment'].includes(e.status)).length < d.tournament.minParticipants
  return (
    <section className="panel">
      <div className="panel__head">
        <h2>{t.conduct.seeding}</h2>
        <button
          className="button button--primary"
          disabled={order.length < Math.max(2, d.tournament.minParticipants)}
          onClick={async () => (await dialog.confirm(`${shape}\n${t.conduct.startConfirm}`)) && void run(`/tournaments/${d.tournament.id}/start`, { order: order.map((e) => e.entryId) })}
        >
          {t.conduct.start} · {order.length}
        </button>
      </div>
      {shape && <p className="small">{shape}</p>}
      {under && (
        <div className="note note--error row row--between">
          <span>{d.tournament.underfillAckAt ? t.conduct.underfillAcked(d.tournament.minParticipants) : t.conduct.underfill(d.tournament.minParticipants)}</span>
          {!d.tournament.underfillAckAt && (
            <button className="button button--sm" onClick={() => void run(`/tournaments/${d.tournament.id}/underfill-ack`)}>
              {t.conduct.underfillAck}
            </button>
          )}
        </div>
      )}
      <p className="small muted">{t.conduct.seedingHint}</p>
      <ol className="seedlist">
        {order.map((e, i) => (
          <li key={e.entryId}>
            <span className="rank">{i + 1}</span>
            <span>{e.name}</span>
            <span className="muted mono small">{e.rating}</span>
            <button className="button button--sm" onClick={() => move(i, -1)} aria-label="up">
              ↑
            </button>
            <button className="button button--sm" onClick={() => move(i, 1)} aria-label="down">
              ↓
            </button>
          </li>
        ))}
      </ol>
      <h3>{t.t.participants}</h3>
      <div className="stack" style={{ maxWidth: 420 }}>
        <span className="small muted">{t.conduct.manualAdd}</span>
        <PlayerSearch onPick={(p) => void run(`/tournaments/${d.tournament.id}/entries/manual`, { playerId: p.id, checkin: true })} />
      </div>
      <div className="tablewrap">
        <table className="table">
          <tbody>
            {d.entries.map((e) => (
              <tr key={e.entryId}>
                <td>
                  {e.name}
                  {e.members && (
                    <div className="row" style={{ flexWrap: 'wrap', gap: 4 }}>
                      {e.members.map((m) =>
                        m.present ? (
                          <span key={m.playerId} className="chip chip--ok">
                            {m.name}
                          </span>
                        ) : (
                          <button
                            key={m.playerId}
                            className="chip"
                            title={t.conduct.checkin}
                            disabled={!['paid', 'checked_in'].includes(e.status)}
                            onClick={() => void run(`/tournaments/${d.tournament.id}/entries/${e.entryId}/checkin`, { playerId: m.playerId })}
                          >
                            {m.name}
                          </button>
                        ),
                      )}
                    </div>
                  )}
                </td>
                <td className="num mono">{e.rating}</td>
                <td>
                  {e.status === 'checked_in' ? <span className="chip chip--ok">{t.conduct.checkedIn}</span> : <span className="chip">{t.t.entryStatus[e.status] ?? e.status}</span>}
                  {d.busyElsewhere[e.entryId] && <span className="chip chip--warn">{t.conduct.busyElsewhere(d.busyElsewhere[e.entryId]!)}</span>}
                </td>
                <td>
                  {e.status === 'paid' && (
                    <button className="button button--sm" onClick={() => void run(`/tournaments/${d.tournament.id}/entries/${e.entryId}/checkin`)}>
                      {t.conduct.checkin}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

/** F-7: tables and match rules of unplayed matches while the tournament runs. */
function RunningChanges({ d, onDone, onError }: { d: ConductState; onDone: () => void; onError: (text: string) => void }) {
  const [tables, setTables] = useState(d.tournament.tableIds)
  const [wins, setWins] = useState(d.format.match.winsNeeded)
  const put = async (path: string, json: unknown) => {
    try {
      await api(`/tournaments/${d.tournament.id}/${path}`, { method: 'PUT', json })
      onDone()
    } catch (e) {
      onError(errorText(e))
    }
  }
  return (
    <section className="panel">
      <h2>{t.conduct.changes}</h2>
      <h3>{t.conduct.tables}</h3>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        {d.hallTables.map((x) => (
          <label key={x.id} className="chip">
            <input type="checkbox" checked={tables.includes(x.id)} onChange={(e) => setTables(e.target.checked ? [...tables, x.id] : tables.filter((id) => id !== x.id))} /> № {x.number}
          </label>
        ))}
        <button className="button button--sm" disabled={!tables.length} onClick={() => void put('tables', { tableIds: tables })}>
          {t.conduct.saveTables}
        </button>
      </div>
      <h3>{t.conduct.matchRules}</h3>
      <p className="small muted">{t.conduct.matchRulesHint}</p>
      <div className="row">
        <select value={wins} onChange={(e) => setWins(Number(e.target.value))} aria-label={t.conduct.matchRules}>
          {[2, 3, 4].map((n) => (
            <option key={n} value={n}>
              {t.conduct.bestOf(n)}
            </option>
          ))}
        </select>
        <button
          className="button button--sm"
          disabled={wins === d.format.match.winsNeeded}
          onClick={async () => (await dialog.confirm(t.conduct.matchRulesConfirm)) && void put('format', { ...d.format, match: { ...d.format.match, winsNeeded: wins } })}
        >
          {t.conduct.saveRules}
        </button>
      </div>
    </section>
  )
}

export function ConductPage() {
  const { id } = useParams()
  const state = useApi<ConductState>(`/tournaments/${id}/conduct`)
  useRoom(`tournament:${id}`, state.reload)
  const { pending, enqueue, conflicts, resolve } = useScoreQueue(state.reload)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [replacing, setReplacing] = useState<number | null>(null)
  const [scoring, setScoring] = useState<{ match: ConductMatch; mode: 'result' | 'correct' } | null>(null)

  const run = async (path: string, json?: unknown, ok?: string) => {
    setMessage(null)
    try {
      await api(path, { method: 'POST', json })
      if (ok) setMessage({ ok: true, text: ok })
      state.reload()
      return true
    } catch (e) {
      setMessage({ ok: false, text: errorText(e) })
      return false
    }
  }
  const ask = async (q: string) => {
    const r = (await dialog.prompt(q))?.trim()
    return r && r.length >= 3 ? r : null
  }

  return (
    <Async state={state} skeleton={3}>
      {(d) => {
        const base = `/tournaments/${d.tournament.id}`
        const running = d.tournament.status === 'running'
        const actions = (m: ConductMatch) => (
          <div className="row">
            {m.status === 'called' && (
              <>
                <button className="button button--sm" onClick={() => void run(`${base}/matches/${m.id}/play`)}>
                  {t.conduct.play}
                </button>
                <button className="button button--sm" onClick={() => void run(`${base}/matches/${m.id}/recall`)}>
                  {t.conduct.recall}
                </button>
                <button className="button button--sm" onClick={() => void run(`${base}/matches/${m.id}/uncall`)}>
                  {t.conduct.uncall}
                </button>
                <button
                  className="button button--sm"
                  onClick={async () => {
                    const n = (await dialog.prompt(t.adminT.tablePrompt))?.trim()
                    if (!n) return
                    const table = d.hallTables.find((x) => String(x.number) === n && d.tournament.tableIds.includes(x.id))
                    if (!table) return setMessage({ ok: false, text: t.adminT.noSuchTable })
                    void run(`${base}/matches/${m.id}/table`, { tableId: table.id }, t.adminT.tableMoved)
                  }}
                >
                  {t.adminT.moveTable}
                </button>
              </>
            )}
            <button className="button button--sm button--primary" onClick={() => setScoring({ match: m, mode: 'result' })}>
              {t.conduct.score}
            </button>
            <button
              className="button button--sm"
              onClick={async () => {
                const who = await dialog.prompt(`${t.conduct.noShowWho}\n1 — ${m.home?.name}\n2 — ${m.away?.name}`)
                if (who === '1' || who === '2') void run(`${base}/matches/${m.id}/no-show`, { absent: who === '1' ? 'home' : 'away' })
              }}
            >
              {t.conduct.noShow}
            </button>
          </div>
        )
        return (
          <>
            <section className="panel">
              <Link className="crumb" to={`/manage/tournaments/${d.tournament.id}`}>
                ← {d.tournament.title}
              </Link>
              <div className="panel__head">
                <h2>{t.conduct.title}</h2>
                <StatusChip status={d.tournament.status} />
              </div>
              <div className="row">
                <Link className="button" to={`/manage/tournaments/${d.tournament.id}/qr`}>
                  {t.conduct.showQr}
                </Link>
                <Link className="button" to={`/t/${d.tournament.slug}/live`} target="_blank">
                  {t.live.open} ↗
                </Link>
                {running && (
                  <>
                    <button className="button button--primary" onClick={async () => (await dialog.confirm(t.conduct.finishConfirm)) && void run(`${base}/finish`, undefined, t.conduct.finished)}>
                      {t.conduct.finish}
                    </button>
                    <button
                      className="button button--danger"
                      onClick={async () => {
                        const reason = await ask(t.conduct.finishEarlyReason)
                        if (reason) void run(`${base}/finish-early`, { reason }, t.conduct.finished)
                      }}
                    >
                      {t.conduct.finishEarly}
                    </button>
                  </>
                )}
              </div>
              {pending > 0 && <p className="note note--error">{t.conduct.offline(pending)}</p>}
              {conflicts.map((c) => {
                const mine = c.body as { setsHome: number; setsAway: number }
                const m = [...d.recent, ...d.queue, ...d.attention].find((x) => c.path.endsWith(`/matches/${x.id}/result`))
                return (
                  <div className="note note--error row row--between" key={c.path}>
                    <span>
                      {t.conduct.conflictBoth(m ? `№ ${m.number}` : '')}: {t.conduct.conflictMine} {mine.setsHome}:{mine.setsAway} · {t.conduct.conflictServer}{' '}
                      {c.server ? `${c.server.setsHome}:${c.server.setsAway}` : '—'}
                    </span>
                    <span className="row">
                      <button className="button button--sm" onClick={() => void resolve(c, null)}>
                        {t.conduct.keepServer}
                      </button>
                      <button
                        className="button button--sm button--primary"
                        onClick={async () => {
                          try {
                            await resolve(c, { reason: t.conduct.offlineReason })
                          } catch (e) {
                            setMessage({ ok: false, text: errorText(e) })
                          }
                        }}
                      >
                        {t.conduct.keepMine}
                      </button>
                    </span>
                  </div>
                )
              })}
              {message && <p className={`note ${message.ok ? 'note--ok' : 'note--error'}`}>{message.text}</p>}
            </section>

            {['published', 'registration_closed'].includes(d.tournament.status) && <Seeding d={d} run={(p, j) => run(p, j)} />}

            {running && (
              <>
                {d.attention.length > 0 && (
                  <section className="panel">
                    <h2>{t.conduct.attention}</h2>
                    {d.attention.map((m) => (
                      <div className="row row--between" key={m.id}>
                        <span>
                          № {m.number} · {m.home?.name} — {m.away?.name} · {m.disputed ? t.conduct.disputed : t.conduct.reported}{' '}
                          {m.reportedScore && `${m.reportedScore.setsHome}:${m.reportedScore.setsAway}`}
                        </span>
                        <button className="button button--sm button--primary" onClick={() => setScoring({ match: m, mode: 'result' })}>
                          {t.conduct.score}
                        </button>
                      </div>
                    ))}
                  </section>
                )}
                <section className="panel">
                  <h2>{t.conduct.tables}</h2>
                  <TournamentPlan tournamentId={Number(id)} tables={d.tables} />
                  <div className="tables-grid">
                    {d.tables.map((x) => (
                      <div key={x.id} className={`tablecard${x.match ? ` tablecard--${x.match.status}` : ''}`}>
                        <div className="row row--between">
                          <b className="mono">№ {x.number}</b>
                          {x.match ? <span className="chip">{t.conduct.matchStatus[x.match.status]}</span> : <span className="muted small">{t.conduct.free}</span>}
                        </div>
                        {x.match && (
                          <>
                            <p className="small muted">
                              № {x.match.number} · {label(x.match)} {x.match.calledAt && `· ${formatTime(x.match.calledAt)}`}
                            </p>
                            <p>
                              {x.match.home?.name}
                              <br />
                              {x.match.away?.name}
                            </p>
                            <CallState m={x.match} telegram={d.telegram} />
                            {actions(x.match)}
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
                <section className="panel">
                  <h2>
                    {t.conduct.queue} · {d.queue.length}
                  </h2>
                  <div className="tablewrap">
                    <table className="table">
                      <tbody>
                        {d.queue.map((q) => (
                          <tr key={q.id}>
                            <td className="mono small">№ {q.number}</td>
                            <td className="small muted">{label(q)}</td>
                            <td>
                              {q.home?.name} — {q.away?.name}
                            </td>
                            <td className="small">
                              {q.waitReason ? (
                                <span className="chip chip--warn">{q.waitReason === 'rest' && q.readyAt ? t.conduct.readyAt(formatTime(q.readyAt)) : t.conduct.wait[q.waitReason]}</span>
                              ) : (
                                <button className="button button--sm button--primary" onClick={() => void run(`${base}/matches/${q.id}/call`, { tableId: q.suggestedTableId })}>
                                  {t.conduct.call} → {q.suggestedTable}
                                </button>
                              )}
                            </td>
                            <td>
                              <button className="button button--sm" onClick={() => setScoring({ match: q, mode: 'result' })}>
                                {t.conduct.score}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
                <section className="panel">
                  <h2>{t.conduct.recent}</h2>
                  {d.recent.map((m) => (
                    <div className="row row--between" key={m.id}>
                      <span>
                        № {m.number} · {m.home?.name} — {m.away?.name}{' '}
                        <b className="mono">
                          {m.setsHome}:{m.setsAway}
                        </b>{' '}
                        {m.resultType === 'walkover' && <span className="chip chip--warn">{t.conduct.walkover}</span>}
                        {m.resultType === 'retired' && <span className="chip chip--warn">{t.conduct.retired}</span>}
                      </span>
                      <button className="button button--sm" onClick={() => setScoring({ match: m, mode: 'correct' })}>
                        {t.conduct.correct}
                      </button>
                    </div>
                  ))}
                </section>
                <section className="panel">
                  <h2>{t.t.participants}</h2>
                  {d.entries
                    .filter((e) => e.status === 'playing')
                    .map((e) => (
                      <div key={e.entryId}>
                        <div className="row row--between">
                          <span>
                            {e.seed}. {e.name}
                          </span>
                          <span className="row">
                            <button className="button button--sm" onClick={() => setReplacing(replacing === e.entryId ? null : e.entryId)}>
                              {t.conduct.replace}
                            </button>
                            <button
                              className="button button--sm button--danger"
                              onClick={async () => {
                                const mode = await dialog.prompt(t.conduct.withdrawMode, '1')
                                if (mode !== '1' && mode !== '2') return
                                const reason = await ask(t.conduct.withdrawReason)
                                if (reason) void run(`${base}/entries/${e.entryId}/withdraw`, { reason, mode: mode === '1' ? 'annul' : 'walkover' })
                              }}
                            >
                              {t.conduct.withdraw}
                            </button>
                          </span>
                        </div>
                        {replacing === e.entryId && (
                          <div className="stack" style={{ maxWidth: 420 }}>
                            <span className="small muted">{t.conduct.replaceHint}</span>
                            <PlayerSearch
                              onPick={async (p) => {
                                const reason = await ask(t.conduct.replaceReason)
                                if (reason && (await run(`${base}/entries/${e.entryId}/replace`, { playerId: p.id, reason }))) setReplacing(null)
                              }}
                            />
                          </div>
                        )}
                      </div>
                    ))}
                </section>
                <RunningChanges d={d} onDone={state.reload} onError={(text) => setMessage({ ok: false, text })} />
              </>
            )}
            {scoring && (
              <ScoreEntry
                match={scoring.match}
                rules={scoring.match.rules ?? d.tournament.match}
                mode={scoring.mode}
                path={`${base}/matches/${scoring.match.id}/${scoring.mode === 'correct' ? 'correct' : 'result'}`}
                enqueue={scoring.mode === 'result' ? enqueue : undefined}
                onClose={() => setScoring(null)}
                onDone={() => {
                  setScoring(null)
                  state.reload()
                }}
              />
            )}
          </>
        )
      }}
    </Async>
  )
}
