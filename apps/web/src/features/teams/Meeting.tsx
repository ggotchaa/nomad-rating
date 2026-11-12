import { useState } from 'react'
import { useParams } from 'react-router'
import { api } from '../../api/client.ts'
import { useApi, useRoom } from '../../app/hooks.ts'
import { errorText, t } from '../../i18n/index.ts'
import { Async, StatusChip } from '../../ui/kit.tsx'

const s = (h: number, a: number) => ({ kind: 'singles' as const, home: [h], away: [a] })
/** Ready schemes (same as the engine's MEETING_SCHEMES). */
export const MEETING_SCHEMES = {
  wc: { id: 'wc', name: 'Формат ЧМ', slots: 3, games: [s(0, 0), s(1, 1), s(2, 2), s(0, 1), s(1, 0)], firstTo: 3, playAll: false, tables: 1 },
  olympic: { id: 'olympic', name: 'Олимпийская', slots: 3, games: [{ kind: 'doubles' as const, home: [1, 2], away: [1, 2] }, s(0, 0), s(2, 2), s(0, 1), s(1, 0)], firstTo: 3, playAll: false, tables: 1 },
  swaythling: { id: 'swaythling', name: 'Свэтлинг', slots: 3, games: [s(0, 0), s(1, 1), s(2, 2), s(1, 0), s(0, 2), s(2, 1), s(1, 2), s(2, 0), s(0, 1)], firstTo: 5, playAll: false, tables: 1 },
}

type P = { id: number; name: string }
type SideView = { roster: P[]; submitted: boolean; byOrganizer: boolean; lineup: P[] | null }
type Game = { index: number; kind: 'singles' | 'doubles'; status: string; home: P[]; away: P[]; setsHome: number | null; setsAway: number | null }
type MeetingView = {
  matchId: number
  status: string
  scheme: { name: string; slots: number; firstTo: number; playAll: boolean; tables: number }
  deadline: string | null
  mySide: 'home' | 'away' | null
  home: SideView
  away: SideView
  score: { home: number; away: number; winner: string | null; finished: boolean }
  games: Game[]
}

function LineupForm({ side, view, onSubmit }: { side: 'home' | 'away'; view: MeetingView; onSubmit: (lineup: number[]) => void }) {
  const roster = view[side].roster
  const [picked, setPicked] = useState<number[]>(roster.slice(0, view.scheme.slots).map((p) => p.id))
  return (
    <div className="stack">
      {Array.from({ length: view.scheme.slots }, (_, i) => (
        <label key={i} className="row">
          <b style={{ width: 24 }}>{t.meeting.slot(i, side)}</b>
          <select value={picked[i] ?? ''} onChange={(e) => setPicked((p) => p.map((x, k) => (k === i ? Number(e.target.value) : x)))}>
            {roster.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      ))}
      <button className="button button--primary" onClick={() => onSubmit(picked)}>
        {t.meeting.submit}
      </button>
    </div>
  )
}

function GameRow({ g, staff, act }: { g: Game; staff: boolean; act: (path: string, body?: unknown) => void }) {
  const [h, setH] = useState(3)
  const [a, setA] = useState(0)
  const names = (ps: P[]) => ps.map((p) => p.name).join(' / ')
  return (
    <li className="row row--between">
      <span>
        {t.meeting.game} {g.index + 1} · <span className="muted small">{g.kind === 'singles' ? t.meeting.singles : t.meeting.doubles}</span> · {names(g.home)} — {names(g.away)}
        {g.setsHome != null && <b> {g.setsHome}:{g.setsAway}</b>}
      </span>
      <span className="row">
        {g.status === 'skipped' ? <span className="muted small">{t.meeting.skipped}</span> : <StatusChip status={g.status === 'called' ? 'called' : g.status} />}
        {staff && g.status === 'scheduled' && (
          <button className="button button--sm" onClick={() => act(`games/${g.index + 1}/call`, {})}>
            {t.meeting.call}
          </button>
        )}
        {staff && (g.status === 'scheduled' || g.status === 'called') && (
          <>
            <input type="number" min={0} max={4} value={h} onChange={(e) => setH(Number(e.target.value))} style={{ width: 52 }} />
            <input type="number" min={0} max={4} value={a} onChange={(e) => setA(Number(e.target.value))} style={{ width: 52 }} />
            <button className="button button--sm button--primary" onClick={() => act(`games/${g.index + 1}/result`, { setsHome: h, setsAway: a, games: [] })}>
              {t.meeting.save}
            </button>
          </>
        )}
      </span>
    </li>
  )
}

export function MeetingPage() {
  const { tournamentId, matchId } = useParams()
  const base = `/tournaments/${tournamentId}/meetings/${matchId}`
  const view = useApi<MeetingView>(base)
  const access = useApi<{ isStaff: boolean }>(`/tournaments/${tournamentId}`)
  useRoom(`tournament:${tournamentId}`, (type) => type === 'match.updated' && view.reload())
  const [error, setError] = useState('')
  const act = (path: string, body: unknown = {}) => {
    setError('')
    api(`${base}/${path}`, { method: 'POST', json: body })
      .then(view.reload)
      .catch((e: unknown) => setError(errorText(e)))
  }
  const staff = Boolean(access.data?.isStaff)
  return (
    <main className="page">
      <Async state={view}>
        {(v) => (
          <>
            <header className="pagehead">
              <span className="kicker">{t.meeting.title}</span>
              <h1>
                {t.meeting.score}: {v.score.home}:{v.score.away}
              </h1>
              <p className="muted">
                {[v.scheme.name, t.meeting.firstTo(v.scheme.firstTo), v.scheme.playAll && t.meeting.playAll, t.meeting.tables(v.scheme.tables)].filter(Boolean).join(' · ')}
              </p>
            </header>
            <div className="grid grid--2">
              {(['home', 'away'] as const).map((side) => {
                const s = v[side]
                const canSubmit = (v.mySide === side && !s.submitted) || staff
                return (
                  <section key={side} className="panel stack">
                    <h2>
                      {t.meeting.lineup} · {s.submitted ? t.meeting.submitted : t.meeting.waiting} {s.byOrganizer && <span className="chip">{t.meeting.organizer}</span>}
                    </h2>
                    {s.lineup ? (
                      <ol className="stack">
                        {s.lineup.map((p, i) => (
                          <li key={p.id}>
                            <b>{t.meeting.slot(i, side)}</b> {p.name}
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <p className="note">{t.meeting.blind}</p>
                    )}
                    {canSubmit && !v.games.some((g) => g.status !== 'scheduled') && <LineupForm side={side} view={v} onSubmit={(lineup) => act('lineup', { lineup, side })} />}
                  </section>
                )
              })}
            </div>
            {v.deadline && !v.games.length && (
              <p className="note">
                {t.meeting.deadline} {new Date(v.deadline).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
              </p>
            )}
            {v.games.length > 0 && (
              <section className="panel">
                <ul className="stack">
                  {v.games.map((g) => (
                    <GameRow key={g.index} g={g} staff={staff} act={act} />
                  ))}
                </ul>
              </section>
            )}
            {error && <p className="note note--error">{error}</p>}
          </>
        )}
      </Async>
    </main>
  )
}
