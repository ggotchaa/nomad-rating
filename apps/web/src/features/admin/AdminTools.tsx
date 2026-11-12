import { useState } from 'react'
import { useNavigate } from 'react-router'
import { api } from '../../api/client.ts'
import { useApi } from '../../app/hooks.ts'
import { errorText, t } from '../../i18n/index.ts'
import { formatDate, formatDateTime } from '../../i18n/format.ts'
import { Async, Field } from '../../ui/kit.tsx'
import { ask } from '../../ui/dialogs.tsx'

export const VIEW_AS_KEY = 'nomad.viewAsClub'

function useAction() {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const run = async (fn: () => Promise<unknown>, ok: (r: unknown) => string = () => t.common.saved) => {
    setMsg(null)
    try {
      setMsg({ ok: true, text: ok(await fn()) })
      return true
    } catch (e) {
      setMsg({ ok: false, text: errorText(e) })
      return false
    }
  }
  const note = msg && <p className={`note ${msg.ok ? 'note--ok' : 'note--error'}`}>{msg.text}</p>
  return { run, note }
}

type PlayerRow = { id: number; name: string; birthYear: number; city: string | null; rating: number | null; tournaments: number; user: { id: number; email: string; blocked: boolean } | null }
type PlayerDetail = { id: number; name: string; rating: number | null; source: string | null; history: { id: number; title: string; at: string; rating_before: number | null; rating_after: number | null; delta: number }[]; adjustments: { id: number; rating_before: number | null; rating_after: number; reason: string; created_at: string }[] }

function PlayerCard({ id, onChanged }: { id: number; onChanged: () => void }) {
  const state = useApi<PlayerDetail>(`/admin/players/${id}`)
  const [rating, setRating] = useState('')
  const [from, setFrom] = useState('')
  const [reason, setReason] = useState('')
  const { run, note } = useAction()
  return (
    <Async state={state}>
      {(p) => (
        <div className="panel stack">
          <h3>
            {p.name} · {t.admin2.rating} {p.rating ?? '—'}
          </h3>
          <div className="form form--cols">
            <Field label={t.admin2.rating}>
              <input type="number" min={100} max={4000} value={rating} onChange={(e) => setRating(e.target.value)} />
            </Field>
            <Field label={t.admin2.fromTournament}>
              <select value={from} onChange={(e) => setFrom(e.target.value)}>
                <option value="">{t.admin2.now}</option>
                {p.history.map((h) => (
                  <option key={h.id} value={h.id}>
                    {formatDate(h.at)} · {h.title} ({h.rating_before ?? '—'} → {h.rating_after ?? '—'})
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t.admin2.reason} wide>
              <input value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
            </Field>
          </div>
          <div>
            <button
              className="button button--primary button--sm"
              disabled={!rating || reason.trim().length < 3}
              onClick={() =>
                void run(
                  () => api<{ rating: number; replay: { tournaments: number; ms: number } | null }>(`/admin/players/${id}/rating`, { method: 'POST', json: { rating: Number(rating), fromTournamentId: from ? Number(from) : null, reason } }),
                  (r) => {
                    const res = r as { rating: number; replay: { tournaments: number; ms: number } | null }
                    state.reload()
                    onChanged()
                    return `${t.admin2.rating}: ${res.rating}${res.replay ? ` · ${t.admin2.replay(res.replay.tournaments, res.replay.ms)}` : ''}`
                  },
                )
              }
            >
              {t.admin2.correct}
            </button>
          </div>
          {note}
          {p.adjustments.map((a) => (
            <p key={a.id} className="small muted">
              {formatDateTime(a.created_at)}: {a.rating_before ?? '—'} → {a.rating_after} · {a.reason}
            </p>
          ))}
        </div>
      )}
    </Async>
  )
}

export function AdminPlayers() {
  const [q, setQ] = useState('')
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<number | null>(null)
  const [merge, setMerge] = useState({ sourceId: '', targetId: '', reason: '' })
  const state = useApi<PlayerRow[]>(query ? `/admin/players?q=${encodeURIComponent(query)}` : null)
  const { run, note } = useAction()
  const block = async (u: NonNullable<PlayerRow['user']>) => {
    const reason = u.blocked ? '' : ((await ask.prompt(t.admin2.reason)) ?? '')
    if (!u.blocked && !reason) return
    void run(() => api(`/admin/users/${u.id}/block`, { method: 'POST', json: { blocked: !u.blocked, reason } })).then(state.reload)
  }
  return (
    <div className="stack">
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault()
          setQuery(q.trim())
        }}
      >
        <input type="search" value={q} placeholder={t.admin2.search} aria-label={t.admin2.search} onChange={(e) => setQ(e.target.value)} />
        <button className="button button--sm">{t.r.searchName}</button>
      </form>
      {note}
      {query && (
        <Async state={state}>
          {(rows) => (
            <div className="tablewrap">
              <table className="table">
                <tbody>
                  {rows.map((p) => (
                    <tr key={p.id}>
                      <td className="rank">{p.id}</td>
                      <td>
                        <button className="linklike" onClick={() => setOpen(open === p.id ? null : p.id)}>
                          {p.name}
                        </button>
                        <span className="muted small">
                          {' '}
                          · {p.birthYear} · {p.city ?? '—'}
                        </span>
                      </td>
                      <td>{p.rating ?? '—'}</td>
                      <td className="small">{p.user ? `${p.user.email}${p.user.blocked ? ` · ${t.admin2.blocked}` : ''}` : t.admin2.noAccount}</td>
                      <td>
                        {p.user && (
                          <button className={`button button--sm${p.user.blocked ? '' : ' button--danger'}`} onClick={() => block(p.user!)}>
                            {p.user.blocked ? t.admin2.unblock : t.admin2.block}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Async>
      )}
      {open && <PlayerCard key={open} id={open} onChanged={state.reload} />}
      <section className="panel">
        <h2>{t.admin2.merge}</h2>
        <p className="small muted">{t.admin2.mergeHint}</p>
        <div className="form form--cols">
          <Field label={t.admin2.source}>
            <input inputMode="numeric" value={merge.sourceId} onChange={(e) => setMerge({ ...merge, sourceId: e.target.value })} />
          </Field>
          <Field label={t.admin2.target}>
            <input inputMode="numeric" value={merge.targetId} onChange={(e) => setMerge({ ...merge, targetId: e.target.value })} />
          </Field>
          <Field label={t.admin2.reason} wide>
            <input value={merge.reason} onChange={(e) => setMerge({ ...merge, reason: e.target.value })} />
          </Field>
        </div>
        <div>
          <button className="button button--sm button--danger" disabled={!merge.sourceId || !merge.targetId || merge.reason.trim().length < 3} onClick={async () => (await ask.confirm(t.admin2.mergeHint)) && void run(() => api('/admin/players/merge', { method: 'POST', json: { sourceId: Number(merge.sourceId), targetId: Number(merge.targetId), reason: merge.reason } }))}>
            {t.admin2.merge}
          </button>
        </div>
      </section>
    </div>
  )
}

function SettingEditor({ name, value }: { name: string; value: unknown }) {
  const [text, setText] = useState(JSON.stringify(value, null, 2))
  const { run, note } = useAction()
  return (
    <section className="panel stack">
      <h2>{t.admin2.keys[name] ?? name}</h2>
      <textarea className="mono" rows={Math.min(18, text.split('\n').length + 1)} value={text} spellCheck={false} onChange={(e) => setText(e.target.value)} />
      <div>
        <button
          className="button button--primary button--sm"
          onClick={() =>
            void run(() => {
              const parsed: unknown = JSON.parse(text)
              return api(`/admin/settings/${name}`, { method: 'PUT', json: parsed })
            })
          }
        >
          {t.common.save}
        </button>
      </div>
      {note}
    </section>
  )
}

export function AdminSettings() {
  const state = useApi<Record<string, unknown>>('/admin/settings')
  return (
    <div className="stack">
      <p className="small muted">{t.admin2.settingsHint}</p>
      <Async state={state}>{(s) => <div className="grid grid--half">{Object.entries(s).map(([k, v]) => <SettingEditor key={k} name={k} value={v} />)}</div>}</Async>
    </div>
  )
}

type AuditRow = { id: number; at: string; entity: string; entity_id: string; action: string; before: unknown; after: unknown; reason: string | null; club: string | null; actor: string | null }

export function AdminAudit() {
  const [f, setF] = useState({ entity: '', action: '', actor: '', clubId: '', from: '', to: '' })
  const [applied, setApplied] = useState(f)
  const [extra, setExtra] = useState<AuditRow[]>([])
  const qs = (before?: number) => new URLSearchParams(Object.entries({ ...applied, before: before ? String(before) : '' }).filter(([, v]) => v)).toString()
  const state = useApi<AuditRow[]>(`/admin/audit?${qs()}`)
  const rows = [...(state.data ?? []), ...extra]
  return (
    <div className="stack">
      <form
        className="form form--cols"
        onSubmit={(e) => {
          e.preventDefault()
          setExtra([])
          setApplied(f)
        }}
      >
        {(['entity', 'action', 'actor', 'clubId'] as const).map((k) => (
          <Field key={k} label={t.admin2[k]}>
            <input value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
          </Field>
        ))}
        <Field label={t.bset.from}>
          <input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} />
        </Field>
        <Field label={t.bset.to}>
          <input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} />
        </Field>
        <div>
          <button className="button button--sm button--primary">{t.r.searchName}</button>
        </div>
      </form>
      <Async state={state}>
        {() => (
          <div className="tablewrap">
            <table className="table">
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="small">{formatDateTime(r.at)}</td>
                    <td className="small">{r.actor ?? '—'}</td>
                    <td>
                      <b>{r.entity}</b> #{r.entity_id} · {r.action}
                      {r.club && <span className="muted small"> · {r.club}</span>}
                      {r.reason && <div className="small">{r.reason}</div>}
                    </td>
                    <td className="small mono audit-diff">{r.after ? JSON.stringify(r.after).slice(0, 160) : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Async>
      {rows.length >= 50 && (
        <div>
          <button className="button button--sm" onClick={() => void api<AuditRow[]>(`/admin/audit?${qs(rows[rows.length - 1]!.id)}`).then((more) => setExtra((x) => [...x, ...more]))}>
            {t.admin2.more}
          </button>
        </div>
      )}
    </div>
  )
}

type Dispute = { id: number; entity: string; entityId: string; reason: string; status: string; resolution: string | null; createdAt: string; tournament: { title: string; slug: string } | null; club: string | null; author: string | null }

function DisputeCard({ d, onDone }: { d: Dispute; onDone: () => void }) {
  const [resolution, setResolution] = useState('')
  const [games, setGames] = useState('')
  const { run, note } = useAction()
  const parsed = games
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((g) => g.split(':').map(Number))
    .map(([home, away]) => ({ home: home ?? NaN, away: away ?? NaN }))
  const gamesOk = parsed.length > 0 && parsed.every((g) => Number.isInteger(g.home) && Number.isInteger(g.away))
  return (
    <section className="panel stack">
      <div className="row row--between">
        <b>
          {d.tournament?.title ?? '—'} · {d.entity} #{d.entityId}
        </b>
        <span className="small muted">
          {formatDateTime(d.createdAt)} · {d.author} {d.club && `· ${d.club}`}
        </span>
      </div>
      <p>{d.reason}</p>
      {d.status === 'open' ? (
        <>
          {d.entity === 'match' && (
            <div className="row">
              <input value={games} placeholder={t.admin2.games} aria-label={t.admin2.games} onChange={(e) => setGames(e.target.value)} />
              <button className="button button--sm" disabled={!gamesOk} onClick={() => void run(() => api(`/rating/matches/${d.entityId}/correct`, { method: 'POST', json: { games: parsed, reason: `${t.admin2.disputes} #${d.id}` } }))}>
                {t.admin2.correctMatch}
              </button>
            </div>
          )}
          <Field label={t.admin2.resolution}>
            <input value={resolution} maxLength={1000} onChange={(e) => setResolution(e.target.value)} />
          </Field>
          <div className="row">
            <button className="button button--primary button--sm" onClick={() => void run(() => api(`/rating/disputes/${d.id}`, { method: 'PATCH', json: { status: 'resolved', resolution } })).then(onDone)}>
              {t.admin2.resolve}
            </button>
            <button className="button button--sm button--danger" onClick={() => void run(() => api(`/rating/disputes/${d.id}`, { method: 'PATCH', json: { status: 'rejected', resolution } })).then(onDone)}>
              {t.admin2.reject}
            </button>
          </div>
        </>
      ) : (
        <p className="small muted">
          {d.status} · {d.resolution}
        </p>
      )}
      {note}
    </section>
  )
}

export function AdminDisputes() {
  const [status, setStatus] = useState('open')
  const state = useApi<Dispute[]>(`/rating/disputes?status=${status}`)
  return (
    <div className="stack">
      <select style={{ width: 'auto' }} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="status">
        {['open', 'resolved', 'rejected'].map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
      <Async state={state}>{(list) => (list.length ? <>{list.map((d) => <DisputeCard key={d.id} d={d} onDone={state.reload} />)}</> : <p className="empty">{t.bset.none}</p>)}</Async>
    </div>
  )
}

export function AdminViewAs() {
  const [q, setQ] = useState('')
  const state = useApi<{ id: number; slug: string; name: string; status: string }[]>(`/admin/clubs/all?q=${encodeURIComponent(q)}`)
  const navigate = useNavigate()
  const open = (id: number) => {
    try {
      sessionStorage.setItem(VIEW_AS_KEY, String(id))
    } catch {
      /* storage blocked */
    }
    void navigate('/manage')
  }
  return (
    <div className="stack">
      <p className="small muted">{t.admin2.viewAsHint}</p>
      <input type="search" value={q} placeholder={t.m.name} aria-label={t.m.name} onChange={(e) => setQ(e.target.value)} />
      <Async state={state}>
        {(list) => (
          <div className="stack">
            {list.map((c) => (
              <div key={c.id} className="row row--between">
                <span>
                  {c.name} <span className="chip">{c.status}</span>
                </span>
                <button className="button button--sm" onClick={() => open(c.id)}>
                  {t.admin2.open}
                </button>
              </div>
            ))}
          </div>
        )}
      </Async>
    </div>
  )
}
