import { useState } from 'react'
import { useOutletContext } from 'react-router'
import { api } from '../../api/client.ts'
import { useApi } from '../../app/hooks.ts'
import { formatDateTime } from '../../i18n/format.ts'
import { t } from '../../i18n/index.ts'
import { Async, Seg } from '../../ui/kit.tsx'
import { useAction } from '../account/AccountFlows.tsx'

const useReloadOverview = () => useOutletContext<{ reloadOverview: () => void }>().reloadOverview

type AdminClub = { id: number; slug: string; name: string; description: string; status: string; status_reason: string | null; requisites: Record<string, string>; contact_email: string | null; city: string; owner: string; created_at: string }

export function AdminClubs() {
  const [status, setStatus] = useState('review')
  const state = useApi<AdminClub[]>(`/admin/clubs?status=${status}`)
  const reloadOverview = useReloadOverview()
  const { busy, run, notes } = useAction()
  const act = (id: number, to: string) => {
    const reason = to === 'active' ? '' : prompt(t.admin.reasonPrompt)
    if (reason === null) return
    void run(async () => {
      await api(`/admin/clubs/${id}/status`, { method: 'POST', json: { status: to, reason } })
      state.reload()
      reloadOverview()
    })
  }
  return (
    <div className="stack">
      <Seg value={status} onChange={setStatus} label={t.admin.clubs} options={(['review', 'active', 'rejected', 'blocked'] as const).map((s) => [s, t.clubreg.status[s] ?? s] as const)} />
      {notes}
      <Async state={state}>
        {(list) =>
          list.length ? (
            <div className="grid grid--half">
              {list.map((c) => (
                <section key={c.id} className="panel stack">
                  <h2>{c.name}</h2>
                  <p className="small muted">
                    {c.city} · {t.admin.owner}: {c.owner} · {formatDateTime(c.created_at)}
                  </p>
                  <p className="small">{c.description}</p>
                  <p className="small mono">{Object.entries(c.requisites).map(([k, v]) => `${k}: ${v}`).join(' · ') || '—'}</p>
                  {c.status_reason && <p className="note">{c.status_reason}</p>}
                  <div className="row">
                    {(c.status === 'review' || c.status === 'blocked') && (
                      <button className="button button--sm button--primary" disabled={busy} onClick={() => act(c.id, 'active')}>
                        {t.admin.approve}
                      </button>
                    )}
                    {c.status === 'review' && (
                      <button className="button button--sm button--danger" disabled={busy} onClick={() => act(c.id, 'rejected')}>
                        {t.admin.reject}
                      </button>
                    )}
                    {c.status === 'active' && (
                      <button className="button button--sm button--danger" disabled={busy} onClick={() => act(c.id, 'blocked')}>
                        {t.admin.block}
                      </button>
                    )}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <p className="empty">{t.admin.empty}</p>
          )
        }
      </Async>
    </div>
  )
}

type Brief = { id: number; name: string; birthYear: number; hasAccount: boolean }
type Merge = { id: number; reason: string; club: string | null; createdAt: string; source: Brief; target: Brief }

const brief = (p: Brief) => `${p.name}, ${p.birthYear} (#${p.id}${p.hasAccount ? `, ${t.m.account.toLowerCase()}` : ''})`

export function AdminMerges() {
  const state = useApi<Merge[]>('/admin/merge-requests')
  const reloadOverview = useReloadOverview()
  const { busy, run, notes } = useAction()
  const act = (id: number, action: 'merge' | 'reject') =>
    void run(async () => {
      await api(`/admin/merge-requests/${id}`, { method: 'POST', json: { action } })
      state.reload()
      reloadOverview()
    })
  return (
    <div className="stack">
      {notes}
      <Async state={state}>
        {(list) =>
          list.length ? (
            list.map((m) => (
              <section key={m.id} className="panel stack">
                <p>
                  {t.admin.source}: <b>{brief(m.source)}</b> → {t.admin.target}: <b>{brief(m.target)}</b>
                </p>
                <p className="small muted">
                  {m.club ?? '—'} · {m.reason} · {formatDateTime(m.createdAt)}
                </p>
                <div className="row">
                  <button className="button button--sm button--primary" disabled={busy} onClick={() => act(m.id, 'merge')}>
                    {t.admin.merge}
                  </button>
                  <button className="button button--sm" disabled={busy} onClick={() => act(m.id, 'reject')}>
                    {t.admin.reject}
                  </button>
                </div>
              </section>
            ))
          ) : (
            <p className="empty">{t.admin.empty}</p>
          )
        }
      </Async>
    </div>
  )
}

type Claim = {
  id: number
  kind: 'claim' | 'add_request'
  reason: string
  payload: { fullName?: string; birthYear?: number; rating?: number; url?: string }
  player: { id: number; name: string; birthYear: number }
  profile: { id: number; fullName: string; rating: number; birthYear: number | null } | null
  holder: { id: number; name: string } | null
}
type Profile = { id: number; rttfId: string | null; fullName: string; birthYear: number | null; city: string; rating: number; transferred: number; claimedBy: { id: number } | null }

export function AdminRttf() {
  const claims = useApi<Claim[]>('/admin/rttf/claims')
  const [q, setQ] = useState('')
  const list = useApi<{ total: number | null; items: Profile[] }>(`/admin/rttf?limit=50&q=${encodeURIComponent(q)}`)
  const reloadOverview = useReloadOverview()
  const upload = useAction()
  const act = useAction()
  const edit = useAction()
  const resolve = (id: number, action: 'approve' | 'reject') =>
    void act.run(async () => {
      await api(`/admin/rttf/claims/${id}`, { method: 'POST', json: { action } })
      claims.reload()
      list.reload()
      reloadOverview()
    })
  const editRating = (p: Profile) => {
    const v = prompt(`${p.fullName}: ${t.rttf.rating}`, String(p.rating))
    if (v == null || !Number.isFinite(Number(v))) return
    void edit.run(async () => {
      await api(`/admin/rttf/${p.id}`, { method: 'PATCH', json: { rating: Number(v) } })
      list.reload()
    })
  }
  return (
    <div className="grid grid--half">
      <section className="panel stack">
        <h2>{t.admin.claims}</h2>
        {act.notes}
        <Async state={claims}>
          {(rows) =>
            rows.length ? (
              <>
                {rows.map((c) => (
                  <div key={c.id} className="stack" style={{ borderBottom: '1px solid var(--line, #333)', paddingBottom: 8 }}>
                    <p className="small">
                      <b>{c.player.name}</b>, {c.player.birthYear} →{' '}
                      {c.kind === 'add_request' ? `${t.admin.request}: ${c.payload.fullName}, ${c.payload.birthYear}, RTTF ${c.payload.rating} ${c.payload.url ?? ''}` : `${c.profile?.fullName}, ${c.profile?.birthYear ?? '—'}, RTTF ${c.profile?.rating}`}
                    </p>
                    {c.holder && (
                      <p className="small muted">
                        {t.admin.holder}: {c.holder.name} · {c.reason}
                      </p>
                    )}
                    <div className="row">
                      <button className="button button--sm button--primary" disabled={act.busy} onClick={() => resolve(c.id, 'approve')}>
                        {t.admin.approve}
                      </button>
                      <button className="button button--sm" disabled={act.busy} onClick={() => resolve(c.id, 'reject')}>
                        {t.admin.reject}
                      </button>
                    </div>
                  </div>
                ))}
              </>
            ) : (
              <p className="empty">{t.admin.empty}</p>
            )
          }
        </Async>
      </section>
      <section className="panel stack">
        <h2>{t.admin.rttf}</h2>
        <label className="field">
          {t.admin.importFile}
          <input
            type="file"
            accept=".xlsx,.csv,text/csv"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (!file) return
              void upload.run(async () => {
                const type = file.name.endsWith('.xlsx') ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'text/csv'
                const r = await api<{ created: number; updated: number; errors: unknown[] }>('/admin/rttf/import', { method: 'POST', body: file, headers: { 'Content-Type': type } })
                list.reload()
                return t.admin.imported(r.created, r.updated, r.errors.length)
              })
            }}
          />
        </label>
        {upload.notes}
        <input type="search" placeholder={t.rttf.search} aria-label={t.rttf.search} value={q} onChange={(e) => setQ(e.target.value)} />
        {edit.notes}
        <Async state={list}>
          {(d) => (
            <div className="tablewrap">
              <table className="table">
                <tbody>
                  {d.items.map((p) => (
                    <tr key={p.id}>
                      <td>
                        {p.fullName}
                        {p.claimedBy && <span className="chip chip--ok">#{p.claimedBy.id}</span>}
                      </td>
                      <td>{p.birthYear ?? '—'}</td>
                      <td>{p.city}</td>
                      <td className="mono">
                        <button className="button button--sm" onClick={() => editRating(p)}>
                          {p.rating}
                        </button>
                      </td>
                      <td className="mono muted">{p.transferred}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Async>
      </section>
    </div>
  )
}
