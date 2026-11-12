import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../../api/client.ts'
import { useSession } from '../../app/auth.tsx'
import { errorText, t } from '../../i18n/index.ts'
import { ScoreEntry } from './ScoreEntry.tsx'
import type { ConductMatch } from './types.ts'

type MyCall = {
  matchId: number
  tournamentId: number
  title: string
  status: string
  table: number | null
  side: 'home' | 'away'
  opponent: string | null
  myAnswer: 'delivered' | 'going' | 'cannot' | null
  scoreEntry: string
  rules: { winsNeeded: number; pointsToWin: number }
  reportedScore: { setsHome: number; setsAway: number } | null
  reportedByMe: boolean
}

/** Player popup on a call to a table (3.3) with «Иду / Не могу», and score confirmation (M-5). */
export function CallPopup() {
  const { me } = useSession()
  const [calls, setCalls] = useState<MyCall[]>([])
  const [reason, setReason] = useState<string | null>(null)
  const [reporting, setReporting] = useState<MyCall | null>(null)
  const [error, setError] = useState<string | null>(null)
  const delivered = useRef(new Set<string>())

  const load = useCallback(() => {
    if (!me.player) return
    api<MyCall[]>('/my/calls')
      .then(setCalls)
      .catch(() => {})
  }, [me.player])

  useEffect(() => {
    if (!me.user) return
    load()
    let socket: WebSocket | null = null
    let timer: ReturnType<typeof setTimeout> | undefined
    let closed = false
    const connect = () => {
      socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`)
      socket.onmessage = (e) => {
        const msg = JSON.parse(String(e.data)) as { type: string; data?: { type?: string } }
        if (msg.type === 'notification' && ['match_call', 'score_confirm'].includes(msg.data?.type ?? '')) {
          if (msg.data?.type === 'match_call' && 'vibrate' in navigator) navigator.vibrate([300, 100, 300])
          load()
        }
      }
      socket.onclose = () => {
        if (!closed) timer = setTimeout(connect, 3000)
      }
    }
    connect()
    const poll = setInterval(load, 60000)
    return () => {
      closed = true
      clearTimeout(timer)
      clearInterval(poll)
      socket?.close()
    }
  }, [me.user, load])

  const respond = (c: MyCall, answer: 'delivered' | 'going' | 'cannot', why?: string) =>
    api(`/tournaments/${c.tournamentId}/matches/${c.matchId}/respond`, { method: 'POST', json: { answer, reason: why } })
      .then(load)
      .catch((e: unknown) => setError(errorText(e)))

  const call = calls.find((c) => c.status === 'called' && c.myAnswer !== 'going' && c.myAnswer !== 'cannot')
  const confirmMatch = calls.find((c) => c.reportedScore && !c.reportedByMe)
  const reportable = calls.find((c) => c.scoreEntry === 'players' && !c.reportedScore && (c.status === 'playing' || c.myAnswer === 'going'))

  useEffect(() => {
    if (!call) return
    const key = `${call.matchId}`
    if (delivered.current.has(key)) return
    delivered.current.add(key)
    void respond(call, 'delivered')
  }, [call?.matchId])

  if (reporting)
    return (
      <ScoreEntry
        match={{ id: reporting.matchId, number: 0, home: { name: reporting.side === 'home' ? (me.player ? `${me.player.last_name} ${me.player.first_name}` : '') : (reporting.opponent ?? '') }, away: { name: reporting.side === 'away' ? (me.player ? `${me.player.last_name} ${me.player.first_name}` : '') : (reporting.opponent ?? '') }, version: 0 } as unknown as ConductMatch}
        rules={reporting.rules}
        mode="report"
        path={`/tournaments/${reporting.tournamentId}/matches/${reporting.matchId}/report`}
        onClose={() => setReporting(null)}
        onDone={() => {
          setReporting(null)
          load()
        }}
      />
    )

  if (call)
    return (
      <div className="callpop" role="alertdialog" aria-label={t.call.title}>
        <span className="kicker">{call.title}</span>
        <h2>{t.call.title}</h2>
        <b className="callpop__table">{t.call.table(call.table ?? '—')}</b>
        <p>
          {t.call.vs}: {call.opponent}
        </p>
        {reason == null ? (
          <div className="row">
            <button className="button button--primary button--huge" onClick={() => void respond(call, 'going')}>
              {t.call.going}
            </button>
            <button className="button button--danger" onClick={() => setReason('')}>
              {t.call.cannot}
            </button>
          </div>
        ) : (
          <div className="stack">
            <input autoFocus placeholder={t.call.reason} value={reason} onChange={(e) => setReason(e.target.value)} />
            <button
              className="button button--danger"
              onClick={() => {
                void respond(call, 'cannot', reason)
                setReason(null)
              }}
            >
              {t.call.send}
            </button>
          </div>
        )}
        {error && <p className="note note--error">{error}</p>}
      </div>
    )

  if (confirmMatch?.reportedScore) {
    const s = confirmMatch.reportedScore
    const decide = (agree: boolean) =>
      api(`/tournaments/${confirmMatch.tournamentId}/matches/${confirmMatch.matchId}/confirm`, { method: 'POST', json: { agree } })
        .then(load)
        .catch((e: unknown) => setError(errorText(e)))
    return (
      <div className="callpop" role="alertdialog">
        <h2>{t.call.confirmTitle}</h2>
        <p>{t.call.confirmText(s.setsHome, s.setsAway)}</p>
        <div className="row">
          <button className="button button--primary" onClick={() => void decide(true)}>
            {t.call.agree}
          </button>
          <button className="button button--danger" onClick={() => void decide(false)}>
            {t.call.disagree}
          </button>
        </div>
        {error && <p className="note note--error">{error}</p>}
      </div>
    )
  }

  if (reportable)
    return (
      <button className="callpop callpop--mini button button--primary" onClick={() => setReporting(reportable)}>
        {t.call.report}
      </button>
    )
  return null
}
