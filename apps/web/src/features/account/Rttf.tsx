import { useState } from 'react'
import { Navigate } from 'react-router'
import { api } from '../../api/client.ts'
import type { Me } from '../../api/types.ts'
import { useSession } from '../../app/auth.tsx'
import { useApi } from '../../app/hooks.ts'
import { t } from '../../i18n/index.ts'
import { Field } from '../../ui/kit.tsx'
import { useAction } from './AccountFlows.tsx'

export type RttfHit = { id: number; rttfId: string | null; fullName: string; birthYear: number | null; city: string; rating: number; transferred: number; claimedBy: { id: number; name: string } | null }
type Mine = { profile: { id: number; full_name: string; rating: number } | null; claims: { id: number; kind: string; status: string }[] }

export function RttfClaim() {
  const { me, ready, setMe } = useSession()
  const mine = useApi<Mine>(me.player ? '/rttf/mine' : null)
  const [q, setQ] = useState(me.player ? `${me.player.last_name} ${me.player.first_name}` : '')
  const [hits, setHits] = useState<RttfHit[] | null>(null)
  const search = useAction()
  const claim = useAction()
  const add = useAction()
  if (ready && !me.user) return <Navigate to="/login" state={{ from: '/me/rttf' }} replace />
  if (!me.player) return <main className="page">{ready && <p className="note">{t.errors['player.profile_required']}</p>}</main>
  const player = me.player

  return (
    <main className="page page--narrow">
      <h1>{t.rttf.title}</h1>
      <p className="muted">{t.rttf.lead}</p>
      {mine.data?.profile && (
        <p className="note note--ok">
          {t.rttf.current}: {mine.data.profile.full_name} · RTTF {mine.data.profile.rating}
        </p>
      )}
      <form
        className="panel form"
        onSubmit={(e) => {
          e.preventDefault()
          void search.run(async () => setHits(await api<RttfHit[]>(`/rttf/search?q=${encodeURIComponent(q)}&birthYear=${player.birth_year}`)))
        }}
      >
        <Field label={t.rttf.search}>
          <input value={q} onChange={(e) => setQ(e.target.value)} minLength={2} required />
        </Field>
        <button className="button" disabled={search.busy}>
          {t.common.search}
        </button>
        {search.notes}
      </form>
      {hits && (
        <section className="panel stack">
          {hits.length === 0 && <p className="empty">—</p>}
          {hits.map((h) => (
            <div key={h.id} className="row row--between">
              <span>
                <b>{h.fullName}</b> <span className="muted small">· {h.birthYear ?? '—'} · {h.city} · RTTF {h.rating} → {t.rttf.transferred} {h.transferred}</span>
                {h.claimedBy && <span className="chip chip--warn">{t.rttf.taken}</span>}
              </span>
              <button
                className="button button--sm button--primary"
                disabled={claim.busy}
                onClick={() =>
                  void claim.run(async () => {
                    const r = await api<{ status: string; rating?: number }>(`/rttf/${h.id}/claim`, { method: 'POST' })
                    setMe(await api<Me>('/auth/me'))
                    mine.reload()
                    return r.status === 'approved' ? t.rttf.approved(r.rating!) : t.rttf.conflict
                  })
                }
              >
                {t.rttf.me}
              </button>
            </div>
          ))}
          {claim.notes}
        </section>
      )}
      <form
        className="panel form form--cols"
        onSubmit={(e) => {
          e.preventDefault()
          const f = new FormData(e.currentTarget)
          void add.run(async () => {
            await api('/rttf/requests', {
              method: 'POST',
              json: { fullName: f.get('fullName'), birthYear: Number(f.get('birthYear')), city: f.get('city'), rating: Number(f.get('rating')), url: f.get('url') },
            })
            return t.rttf.sent
          })
        }}
      >
        <h2 className="field--wide">{t.rttf.addTitle}</h2>
        <Field label={t.rttf.fullName}>
          <input name="fullName" defaultValue={`${player.last_name} ${player.first_name}`} required />
        </Field>
        <Field label={t.a.birthYear}>
          <input name="birthYear" type="number" defaultValue={player.birth_year} required />
        </Field>
        <Field label={t.common.city}>
          <input name="city" defaultValue={player.city ?? ''} />
        </Field>
        <Field label={t.rttf.rating}>
          <input name="rating" type="number" min="0" required />
        </Field>
        <Field label={t.rttf.url} wide>
          <input name="url" />
        </Field>
        <div className="field--wide">{add.notes}</div>
        <button className="button field--wide" disabled={add.busy}>
          {t.acc.send}
        </button>
      </form>
    </main>
  )
}
