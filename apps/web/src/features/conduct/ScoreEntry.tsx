import { useEffect, useState } from 'react'
import { api, ApiError } from '../../api/client.ts'
import { errorText, t } from '../../i18n/index.ts'
import { Modal } from '../../ui/kit.tsx'
import { isNetworkError } from './offline.ts'
import type { ConductMatch, Game, ScorePayload } from './types.ts'

type Rules = { winsNeeded: number; pointsToWin: number }

const completeGame = (winner: 'home' | 'away', loser: number, to: number): Game => {
  const w = Math.max(to, loser + 2)
  return winner === 'home' ? { home: w, away: loser } : { home: loser, away: w }
}

/**
 * Big-button score entry (M-5): quick entry per game (winner + loser points) or sets only.
 * `mode: 'correct'` asks for a reason; network failures go to the offline queue.
 */
export function ScoreEntry(p: {
  match: ConductMatch
  rules: Rules
  path: string
  mode?: 'result' | 'correct' | 'report'
  onDone: () => void
  onClose: () => void
  enqueue?: (path: string, body: unknown) => void
}) {
  const { match, rules } = p
  const [games, setGames] = useState<Game[]>([])
  const [loser, setLoser] = useState(5)
  const [sets, setSets] = useState<[number, number] | null>(null)
  const [retired, setRetired] = useState<'home' | 'away' | null>(null)
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const [impact, setImpact] = useState<{ rebuild: number[]; kept: number[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [conflictWith, setConflictWith] = useState<{ setsHome: number; setsAway: number } | null>(null)
  const won = (side: 'home' | 'away') => games.filter((g) => (side === 'home' ? g.home > g.away : g.away > g.home)).length
  const h = sets ? sets[0] : won('home')
  const a = sets ? sets[1] : won('away')
  const over = Math.max(h, a) >= rules.winsNeeded
  useEffect(() => setImpact(null), [h, a, retired])

  const save = async () => {
    const body: ScorePayload & { reason?: string } = retired
      ? { setsHome: h, setsAway: a, games, resultType: 'retired', winner: retired === 'home' ? 'away' : 'home' }
      : { setsHome: h, setsAway: a, games: sets ? [] : games, resultType: 'normal' }
    if (p.mode !== 'correct' && p.mode !== 'report') body.version = match.version
    if (p.mode === 'correct') body.reason = reason
    if (retired && note.trim()) body.note = note.trim()
    setError(null)
    try {
      // Correction: first show which dependent matches are rebuilt and which stay (spec 4.4).
      if (p.mode === 'correct' && !impact) {
        setImpact(await api<{ rebuild: number[]; kept: number[] }>(`${p.path}/preview`, { method: 'POST', json: body }))
        return
      }
      await api(p.path, { method: 'POST', json: p.mode === 'report' ? { setsHome: h, setsAway: a, games: sets ? [] : games } : body })
      p.onDone()
    } catch (e) {
      if (e instanceof ApiError && e.code === 'match.already_recorded') setConflictWith(e.details as { setsHome: number; setsAway: number })
      else if (p.enqueue && isNetworkError(e)) {
        p.enqueue(p.path, body)
        p.onDone()
      } else setError(errorText(e))
    }
  }

  const name = (s: 'home' | 'away') => match[s]?.name ?? '—'
  return (
    <Modal title={`${t.conduct.score} · № ${match.number}`} onClose={p.onClose}>
      <div className="score">
        <div className="score__board">
          <span>{name('home')}</span>
          <b className="mono">
            {h} : {a}
          </b>
          <span>{name('away')}</span>
        </div>
        {conflictWith && (
          <p className="note note--error">
            {t.conduct.conflict}. {t.conduct.current}: {conflictWith.setsHome}:{conflictWith.setsAway}
          </p>
        )}
        {!sets && (
          <>
            <p className="small muted">{t.conduct.quick}</p>
            <div className="score__games mono">
              {games.map((g, i) => (
                <span key={i} className="chip">
                  {g.home}:{g.away}
                </span>
              ))}
            </div>
            {!over && (
              <>
                <label className="small">
                  {t.conduct.loserPoints}
                  <div className="score__points">
                    {[0, 3, 5, 7, 8, 9].map((n) => (
                      <button key={n} type="button" className={`button${loser === n ? ' button--primary' : ''}`} onClick={() => setLoser(n)}>
                        {n}
                      </button>
                    ))}
                    <input type="number" min={0} max={40} value={loser} onChange={(e) => setLoser(Number(e.target.value))} aria-label={t.conduct.loserPoints} />
                  </div>
                </label>
                <div className="score__big">
                  {(['home', 'away'] as const).map((s) => (
                    <button key={s} type="button" className="button button--primary" onClick={() => setGames([...games, completeGame(s, loser, rules.pointsToWin)])}>
                      {name(s)}
                    </button>
                  ))}
                </div>
              </>
            )}
          </>
        )}
        <details>
          <summary className="small muted">{t.conduct.setsOnly}</summary>
          <div className="score__points">
            {Array.from({ length: rules.winsNeeded }, (_, l) => l).flatMap((l) => [
              <button key={`h${l}`} type="button" className="button" onClick={() => setSets([rules.winsNeeded, l])}>
                {rules.winsNeeded}:{l}
              </button>,
              <button key={`a${l}`} type="button" className="button" onClick={() => setSets([l, rules.winsNeeded])}>
                {l}:{rules.winsNeeded}
              </button>,
            ])}
          </div>
        </details>
        {p.mode !== 'report' && (
          <details>
            <summary className="small muted">{t.conduct.retiredOpt}</summary>
            <div className="row">
              {(['home', 'away'] as const).map((s) => (
                <button key={s} type="button" className={`button${retired === s ? ' button--danger' : ''}`} onClick={() => setRetired(retired === s ? null : s)}>
                  {name(s)} — {t.conduct.retired}
                </button>
              ))}
            </div>
            {retired && (
              <>
                <p className="small muted">{t.conduct.retiredHint}</p>
                <input placeholder={t.conduct.retiredNote} value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} />
              </>
            )}
          </details>
        )}
        {p.mode === 'correct' && (
          <input
            placeholder={t.conduct.correctReason}
            value={reason}
            onChange={(e) => {
              setReason(e.target.value)
              setImpact(null)
            }}
          />
        )}
        {impact && (
          <div className="note">
            {impact.rebuild.length || impact.kept.length ? (
              <>
                {impact.rebuild.length > 0 && <p>{t.conduct.impactRebuild(impact.rebuild.map((n) => `№ ${n}`).join(', '))}</p>}
                {impact.kept.length > 0 && <p>{t.conduct.impactKept(impact.kept.map((n) => `№ ${n}`).join(', '))}</p>}
              </>
            ) : (
              <p>{t.conduct.impactNone}</p>
            )}
          </div>
        )}
        {error && <p className="note note--error">{error}</p>}
        <div className="row">
          <button
            className="button"
            type="button"
            onClick={() => {
              setGames([])
              setSets(null)
              setRetired(null)
              setImpact(null)
            }}
          >
            {t.conduct.clear}
          </button>
          <button className="button button--primary" type="button" disabled={(!over && !retired) || (p.mode === 'correct' && reason.trim().length < 3)} onClick={() => void save()}>
            {p.mode === 'correct' && impact ? t.conduct.confirmCorrect : t.conduct.save}
          </button>
        </div>
      </div>
    </Modal>
  )
}
