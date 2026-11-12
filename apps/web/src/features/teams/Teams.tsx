import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { api } from '../../api/client.ts'
import { useSession } from '../../app/auth.tsx'
import { useApi } from '../../app/hooks.ts'
import { errorText, t } from '../../i18n/index.ts'
import { Async, Field, Seg, StatusChip } from '../../ui/kit.tsx'

type Member = { id: number; name: string; birthYear: number; region: string | null; role: string; singles: number | null; doubles: number | null }
export type Team = {
  id: number
  kind: 'pair' | 'team'
  name: string
  minSize: number
  maxSize: number
  approveJoins: boolean
  payer: string
  isCaptain: boolean
  joinUrl?: string
  complete: boolean
  members: Member[]
  invitations: { id: number; playerId: number; name: string; direction: string; status: string; expiresAt: string }[]
  entries: { id: number; status: string; slug: string; title: string; startsAt: string }[]
}
type Mine = { teams: Team[]; invitations: { id: number; teamId: number; name: string; kind: string; captain: string; expiresAt: string }[] }
type Found = { id: number; name: string; birthYear: number; region: string | null; city: string | null; rating: number | null }

function useAction(reload: () => void) {
  const [error, setError] = useState('')
  const run = async (fn: () => Promise<unknown>) => {
    setError('')
    try {
      await fn()
      reload()
    } catch (e) {
      setError(errorText(e))
    }
  }
  return { error, run }
}

const post = (path: string, json: unknown = {}) => api(path, { method: 'POST', json })
const time = (iso: string) => new Date(iso).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

function InviteSearch({ team, onDone }: { team: Team; onDone: () => void }) {
  const [q, setQ] = useState('')
  const [found, setFound] = useState<Found[]>([])
  useEffect(() => {
    if (q.trim().length < 2) return setFound([])
    const id = setTimeout(() => void api<Found[]>(`/teams/players?q=${encodeURIComponent(q.trim())}`).then(setFound).catch(() => setFound([])), 300)
    return () => clearTimeout(id)
  }, [q])
  const { error, run } = useAction(onDone)
  return (
    <div className="stack">
      <input type="search" placeholder={t.teams.searchPlayer} value={q} onChange={(e) => setQ(e.target.value)} />
      {found.map((p) => (
        <div key={p.id} className="row row--between">
          <span>
            {p.name} <span className="muted small">· {[p.region ?? p.city, p.birthYear, p.rating].filter(Boolean).join(' · ')}</span>
          </span>
          <button className="button button--sm" disabled={team.members.some((m) => m.id === p.id)} onClick={() => void run(() => post(`/teams/${team.id}/invitations`, { playerId: p.id }))}>
            {t.teams.invite}
          </button>
        </div>
      ))}
      {error && <p className="note note--error">{error}</p>}
    </div>
  )
}

function TeamCard({ team, reload }: { team: Team; reload: () => void }) {
  const { error, run } = useAction(reload)
  const { me } = useSession()
  return (
    <section className="panel stack">
      <div className="panel__head">
        <h2>
          {team.name} <span className="chip">{team.kind === 'pair' ? t.teams.pair : t.teams.team}</span>
        </h2>
        <span className={`chip${team.complete ? ' chip--ok' : ' chip--warn'}`}>{team.complete ? t.teams.complete : t.teams.incomplete(team.members.length, team.minSize)}</span>
      </div>
      <ul className="stack">
        {team.members.map((m) => (
          <li key={m.id} className="row row--between">
            <span>
              <Link to={`/players/${m.id}`}>{m.name}</Link> <span className="muted small">· {[m.region, m.birthYear, m.role === 'captain' && t.teams.captain].filter(Boolean).join(' · ')}</span>
            </span>
            <span className="row">
              <span className="muted small">
                {m.singles ?? '—'} / {m.doubles ?? '—'}
              </span>
              {m.role !== 'captain' && (team.isCaptain || m.id === me.player?.id) && (
                <button className="button button--sm" onClick={() => void run(() => api(`/teams/${team.id}/members/${m.id}`, { method: 'DELETE' }))}>
                  {t.teams.remove}
                </button>
              )}
            </span>
          </li>
        ))}
      </ul>
      {team.isCaptain && (
        <>
          {team.invitations.length > 0 && (
            <ul className="stack small">
              {team.invitations.map((i) => (
                <li key={i.id} className="row row--between">
                  <span>
                    {i.name} · {i.direction === 'request' ? `${t.teams.request} · ` : ''}
                    {t.teams.status[i.status]} {i.status === 'sent' && `${t.teams.expires} ${time(i.expiresAt)}`}
                  </span>
                  {i.status === 'sent' &&
                    (i.direction === 'request' ? (
                      <span className="row">
                        <button className="button button--sm button--primary" onClick={() => void run(() => post(`/teams/invitations/${i.id}/accept`))}>
                          {t.teams.accept}
                        </button>
                        <button className="button button--sm" onClick={() => void run(() => post(`/teams/invitations/${i.id}/decline`))}>
                          {t.teams.decline}
                        </button>
                      </span>
                    ) : (
                      <button className="button button--sm" onClick={() => void run(() => post(`/teams/invitations/${i.id}/revoke`))}>
                        {t.teams.revoke}
                      </button>
                    ))}
                </li>
              ))}
            </ul>
          )}
          {team.members.length < team.maxSize && <InviteSearch team={team} onDone={reload} />}
          {team.joinUrl && (
            <Field label={t.teams.link}>
              <input readOnly value={team.joinUrl} onFocus={(e) => e.target.select()} />
            </Field>
          )}
          <button className="button button--sm" onClick={() => void run(() => post(`/teams/${team.id}/repeat`))}>
            {t.teams.repeat}
          </button>
        </>
      )}
      {team.entries.length > 0 && (
        <p className="small">
          {t.teams.entries}:{' '}
          {team.entries.map((e) => (
            <Link key={e.id} to={`/t/${e.slug}`} style={{ marginRight: 8 }}>
              {e.title}
            </Link>
          ))}
        </p>
      )}
      {error && <p className="note note--error">{error}</p>}
    </section>
  )
}

export function MyTeams() {
  const mine = useApi<Mine>('/teams/my')
  const [kind, setKind] = useState<'pair' | 'team'>('pair')
  const [name, setName] = useState('')
  const [minSize, setMin] = useState(3)
  const [maxSize, setMax] = useState(5)
  const [approveJoins, setApprove] = useState(false)
  const [payer, setPayer] = useState<'captain' | 'each'>('captain')
  const { error, run } = useAction(mine.reload)
  return (
    <main className="page">
      <header className="pagehead">
        <h1>{t.teams.title}</h1>
        <p>{t.teams.lead}</p>
      </header>
      <Async state={mine}>
        {(d) => (
          <div className="stack">
            {d.invitations.length > 0 && (
              <section className="panel stack">
                <h2>{t.teams.incoming}</h2>
                {d.invitations.map((i) => (
                  <div key={i.id} className="row row--between">
                    <span>
                      «{i.name}» · {i.captain} · {t.teams.expires} {time(i.expiresAt)}
                    </span>
                    <span className="row">
                      <button className="button button--sm button--primary" onClick={() => void run(() => post(`/teams/invitations/${i.id}/accept`))}>
                        {t.teams.accept}
                      </button>
                      <button className="button button--sm" onClick={() => void run(() => post(`/teams/invitations/${i.id}/decline`))}>
                        {t.teams.decline}
                      </button>
                    </span>
                  </div>
                ))}
              </section>
            )}
            {d.teams.map((team) => (
              <TeamCard key={team.id} team={team} reload={mine.reload} />
            ))}
          </div>
        )}
      </Async>
      <section className="panel stack">
        <h2>{t.teams.create}</h2>
        <Seg label={t.teams.create} value={kind} onChange={setKind} options={[['pair', t.teams.pair], ['team', t.teams.team]]} />
        <Field label={t.teams.name}>
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        {kind === 'team' && (
          <div className="row">
            <Field label={t.teams.minSize}>
              <input type="number" min={2} max={8} value={minSize} onChange={(e) => setMin(Number(e.target.value))} />
            </Field>
            <Field label={t.teams.maxSize}>
              <input type="number" min={2} max={10} value={maxSize} onChange={(e) => setMax(Number(e.target.value))} />
            </Field>
          </div>
        )}
        <Field label={t.teams.payer}>
          <select value={payer} onChange={(e) => setPayer(e.target.value as 'captain' | 'each')}>
            {Object.entries(t.teams.payers).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        <label className="check">
          <input type="checkbox" checked={approveJoins} onChange={(e) => setApprove(e.target.checked)} />
          {t.teams.approveJoins}
        </label>
        <button className="button button--primary" disabled={name.trim().length < 2} onClick={() => void run(() => post('/teams', { kind, name, minSize, maxSize, approveJoins, payer }).then(() => setName('')))}>
          {t.teams.create}
        </button>
        {error && <p className="note note--error">{error}</p>}
      </section>
    </main>
  )
}

export function JoinTeam() {
  const { token } = useParams()
  const info = useApi<{ name: string; kind: string; captain: string; approveJoins: boolean }>(`/teams/join/${token}`)
  const [done, setDone] = useState('')
  const [error, setError] = useState('')
  const { me } = useSession()
  return (
    <main className="page">
      <Async state={info}>
        {(d) => (
          <section className="panel stack">
            <h1>{t.teams.joinTitle(d.name)}</h1>
            <p className="muted">
              {t.teams.captain}: {d.captain}
            </p>
            {done ? (
              <p className="note note--ok">{done === 'joined' ? t.teams.joined : t.teams.requested}</p>
            ) : me.player ? (
              <button
                className="button button--primary"
                onClick={() =>
                  void post(`/teams/join/${token}`)
                    .then((r) => setDone((r as { status: string }).status))
                    .catch((e: unknown) => setError(errorText(e)))
                }
              >
                {t.teams.join}
              </button>
            ) : (
              <Link className="button button--primary" to="/login">
                {t.nav.login}
              </Link>
            )}
            {error && <p className="note note--error">{error}</p>}
            <Link to="/me/teams">{t.teams.title}</Link>
          </section>
        )}
      </Async>
    </main>
  )
}

type StageLite = { kind: string; groups?: { matches: MatchLite[] }[]; matches?: MatchLite[] }
type MatchLite = { id: number; number: number; status: string; home?: { name: string } | null; away?: { name: string } | null; setsHome: number | null; setsAway: number | null }

/** Tournament page block for doubles / team tournaments: captain registers a team, meetings link to their screen. */
export function TeamTournamentBlock({ d, reload }: { d: { id: number; type: string; status: string; structure: StageLite[] | null; participants: object[] }; reload: () => void }) {
  const { me } = useSession()
  const mine = useApi<Mine>(me.player ? '/teams/my' : null)
  const [teamId, setTeamId] = useState<number | null>(null)
  const { error, run } = useAction(() => {
    reload()
    mine.reload()
  })
  const kind = d.type === 'doubles' ? 'pair' : 'team'
  const options = (mine.data?.teams ?? []).filter((x) => x.kind === kind && x.isCaptain && !d.participants.some((p) => (p as { teamId?: number | null }).teamId === x.id))
  const meetings = d.type === 'team' ? (d.structure ?? []).flatMap((s) => (s.groups ? s.groups.flatMap((g) => g.matches) : (s.matches ?? []))).filter((m) => m.home && m.away) : []
  return (
    <section className="panel stack">
      {d.status === 'published' && me.player && (
        <>
          <h2>{t.teams.registerAs}</h2>
          {options.length ? (
            <div className="row">
              <select value={teamId ?? ''} onChange={(e) => setTeamId(Number(e.target.value))}>
                <option value="">—</option>
                {options.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name} · {o.members.length}/{o.minSize}
                  </option>
                ))}
              </select>
              <button className="button button--primary" disabled={!teamId} onClick={() => void run(() => post(`/tournaments/${d.id}/team-entries`, { teamId }))}>
                {t.teams.register}
              </button>
            </div>
          ) : (
            <p className="note">
              {t.teams.noTeams} <Link to="/me/teams">{t.teams.title}</Link>
            </p>
          )}
        </>
      )}
      {meetings.length > 0 && (
        <>
          <h2>{t.teams.meetings}</h2>
          <ul className="stack">
            {meetings.map((m) => (
              <li key={m.id} className="row row--between">
                <span>
                  №{m.number} · {m.home?.name} — {m.away?.name} {m.setsHome != null && `· ${m.setsHome}:${m.setsAway}`}
                </span>
                <span className="row">
                  <StatusChip status={m.status} />
                  <Link className="button button--sm" to={`/meeting/${d.id}/${m.id}`}>
                    {t.teams.open}
                  </Link>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      {error && <p className="note note--error">{error}</p>}
    </section>
  )
}
