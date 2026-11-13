import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router'
import type { StageView } from '../../api/types.ts'
import { useApi, useRoom } from '../../app/hooks.ts'
import { t } from '../../i18n/index.ts'
import { Async, StatusChip } from '../../ui/kit.tsx'
import { Structure } from '../tournaments/Structure.tsx'
import { TournamentPlan } from '../booking/TournamentPlan.tsx'
import { CalibTag } from '../rating/widgets.tsx'

type LiveSide = { name: string; rating: number | null; calibrating?: boolean; startLevel?: number } | null
type LiveMatch = { id: number; number: number; label: string | null; status: string; table: number | null; home: LiveSide; away: LiveSide; setsHome: number | null; setsAway: number | null; waitReason?: string | null }
type Live = { id: number; slug: string; title: string; status: string; tables: { id: number; number: number; match: LiveMatch | null }[]; next: LiveMatch[]; recent: LiveMatch[]; structure: StageView[] | null }

const label = (l: string | null) => (l?.startsWith('group:') ? `${t.t.group} ${l.slice(6)}` : (l ?? ''))

/** Public live / TV page (M-6): tables, next matches, groups and brackets; auto-scroll for a hall screen. */
export function LivePage() {
  const { slug } = useParams()
  const state = useApi<Live>(`/tournaments/${slug}/live`)
  const [data, setData] = useState<Live | null>(null)
  useEffect(() => {
    if (state.data) setData(state.data)
  }, [state.data])
  useRoom(data ? `tournament:${data.id}` : null, state.reload)
  const [auto, setAuto] = useState(false)
  const dir = useRef(1)
  useEffect(() => {
    if (!auto) return
    const id = setInterval(() => {
      const max = document.documentElement.scrollHeight - innerHeight
      if (scrollY >= max - 2) dir.current = -1
      if (scrollY <= 0) dir.current = 1
      scrollBy({ top: dir.current * (dir.current > 0 ? 1 : 40) })
    }, 40)
    return () => clearInterval(id)
  }, [auto])

  return (
    <main className="page live">
      <Async state={{ ...state, data, loading: state.loading && !data }} skeleton={3}>
        {(d) => (
          <>
            <header className="pagehead">
              <Link className="crumb" to={`/t/${d.slug}`}>
                ← {d.title}
              </Link>
              <div className="row row--between">
                <h1>{t.live.title}</h1>
                <div className="row">
                  <StatusChip status={d.status} />
                  <label className="small">
                    <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> {t.live.autoscroll}
                  </label>
                </div>
              </div>
            </header>
            <section className="panel">
              <h2>{t.live.tables}</h2>
              <TournamentPlan tournamentId={d.id} tables={d.tables} />
              <div className="tables-grid">
                {d.tables.map((x) => (
                  <div key={x.id} className={`tablecard${x.match ? ` tablecard--${x.match.status}` : ''}`}>
                    <b className="mono">№ {x.number}</b>
                    {x.match ? (
                      <>
                        <p className="small muted">{label(x.match.label)}</p>
                        <p className="live__pair">
                          {x.match.home?.name}
                          <CalibTag e={x.match.home} />
                          <br />
                          {x.match.away?.name}
                          <CalibTag e={x.match.away} />
                        </p>
                      </>
                    ) : (
                      <p className="muted small">{t.live.free}</p>
                    )}
                  </div>
                ))}
              </div>
            </section>
            <div className="grid grid--2">
              <section className="panel">
                <h2>{t.live.next}</h2>
                {d.next.map((m) => (
                  <p key={m.id} className="small">
                    <span className="mono muted">№ {m.number}</span> {m.home?.name}
                    <CalibTag e={m.home} /> — {m.away?.name}
                    <CalibTag e={m.away} /> <span className="muted">· {label(m.label)}</span>
                  </p>
                ))}
              </section>
              <section className="panel">
                <h2>{t.live.recent}</h2>
                {d.recent.map((m) => (
                  <p key={m.id} className="small">
                    {m.home?.name}
                    <CalibTag e={m.home} /> — {m.away?.name}
                    <CalibTag e={m.away} />{' '}
                    <b className="mono">
                      {m.setsHome}:{m.setsAway}
                    </b>
                  </p>
                ))}
              </section>
            </div>
            {d.structure && <Structure stages={d.structure} />}
          </>
        )}
      </Async>
    </main>
  )
}
