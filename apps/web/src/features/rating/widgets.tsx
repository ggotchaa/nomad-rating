import { useState } from 'react'
import { Link } from 'react-router'
import { api } from '../../api/client.ts'
import { useSession } from '../../app/auth.tsx'
import { useApi, useRoom } from '../../app/hooks.ts'
import { errorText, t } from '../../i18n/index.ts'
import { Delta } from '../../ui/kit.tsx'

/** «Рейтинг обновляется» while a replay after a correction runs. */
export function RecalcBanner() {
  const status = useApi<{ running: boolean }>('/rating/status')
  useRoom('rating', status.reload)
  return status.data?.running ? <p className="note">{t.rating2.updating}</p> : null
}

export const CalibratingMark = () => (
  <span className="chip chip--warn chip--mark" title={t.rating2.calibratingTitle} aria-label={t.rating2.calibratingTitle}>
    {t.rating2.calibratingMark}
  </span>
)

/** On a running tournament page: my preliminary change and a link to «Мой турнир». */
export function MyTournamentStrip({ tournamentId, slug, status }: { tournamentId: number; slug: string; status: string }) {
  const { me } = useSession()
  const running = status === 'running'
  const live = useApi<{ running: boolean; deltas: Record<string, number> }>(running && me.player ? `/rating/tournaments/${tournamentId}/preliminary` : null)
  useRoom(running && me.player ? `tournament:${tournamentId}` : null, (type) => type === 'match.updated' && live.reload())
  const pid = me.player?.id
  if (!pid || !live.data || !(String(pid) in live.data.deltas)) return null
  return (
    <div className="panel row row--between">
      <span title={t.rating2.preliminaryHint}>
        {t.rating2.preliminary}: <Delta value={live.data.deltas[String(pid)]} />
      </span>
      <Link className="button button--sm button--primary" to={`/me/t/${slug}`}>
        {t.rating2.myTournament} →
      </Link>
    </div>
  )
}

/** Cabinet: tournaments I am playing right now with the preliminary delta. */
export function LiveDeltas() {
  const { me } = useSession()
  const rows = useApi<{ tournamentId: number; slug: string; title: string; delta: number }[]>(me.player ? '/rating/me/live' : null)
  if (!rows.data?.length) return null
  return (
    <section className="panel">
      <h2>{t.rating2.live}</h2>
      <div className="linklist">
        {rows.data.map((r) => (
          <Link key={r.tournamentId} to={`/me/t/${r.slug}`}>
            <div>
              <b>{r.title}</b>
              <span title={t.rating2.preliminaryHint}>{t.rating2.preliminary}</span>
            </div>
            <Delta value={r.delta} />
          </Link>
        ))}
      </div>
    </section>
  )
}

/** «Счёт неверный»: opens a dispute for the club on my finished match. */
export function DisputeButton({ matchId }: { matchId: number }) {
  const [state, setState] = useState<string | null>(null)
  const send = async () => {
    const reason = prompt(t.rating2.disputeReason)
    if (!reason?.trim()) return
    try {
      await api(`/rating/matches/${matchId}/dispute`, { method: 'POST', json: { reason } })
      setState(t.rating2.disputeSent)
    } catch (e) {
      setState(errorText(e))
    }
  }
  return state ? (
    <span className="small muted">{state}</span>
  ) : (
    <button className="linkbtn small" onClick={() => void send()}>
      {t.rating2.dispute}
    </button>
  )
}
