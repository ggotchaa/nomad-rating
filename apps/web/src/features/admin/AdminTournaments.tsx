import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { api, ApiError } from '../../api/client.ts'
import type { PlayerSearchItem, StageView } from '../../api/types.ts'
import { useApi, useRoom } from '../../app/hooks.ts'
import { formatDateTime } from '../../i18n/format.ts'
import { errorText, t } from '../../i18n/index.ts'
import { ask } from '../../ui/dialogs.tsx'
import { Async, Field, Seg, StatusChip } from '../../ui/kit.tsx'
import { Structure } from '../tournaments/Structure.tsx'

const T = () => t.adminT

const errText = (e: unknown) => (e instanceof ApiError && T().errors[e.code]) || errorText(e)
const blockerText = (code: string) => T().blockers[code] ?? t.errors[code] ?? code

function useAction(reload?: () => void) {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const run = async (fn: () => Promise<unknown>, ok: string = t.common.saved) => {
    setMsg(null)
    try {
      await fn()
      setMsg({ ok: true, text: ok })
      reload?.()
      return true
    } catch (e) {
      setMsg({ ok: false, text: errText(e) })
      return false
    }
  }
  const note = msg && <p className={`note ${msg.ok ? 'note--ok' : 'note--error'}`}>{msg.text}</p>
  return { run, note }
}

const askReason = async (text = T().reasonPrompt) => {
  const r = (await ask.prompt(text))?.trim()
  return r && r.length >= 3 ? r : null
}

const post = (path: string, json: unknown = {}) => api(path, { method: 'POST', json })

// List

type Row = {
  id: number
  slug: string
  title: string
  type: string
  status: string
  starts_at: string
  max_participants: number
  is_test: boolean
  archived_at: string | null
  postponed_at: string | null
  club: string
  city: string
  confirmed: number
  taken: number
  waitlist: number
  matches_total: number
  matches_played: number
}
type ListData = { items: Row[]; total: number; page: number; pageSize: number; clubs: { id: number; name: string }[]; cities: { slug: string; name: string }[] }

const STATUSES = ['draft', 'published', 'registration_closed', 'running', 'finished', 'finished_early', 'cancelled']

export function AdminTournaments() {
  const [f, setF] = useState({ q: '', status: '', clubId: '', city: '', type: '', from: '', to: '', test: '', archived: '' })
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const params = new URLSearchParams(Object.entries({ ...f, q }).filter(([, v]) => v) as [string, string][])
  const state = useApi<ListData>(`/admin/tournaments?${params.toString()}&page=${page}`)
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => {
    setPage(1)
    setF({ ...f, [k]: e.target.value })
  }
  return (
    <div className="stack">
      <form
        className="row"
        style={{ flexWrap: 'wrap' }}
        onSubmit={(e) => {
          e.preventDefault()
          setPage(1)
          setQ(f.q.trim())
        }}
      >
        <input type="search" value={f.q} placeholder={T().search} aria-label={T().search} onChange={(e) => setF({ ...f, q: e.target.value })} />
        <select value={f.status} onChange={set('status')} aria-label={T().status}>
          <option value="">{T().allStatuses}</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {t.t.status[s]}
            </option>
          ))}
        </select>
        <select value={f.clubId} onChange={set('clubId')} aria-label={T().club}>
          <option value="">{T().allClubs}</option>
          {state.data?.clubs.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select value={f.city} onChange={set('city')} aria-label={T().city}>
          <option value="">{T().allCities}</option>
          {state.data?.cities.map((c) => (
            <option key={c.slug} value={c.slug}>
              {c.name}
            </option>
          ))}
        </select>
        <select value={f.type} onChange={set('type')} aria-label={T().type}>
          <option value="">{T().allTypes}</option>
          {(['singles', 'doubles', 'team'] as const).map((x) => (
            <option key={x} value={x}>
              {T().types[x]}
            </option>
          ))}
        </select>
        <input type="date" value={f.from} onChange={set('from')} aria-label={t.finance.from} />
        <input type="date" value={f.to} onChange={set('to')} aria-label={t.finance.to} />
        <select value={f.test} onChange={set('test')} aria-label={T().test}>
          <option value="">{T().testAny}</option>
          <option value="1">{T().testOnly}</option>
          <option value="0">{T().testNo}</option>
        </select>
        <select value={f.archived} onChange={set('archived')} aria-label={T().archived}>
          <option value="">{T().archivedAny}</option>
          <option value="0">{T().archivedNo}</option>
          <option value="1">{T().archivedOnly}</option>
        </select>
        <button className="button button--sm">{t.r.searchName}</button>
        <a className="button button--sm" href={`/api/admin/tournaments?${params.toString()}&format=csv`}>
          CSV
        </a>
      </form>
      <Async state={state}>
        {(d) => (
          <>
            <div className="tablewrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>{T().colTitle}</th>
                    <th>{T().club}</th>
                    <th>{T().colDate}</th>
                    <th>{T().type}</th>
                    <th>{T().status}</th>
                    <th>{T().colEntries}</th>
                    <th>{T().colMatches}</th>
                  </tr>
                </thead>
                <tbody>
                  {d.items.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <Link to={String(r.id)}>{r.title}</Link>
                        {r.is_test && <span className="chip"> {T().testBadge}</span>}
                        {r.archived_at && <span className="chip"> {T().archivedBadge}</span>}
                        {r.postponed_at && <span className="chip chip--warn"> {T().postponedBadge}</span>}
                      </td>
                      <td className="small">
                        {r.club} · {r.city}
                      </td>
                      <td className="small">{formatDateTime(r.starts_at)}</td>
                      <td className="small">{T().types[r.type as 'singles'] ?? r.type}</td>
                      <td>
                        <StatusChip status={r.status} />
                      </td>
                      <td className="small">
                        {r.confirmed}/{r.max_participants}
                        {r.waitlist ? ` +${r.waitlist}` : ''}
                      </td>
                      <td className="small">
                        {r.matches_played}/{r.matches_total}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="row">
              <button className="button button--sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                ←
              </button>
              <span className="small muted">{T().pageOf(d.page, Math.max(1, Math.ceil(d.total / d.pageSize)), d.total)}</span>
              <button className="button button--sm" disabled={page * d.pageSize >= d.total} onClick={() => setPage(page + 1)}>
                →
              </button>
            </div>
          </>
        )}
      </Async>
    </div>
  )
}

// Card

type Action = { key: string; allowed: boolean; blocker?: string; reason: boolean; danger?: boolean; confirm?: boolean }
type Card = {
  tournament: {
    id: number
    slug: string
    title: string
    type: string
    status: string
    startsAt: string
    maxParticipants: number
    minParticipants: number
    description: string
    prizes: string
    commentForPlayers: string
    staffComment: string
    isRated: boolean
    ratingCoefficient: number
    isTest: boolean
    archivedAt: string | null
    postponedAt: string | null
    postponedReason: string | null
    cancelledReason: string | null
    tableIds: number[]
    format: { match: { winsNeeded: number } } & Record<string, unknown>
  }
  club: { id: number; name: string; slug: string }
  hall: { name: string; address: string | null }
  tables: { id: number; number: number; status: string }[]
  counts: Record<string, number>
  problems: string[]
  actions: Action[]
}

const STEPS = ['draft', 'published', 'registration_closed', 'running', 'finished']
const TABS = ['control', 'participants', 'draw', 'matches', 'settings', 'rating', 'history'] as const
type Tab = (typeof TABS)[number]

export function AdminTournament() {
  const { id } = useParams()
  const state = useApi<Card>(`/admin/tournaments/${id}`)
  useRoom(`tournament:${id}`, state.reload)
  const [tab, setTab] = useState<Tab>('control')
  return (
    <Async state={state} skeleton={3}>
      {(d) => (
        <div className="stack">
          <p className="small">
            <Link to="/admin/tournaments">← {T().title}</Link> · <Link to={`/t/${d.tournament.slug}`}>{T().publicPage}</Link>
          </p>
          <h1>
            {d.tournament.title} <StatusChip status={d.tournament.status} />
          </h1>
          <p className="small muted">
            {d.club.name} · {d.hall.name} · {formatDateTime(d.tournament.startsAt)} · {T().types[d.tournament.type as 'singles']}
            {d.tournament.isTest && ` · ${T().testBadge}`}
            {d.tournament.archivedAt && ` · ${T().archivedBadge}`}
          </p>
          {d.tournament.postponedAt && <p className="note">{T().postponedNote(d.tournament.postponedReason ?? '')}</p>}
          {d.tournament.cancelledReason && <p className="note note--error">{d.tournament.cancelledReason}</p>}
          <Lifecycle d={d} reload={state.reload} />
          <Seg value={tab} options={TABS.map((x) => [x, T().tabs[x]] as const)} onChange={setTab} label={T().title} />
          {tab === 'control' && <Control d={d} />}
          {tab === 'participants' && <Participants d={d} reload={state.reload} />}
          {tab === 'draw' && <Draw d={d} reload={state.reload} />}
          {tab === 'matches' && <Matches d={d} reload={state.reload} />}
          {tab === 'settings' && <Settings d={d} reload={state.reload} />}
          {tab === 'rating' && <Rating d={d} />}
          {tab === 'history' && <History id={d.tournament.id} />}
        </div>
      )}
    </Async>
  )
}

function Lifecycle({ d, reload }: { d: Card; reload: () => void }) {
  const navigate = useNavigate()
  const { run, note } = useAction(reload)
  const status = d.tournament.status
  const current = STEPS.indexOf(status === 'finished_early' ? 'finished' : status)
  const act = async (a: Action) => {
    const json: { reason?: string; startsAt?: string; confirm?: boolean } = {}
    if (a.key === 'postpone') {
      const v = (await ask.prompt(T().newDatePrompt, d.tournament.startsAt.slice(0, 16).replace('T', ' ')))?.trim()
      if (!v) return
      const date = new Date(v.replace(' ', 'T'))
      if (Number.isNaN(date.getTime())) return
      json.startsAt = date.toISOString()
    }
    if (a.reason) {
      const r = await askReason()
      if (!r) return
      json.reason = r
    } else if (a.danger && !(await ask.confirm(T().confirmAction(T().actions[a.key] ?? a.key)))) return
    if (a.confirm) {
      if (!(await ask.confirm(T().unpublishPaid))) return
      json.confirm = true
    }
    if (a.key === 'delete') {
      if (await run(() => api(`/admin/tournaments/${d.tournament.id}`, { method: 'DELETE', json }))) navigate('/admin/tournaments')
      return
    }
    await run(() => post(`/admin/tournaments/${d.tournament.id}/actions/${a.key}`, json))
  }
  return (
    <section className="panel stack">
      <ol className="row" style={{ flexWrap: 'wrap', listStyle: 'none', padding: 0 }}>
        {STEPS.map((s, i) => (
          <li key={s} className={`chip${i === current ? ' chip--ok' : i < current ? '' : ' muted'}`}>
            {i + 1}. {t.t.status[s]}
          </li>
        ))}
        {(status === 'cancelled' || status === 'finished_early') && (
          <li>
            <StatusChip status={status} />
          </li>
        )}
      </ol>
      <div className="row" style={{ flexWrap: 'wrap', alignItems: 'flex-start' }}>
        {d.actions.map((a) => (
          <div key={a.key} className="stack" style={{ gap: 2 }}>
            <button className={`button button--sm${a.danger ? ' button--danger' : a.reason ? '' : ' button--primary'}`} disabled={!a.allowed} onClick={() => void act(a)}>
              {T().actions[a.key] ?? a.key}
            </button>
            {a.blocker && <span className="small muted">{blockerText(a.blocker)}</span>}
          </div>
        ))}
        <button className="button button--sm" onClick={() => void run(() => post(`/admin/tournaments/${d.tournament.id}/actions/${d.tournament.isTest ? 'untest' : 'test'}`))}>
          {d.tournament.isTest ? T().actions.untest : T().actions.test}
        </button>
      </div>
      {note}
    </section>
  )
}

function Control({ d }: { d: Card }) {
  const c = d.counts
  const items: [string, string][] = [
    [T().counts.registered, `${c.registered}/${c.limit}`],
    [T().counts.confirmed, `${c.confirmed}/${c.limit}`],
    [T().counts.waitlist, String(c.waitlist)],
    [T().counts.checkedIn, String(c.checkedIn)],
    [T().counts.matches, `${c.matchesPlayed}/${c.matchesTotal}`],
    [T().counts.disputes, String(c.disputes)],
  ]
  return (
    <div className="grid grid--half">
      <section className="panel stack">
        {items.map(([k, v]) => (
          <p key={k} className="row row--between">
            {k} <b>{v}</b>
          </p>
        ))}
      </section>
      <section className="panel stack">
        <h2>{T().checklist}</h2>
        {d.problems.length ? (
          d.problems.map((p) => (
            <p key={p} className="note note--error">
              {T().problems[p] ?? p}
            </p>
          ))
        ) : (
          <p className="note note--ok">{T().noProblems}</p>
        )}
      </section>
    </div>
  )
}

type EntryRow = { id: number; status: string; waitlist_position: number | null; seed: number | null; final_place: number | null; checked_in_at: string | null; name: string; rating: number | null; payment_method: string | null; payment_status: string | null }

function Participants({ d, reload }: { d: Card; reload: () => void }) {
  const base = `/admin/tournaments/${d.tournament.id}`
  const state = useApi<EntryRow[]>(`${base}/entries`)
  const [sel, setSel] = useState<number[]>([])
  const [q, setQ] = useState('')
  const [query, setQuery] = useState('')
  const found = useApi<PlayerSearchItem[]>(query ? `/admin/players?q=${encodeURIComponent(query)}` : null)
  const { run, note } = useAction(() => {
    state.reload()
    reload()
  })
  const bulk = async (ids: number[], status: string) => {
    const reason = await askReason()
    if (reason) await run(() => post(`${base}/entries/bulk`, { ids, status, reason }))
    setSel([])
  }
  const replace = async (entryId: number) => {
    const pid = Number((await ask.prompt(T().replacePrompt))?.trim())
    if (!pid) return
    const reason = await askReason()
    if (reason) await run(() => post(`${base}/entries/${entryId}/replace`, { playerId: pid, reason }))
  }
  const override = async (entryId: number) => {
    const to = (await ask.prompt(T().statusPrompt(Object.keys(t.t.entryStatus).join(', '))))?.trim()
    if (to) await bulk([entryId], to)
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
        <input type="search" value={q} placeholder={T().addPlayer} aria-label={T().addPlayer} onChange={(e) => setQ(e.target.value)} />
        <button className="button button--sm">{t.r.searchName}</button>
      </form>
      {query && (
        <Async state={found}>
          {(rows) => (
            <div className="row" style={{ flexWrap: 'wrap' }}>
              {rows.slice(0, 12).map((p) => (
                <button key={p.id} className="button button--sm" onClick={() => void run(() => post(`${base}/entries`, { playerId: p.id }), T().added)}>
                  + {p.name} ({p.rating ?? '—'})
                </button>
              ))}
            </div>
          )}
        </Async>
      )}
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <span className="small muted">{T().selected(sel.length)}</span>
        <button className="button button--sm" disabled={!sel.length} onClick={() => void bulk(sel, 'paid')}>
          {T().bulk.confirm}
        </button>
        <button className="button button--sm" disabled={!sel.length} onClick={() => void bulk(sel, 'waitlist')}>
          {T().bulk.waitlist}
        </button>
        <button className="button button--sm button--danger" disabled={!sel.length} onClick={() => void bulk(sel, d.tournament.status === 'running' ? 'withdrew' : 'removed_by_club')}>
          {T().bulk.remove}
        </button>
      </div>
      {note}
      <Async state={state}>
        {(rows) => (
          <div className="tablewrap">
            <table className="table">
              <tbody>
                {rows.map((e) => (
                  <tr key={e.id}>
                    <td>
                      <input type="checkbox" aria-label={e.name} checked={sel.includes(e.id)} onChange={(x) => setSel(x.target.checked ? [...sel, e.id] : sel.filter((i) => i !== e.id))} />
                    </td>
                    <td>
                      {e.name} <span className="small muted">{e.rating ?? '—'}</span>
                    </td>
                    <td className="small">
                      {t.t.entryStatus[e.status] ?? e.status}
                      {e.waitlist_position ? ` #${e.waitlist_position}` : ''}
                      {e.seed ? ` · ${T().seed} ${e.seed}` : ''}
                      {e.final_place ? ` · ${t.t.place} ${e.final_place}` : ''}
                    </td>
                    <td className="small">{e.payment_status ? `${e.payment_method} · ${e.payment_status}` : '—'}</td>
                    <td className="row">
                      {(e.status === 'waitlist' || e.status === 'invited') && (
                        <button className="button button--sm" onClick={() => void bulk([e.id], 'paid')}>
                          {T().fromWaitlist}
                        </button>
                      )}
                      <button className="button button--sm" onClick={() => void replace(e.id)}>
                        {T().replace}
                      </button>
                      <button className="button button--sm" onClick={() => void override(e.id)}>
                        {T().changeStatus}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Async>
    </div>
  )
}

type DrawData = { stages: StageView[] | null; locked: boolean; seeds: { entryId: number; seed: number; rating: number | null; name: string }[] }

function Draw({ d, reload }: { d: Card; reload: () => void }) {
  const base = `/admin/tournaments/${d.tournament.id}`
  const state = useApi<DrawData>(`${base}/structure`)
  const [mode, setMode] = useState<'rating' | 'random' | 'manual'>('rating')
  const [seed, setSeed] = useState('')
  const [swap, setSwap] = useState<[string, string]>(['', ''])
  const [lastSeed, setLastSeed] = useState<number | null>(null)
  const { run, note } = useAction(() => {
    state.reload()
    reload()
  })
  const redraw = async () => {
    const reason = await askReason()
    if (!reason) return
    await run(async () => {
      const r = await post(`${base}/redraw`, { reason, mode, seed: seed ? Number(seed) : undefined, swap: mode === 'manual' ? swap.map(Number) : undefined })
      setLastSeed((r as { seed: number | null }).seed)
    })
  }
  return (
    <Async state={state}>
      {(s) => (
        <div className="stack">
          {d.tournament.status === 'running' && (
            <section className="panel stack">
              <h2>{T().redraw}</h2>
              {s.locked ? (
                <p className="note">{T().blockers['adminT.results_exist']}</p>
              ) : (
                <>
                  <Seg value={mode} options={(['rating', 'random', 'manual'] as const).map((m) => [m, T().drawModes[m]] as const)} onChange={setMode} label={T().redraw} />
                  {mode === 'random' && (
                    <Field label={T().seedLabel}>
                      <input type="number" min={0} value={seed} onChange={(e) => setSeed(e.target.value)} />
                    </Field>
                  )}
                  {mode === 'manual' && (
                    <div className="row">
                      {[0, 1].map((i) => (
                        <select key={i} value={swap[i]} aria-label={T().swap} onChange={(e) => setSwap(i === 0 ? [e.target.value, swap[1]] : [swap[0], e.target.value])}>
                          <option value="">—</option>
                          {s.seeds.map((x) => (
                            <option key={x.entryId} value={x.entryId}>
                              {x.seed}. {x.name}
                            </option>
                          ))}
                        </select>
                      ))}
                    </div>
                  )}
                  <div>
                    <button className="button button--sm button--primary" disabled={mode === 'manual' && (!swap[0] || !swap[1] || swap[0] === swap[1])} onClick={() => void redraw()}>
                      {T().redraw}
                    </button>
                  </div>
                  {lastSeed != null && <p className="small">{T().seedShown(lastSeed)}</p>}
                </>
              )}
              {note}
            </section>
          )}
          {s.stages ? <Structure stages={s.stages} /> : <p className="muted">{T().noDraw}</p>}
        </div>
      )}
    </Async>
  )
}

type MatchRow = {
  id: number
  number: number
  status: string
  result_type: string | null
  sets_home: number | null
  sets_away: number | null
  games: { home: number; away: number }[]
  table_id: number | null
  table_number: number | null
  scheduled_at: string | null
  stage_key: string
  stage: string
  group: string | null
  stage_label: string | null
  home: string | null
  away: string | null
}

const parseGames = (v: string) =>
  v
    .split(/[,;\s]+/)
    .filter(Boolean)
    .map((g) => g.split(/[:-]/).map(Number))
    .filter((g) => g.length === 2 && g.every((n) => Number.isInteger(n) && n >= 0))
    .map(([home, away]) => ({ home: home!, away: away! }))

function Matches({ d, reload }: { d: Card; reload: () => void }) {
  const id = d.tournament.id
  const state = useApi<MatchRow[]>(`/admin/tournaments/${id}/matches`)
  const [f, setF] = useState({ stage: '', status: '', table: '' })
  const { run, note } = useAction(() => {
    state.reload()
    reload()
  })
  const tableId = async () => {
    const n = (await ask.prompt(T().tablePrompt))?.trim()
    if (!n) return null
    const table = d.tables.find((x) => String(x.number) === n && d.tournament.tableIds.includes(x.id))
    return table ? table.id : (void ask.confirm(T().noSuchTable), null)
  }
  const finished = d.tournament.status === 'finished' || d.tournament.status === 'finished_early'
  const correct = async (m: MatchRow) => {
    const raw = await ask.prompt(T().gamesPrompt, m.games.map((g) => `${g.home}:${g.away}`).join(' '))
    if (!raw) return
    const games = parseGames(raw)
    if (!games.length) return
    const setsHome = games.filter((g) => g.home > g.away).length
    const setsAway = games.length - setsHome
    if (finished) {
      const reason = await askReason()
      if (reason) await run(() => post(`/rating/matches/${m.id}/correct`, { games, reason }))
      return
    }
    const body = { setsHome, setsAway, games }
    try {
      const impact = await post(`/tournaments/${id}/matches/${m.id}/correct/preview`, body)
      const { rebuild, kept } = impact as { rebuild: number[]; kept: number[] }
      if (!(await ask.confirm(T().impact(rebuild.join(', ') || '—', kept.join(', ') || '—')))) return
    } catch (e) {
      void ask.confirm(errText(e))
      return
    }
    const reason = await askReason()
    if (reason) await run(() => post(`/tournaments/${id}/matches/${m.id}/correct`, { ...body, reason }))
  }
  const withReason = async (path: string, extra: Record<string, unknown> = {}) => {
    const reason = await askReason()
    if (reason) await run(() => post(path, { ...extra, reason }))
  }
  return (
    <Async state={state}>
      {(rows) => {
        const stages = [...new Map(rows.map((r) => [r.stage_key, r.stage])).entries()]
        const shown = rows.filter((r) => (!f.stage || r.stage_key === f.stage) && (!f.status || r.status === f.status) && (!f.table || String(r.table_number) === f.table))
        return (
          <div className="stack">
            <div className="row">
              <select value={f.stage} onChange={(e) => setF({ ...f, stage: e.target.value })} aria-label={T().stage}>
                <option value="">{T().allStages}</option>
                {stages.map(([k, n]) => (
                  <option key={k} value={k}>
                    {n}
                  </option>
                ))}
              </select>
              <select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} aria-label={T().status}>
                <option value="">{T().allStatuses}</option>
                {Object.entries(t.conduct.matchStatus).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
              <input value={f.table} placeholder={T().table} aria-label={T().table} style={{ width: 80 }} onChange={(e) => setF({ ...f, table: e.target.value })} />
            </div>
            {note}
            <div className="tablewrap">
              <table className="table">
                <tbody>
                  {shown.map((m) => {
                    const m0 = `/admin/tournaments/${id}/matches/${m.id}`
                    const c = `/tournaments/${id}/matches/${m.id}`
                    const open = ['scheduled', 'called', 'playing'].includes(m.status)
                    return (
                      <tr key={m.id}>
                        <td className="rank">{m.number}</td>
                        <td className="small">
                          {m.stage}
                          {m.group ? ` · ${m.group}` : m.stage_label ? ` · ${m.stage_label}` : ''}
                        </td>
                        <td>
                          {m.home ?? '—'} — {m.away ?? '—'}
                        </td>
                        <td className="small">
                          {t.conduct.matchStatus[m.status] ?? m.status}
                          {m.sets_home != null && ` · ${m.sets_home}:${m.sets_away}`}
                        </td>
                        <td className="small">
                          {m.table_number ? `${T().table} ${m.table_number}` : ''}
                          {m.scheduled_at ? ` · ${formatDateTime(m.scheduled_at)}` : ''}
                        </td>
                        <td className="row" style={{ flexWrap: 'wrap' }}>
                          {m.status === 'scheduled' && d.tournament.status === 'running' && (
                            <button className="button button--sm" onClick={async () => void run(() => post(`${c}/call`, {}))}>
                              {T().call}
                            </button>
                          )}
                          {m.status === 'called' && (
                            <button className="button button--sm" onClick={() => void run(() => post(`${c}/uncall`))}>
                              {t.conduct.uncall}
                            </button>
                          )}
                          {(m.status === 'called' || m.status === 'playing') && (
                            <button
                              className="button button--sm"
                              onClick={async () => {
                                const tableIdValue = await tableId()
                                if (tableIdValue) await run(() => post(`${c}/table`, { tableId: tableIdValue }))
                              }}
                            >
                              {T().moveTable}
                            </button>
                          )}
                          {open && (
                            <button
                              className="button button--sm"
                              onClick={async () => {
                                const v = (await ask.prompt(T().timePrompt, m.scheduled_at ? m.scheduled_at.slice(0, 16).replace('T', ' ') : ''))?.trim()
                                if (v == null) return
                                const date = v ? new Date(v.replace(' ', 'T')) : null
                                if (date && Number.isNaN(date.getTime())) return
                                await withReason(`${m0}/schedule`, { scheduledAt: date ? date.toISOString() : null })
                              }}
                            >
                              {T().time}
                            </button>
                          )}
                          {open && (
                            <button
                              className="button button--sm"
                              onClick={async () => {
                                const w = (await ask.prompt(T().walkoverPrompt(m.home ?? '1', m.away ?? '2')))?.trim()
                                if (w === '1' || w === '2') await withReason(`${m0}/walkover`, { winner: w === '1' ? 'home' : 'away' })
                              }}
                            >
                              {T().walkover}
                            </button>
                          )}
                          {(m.status === 'scheduled' || m.status === 'called') && (
                            <button className="button button--sm button--danger" onClick={() => void withReason(`${m0}/annul`)}>
                              {T().annul}
                            </button>
                          )}
                          {['finished', 'walkover', 'retired'].includes(m.status) && (
                            <button className="button button--sm" onClick={() => void correct(m)}>
                              {T().correct}
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )
      }}
    </Async>
  )
}

function Settings({ d, reload }: { d: Card; reload: () => void }) {
  const x = d.tournament
  const notStarted = ['draft', 'published', 'registration_closed'].includes(x.status)
  const [v, setV] = useState({
    title: x.title,
    startsAt: x.startsAt.slice(0, 16),
    maxParticipants: String(x.maxParticipants),
    minParticipants: String(x.minParticipants),
    description: x.description,
    prizes: x.prizes,
    commentForPlayers: x.commentForPlayers,
    staffComment: x.staffComment,
    ratingCoefficient: String(x.ratingCoefficient),
  })
  const [tables, setTables] = useState(x.tableIds)
  const [reason, setReason] = useState('')
  const [wins, setWins] = useState(x.format.match.winsNeeded)
  const { run, note } = useAction(reload)
  const text = (k: keyof typeof v, label: string, area = false) => (
    <Field label={label} wide={area}>
      {area ? <textarea value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} /> : <input value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} />}
    </Field>
  )
  const save = () => {
    const common = { title: v.title, description: v.description, prizes: v.prizes, commentForPlayers: v.commentForPlayers, staffComment: v.staffComment, ratingCoefficient: Number(v.ratingCoefficient), reason: reason.trim() || undefined }
    const json = notStarted
      ? { ...common, startsAt: new Date(v.startsAt).toISOString(), maxParticipants: Number(v.maxParticipants), minParticipants: Number(v.minParticipants), tableIds: tables }
      : common
    return run(() => api(`/admin/tournaments/${x.id}`, { method: 'PATCH', json }))
  }
  return (
    <section className="panel stack">
      {!notStarted && <p className="note">{T().startedEditNote}</p>}
      <div className="form form--cols">
        {text('title', T().fields.title)}
        {notStarted && (
          <>
            <Field label={T().fields.startsAt}>
              <input type="datetime-local" value={v.startsAt} onChange={(e) => setV({ ...v, startsAt: e.target.value })} />
            </Field>
            {text('maxParticipants', T().fields.max)}
            {text('minParticipants', T().fields.min)}
          </>
        )}
        {text('ratingCoefficient', T().fields.coefficient)}
        {text('description', T().fields.description, true)}
        {text('prizes', T().fields.prizes, true)}
        {text('commentForPlayers', T().fields.comment, true)}
        {text('staffComment', T().fields.staffComment, true)}
        {notStarted && (
          <Field label={T().fields.tables} wide>
            <div className="row" style={{ flexWrap: 'wrap' }}>
              {d.tables.map((tb) => (
                <label key={tb.id} className="chip">
                  <input type="checkbox" checked={tables.includes(tb.id)} onChange={(e) => setTables(e.target.checked ? [...tables, tb.id] : tables.filter((i) => i !== tb.id))} /> № {tb.number}
                </label>
              ))}
            </div>
          </Field>
        )}
        <Field label={T().reason} wide>
          <input value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </div>
      <div>
        <button className="button button--primary button--sm" disabled={!notStarted && reason.trim().length < 3} onClick={() => void save()}>
          {t.common.save}
        </button>
      </div>
      {x.status === 'running' && (
        <div className="row">
          <span className="small">{t.conduct.matchRules}</span>
          <select value={wins} onChange={(e) => setWins(Number(e.target.value))} aria-label={t.conduct.matchRules}>
            {[2, 3, 4].map((n) => (
              <option key={n} value={n}>
                {t.conduct.bestOf(n)}
              </option>
            ))}
          </select>
          <button className="button button--sm" disabled={wins === x.format.match.winsNeeded} onClick={() => void run(() => api(`/tournaments/${x.id}/format`, { method: 'PUT', json: { ...x.format, match: { ...x.format.match, winsNeeded: wins } } }))}>
            {t.conduct.saveRules}
          </button>
        </div>
      )}
      {note}
    </section>
  )
}

type RatingInfo = { isRated: boolean; effective: boolean; events: number; finished: boolean; recalc: { running: boolean; lastMs?: number } }

function Rating({ d }: { d: Card }) {
  const base = `/admin/tournaments/${d.tournament.id}/rating`
  const state = useApi<RatingInfo>(base)
  const { run, note } = useAction(state.reload)
  const go = async (action: 'recalc' | 'include' | 'exclude') => {
    const reason = await askReason()
    if (reason) await run(() => post(base, { action, reason }), action === 'recalc' ? T().recalcStarted : t.common.saved)
  }
  return (
    <Async state={state}>
      {(r) => (
        <section className="panel stack">
          <p className="row row--between">
            {T().rated} <b>{r.isRated ? t.common.yes : T().no}</b>
          </p>
          <p className="row row--between">
            {T().ratedEffective} <b>{r.effective ? t.common.yes : T().no}</b>
          </p>
          <p className="row row--between">
            {T().ratingEvents} <b>{r.events}</b>
          </p>
          {r.recalc.running && <p className="note">{T().recalcRunning}</p>}
          <div className="row">
            <button className="button button--sm" disabled={!r.finished} onClick={() => void go('recalc')}>
              {T().recalc}
            </button>
            <button className="button button--sm" onClick={() => void go(r.isRated ? 'exclude' : 'include')}>
              {r.isRated ? T().exclude : T().include}
            </button>
          </div>
          {!r.finished && <p className="small muted">{T().recalcOnlyFinished}</p>}
          {note}
        </section>
      )}
    </Async>
  )
}

type AuditRow = { id: number; at: string; entity: string; entity_id: string; action: string; before: unknown; after: unknown; reason: string | null; actor: string | null }

const short = (v: unknown) => (v == null ? '' : JSON.stringify(v).slice(0, 160))

function History({ id }: { id: number }) {
  const [entity, setEntity] = useState('')
  const [action, setAction] = useState('')
  const params = new URLSearchParams(Object.entries({ entity, action }).filter(([, v]) => v) as [string, string][])
  const state = useApi<AuditRow[]>(`/admin/tournaments/${id}/history?${params.toString()}`)
  return (
    <div className="stack">
      <div className="row">
        <select value={entity} onChange={(e) => setEntity(e.target.value)} aria-label={T().entity}>
          <option value="">{T().allEntities}</option>
          {(['tournament', 'match', 'entry'] as const).map((x) => (
            <option key={x} value={x}>
              {T().entities[x]}
            </option>
          ))}
        </select>
        <input value={action} placeholder={T().actionFilter} aria-label={T().actionFilter} onChange={(e) => setAction(e.target.value)} />
      </div>
      <Async state={state}>
        {(rows) => (
          <div className="tablewrap">
            <table className="table">
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="small">{formatDateTime(r.at)}</td>
                    <td className="small">{r.actor ?? T().system}</td>
                    <td className="small">
                      {T().entities[r.entity as 'match'] ?? r.entity} #{r.entity_id}
                    </td>
                    <td>{r.action}</td>
                    <td className="small">{r.reason ?? ''}</td>
                    <td className="small muted">
                      {short(r.before)}
                      {r.before != null || r.after != null ? ' → ' : ''}
                      {short(r.after)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Async>
    </div>
  )
}
