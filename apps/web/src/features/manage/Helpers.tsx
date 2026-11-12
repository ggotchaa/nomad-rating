import { useState } from 'react'
import { CLUB_RIGHTS, RIGHT_TEMPLATES } from '@nomad/shared'
import { api } from '../../api/client.ts'
import { useApi } from '../../app/hooks.ts'
import { formatDateTime } from '../../i18n/format.ts'
import { t } from '../../i18n/index.ts'
import { Async, Field } from '../../ui/kit.tsx'
import { useAction } from '../account/AccountFlows.tsx'
import { useClub } from './ManageLayout.tsx'
import { ask } from '../../ui/dialogs.tsx'

type Scope = { kind: 'club' | 'halls' | 'tournaments' | 'tables'; ids?: number[] }
type Member = { userId: number; role: 'organizer' | 'helper'; rights: string[]; scope: Scope; email: string; name: string | null }
type Invitation = { id: number; email: string | null; rights: string[]; scope: Scope; expires_at: string }

const scopeLabel = (s: Scope) => (s.kind === 'club' ? t.helpers.scopes.club : `${t.helpers.scopes[s.kind]}: ${(s.ids ?? []).join(', ')}`)
const parseIds = (v: string) =>
  v
    .split(/[\s,;]+/)
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0)

function RightsEditor({ rights, setRights, scope, setScope }: { rights: string[]; setRights: (r: string[]) => void; scope: Scope; setScope: (s: Scope) => void }) {
  return (
    <>
      <div className="row">
        {CLUB_RIGHTS.map((r) => (
          <label key={r} className="check">
            <input type="checkbox" checked={rights.includes(r)} onChange={(e) => setRights(e.target.checked ? [...rights, r] : rights.filter((x) => x !== r))} /> {t.helpers.rights[r]}
          </label>
        ))}
      </div>
      <div className="row">
        <Field label={t.helpers.scope}>
          <select value={scope.kind} onChange={(e) => setScope({ kind: e.target.value as Scope['kind'], ids: scope.ids })}>
            {Object.entries(t.helpers.scopes).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        {scope.kind !== 'club' && (
          <Field label={t.helpers.scopeIds}>
            <input defaultValue={(scope.ids ?? []).join(', ')} onChange={(e) => setScope({ kind: scope.kind, ids: parseIds(e.target.value) })} />
          </Field>
        )}
      </div>
    </>
  )
}

function HelperRow({ m, clubId, onChange }: { m: Member; clubId: number; onChange: () => void }) {
  const [rights, setRights] = useState(m.rights)
  const [scope, setScope] = useState<Scope>(m.scope)
  const [open, setOpen] = useState(false)
  const { busy, run, notes } = useAction()
  return (
    <div className="panel stack">
      <div className="row row--between">
        <span>
          <b>{m.name ?? m.email}</b> <span className="muted small">· {m.email}</span>
        </span>
        {m.role === 'organizer' ? (
          <span className="chip chip--holo">{t.helpers.organizer}</span>
        ) : (
          <div className="row">
            <button className="button button--sm" onClick={() => setOpen(!open)}>
              {t.helpers.save}
            </button>
            <button
              className="button button--sm button--danger"
              disabled={busy}
              onClick={async () =>
                (await ask.confirm(t.helpers.revokeConfirm)) &&
                void run(async () => {
                  await api(`/clubs/${clubId}/helpers/${m.userId}`, { method: 'DELETE' })
                  onChange()
                })
              }
            >
              {t.helpers.revoke}
            </button>
          </div>
        )}
      </div>
      {m.role === 'helper' && (
        <p className="small muted">
          {m.rights.map((r) => t.helpers.rights[r] ?? r).join(' · ')} — {scopeLabel(m.scope)}
        </p>
      )}
      {open && (
        <>
          <RightsEditor rights={rights} setRights={setRights} scope={scope} setScope={setScope} />
          <button
            className="button button--sm"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await api(`/clubs/${clubId}/helpers/${m.userId}`, { method: 'PATCH', json: { rights, scope } })
                onChange()
                return t.common.saved
              })
            }
          >
            {t.helpers.save}
          </button>
        </>
      )}
      {notes}
    </div>
  )
}

export function Helpers() {
  const { club } = useClub()
  const state = useApi<{ members: Member[]; invitations: Invitation[] }>(`/clubs/${club.id}/helpers`)
  const [template, setTemplate] = useState('referee')
  const [rights, setRights] = useState<string[]>(RIGHT_TEMPLATES.referee ?? [])
  const [scope, setScope] = useState<Scope>({ kind: 'club' })
  const [email, setEmail] = useState('')
  const [link, setLink] = useState<string | null>(null)
  const invite = useAction()
  const revoke = useAction()
  return (
    <div className="grid grid--half">
      <div className="stack">
        <Async state={state}>
          {(d) => (
            <>
              {d.members.map((m) => (
                <HelperRow key={m.userId} m={m} clubId={club.id} onChange={state.reload} />
              ))}
              {d.invitations.length > 0 && (
                <section className="panel stack">
                  <h2>{t.helpers.pending}</h2>
                  {d.invitations.map((i) => (
                    <div key={i.id} className="row row--between">
                      <span className="small">
                        {i.email ?? t.helpers.link.replace(':', '')} · {i.rights.map((r) => t.helpers.rights[r] ?? r).join(', ')} · {scopeLabel(i.scope)} · {formatDateTime(i.expires_at)}
                      </span>
                      <button
                        className="button button--sm"
                        onClick={() =>
                          void revoke.run(async () => {
                            await api(`/clubs/${club.id}/invitations/${i.id}`, { method: 'DELETE' })
                            state.reload()
                          })
                        }
                      >
                        {t.helpers.revoke}
                      </button>
                    </div>
                  ))}
                  {revoke.notes}
                </section>
              )}
            </>
          )}
        </Async>
      </div>
      <form
        className="panel form"
        onSubmit={(e) => {
          e.preventDefault()
          void invite.run(async () => {
            const r = await api<{ link: string }>(`/clubs/${club.id}/invitations`, { method: 'POST', json: { ...(email && { email }), rights, scope, ...(template && { template }) } })
            setLink(r.link)
            state.reload()
          })
        }}
      >
        <h2>{t.helpers.invite}</h2>
        <Field label={t.helpers.emailOptional}>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label={t.helpers.template}>
          <select
            value={template}
            onChange={(e) => {
              setTemplate(e.target.value)
              if (e.target.value) setRights(RIGHT_TEMPLATES[e.target.value] ?? [])
            }}
          >
            {Object.keys(RIGHT_TEMPLATES).map((k) => (
              <option key={k} value={k}>
                {t.helpers.templates[k] ?? k}
              </option>
            ))}
            <option value="">{t.helpers.custom}</option>
          </select>
        </Field>
        <RightsEditor
          rights={rights}
          setRights={(r) => {
            setRights(r)
            setTemplate('')
          }}
          scope={scope}
          setScope={setScope}
        />
        {invite.notes}
        {link && (
          <p className="note note--ok small" style={{ wordBreak: 'break-all' }}>
            {t.helpers.link} {link}
          </p>
        )}
        <button className="button button--primary" disabled={invite.busy}>
          {t.helpers.invite}
        </button>
      </form>
    </div>
  )
}

type AuditItem = { id: number; at: string; entity: string; entity_id: string; action: string; actor: string | null; reason: string | null }

export function ManageAudit() {
  const { club } = useClub()
  const [filters, setFilters] = useState({ entity: '', from: '', to: '' })
  const qs = new URLSearchParams(Object.entries(filters).filter(([, v]) => v)).toString()
  const state = useApi<{ total: number; items: AuditItem[] }>(`/clubs/${club.id}/audit?limit=100${qs ? `&${qs}` : ''}`)
  return (
    <section className="panel stack">
      <h2>{t.helpers.audit}</h2>
      <div className="row">
        <Field label={t.helpers.entity}>
          <select value={filters.entity} onChange={(e) => setFilters({ ...filters, entity: e.target.value })}>
            <option value="">{t.common.all}</option>
            {['club', 'hall', 'tournament', 'entry', 'booking', 'player', 'helper', 'invitation', 'merge_request'].map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </Field>
        <Field label={t.helpers.from}>
          <input type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} />
        </Field>
        <Field label={t.helpers.to}>
          <input type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} />
        </Field>
      </div>
      <Async state={state}>
        {(d) => (
          <div className="tablewrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t.helpers.when}</th>
                  <th>{t.helpers.actor}</th>
                  <th>{t.helpers.entity}</th>
                  <th>{t.helpers.action}</th>
                </tr>
              </thead>
              <tbody>
                {d.items.map((a) => (
                  <tr key={a.id}>
                    <td className="mono small">{formatDateTime(a.at)}</td>
                    <td>{a.actor ?? '—'}</td>
                    <td>
                      {a.entity} #{a.entity_id}
                    </td>
                    <td>
                      {a.action}
                      {a.reason ? ` — ${a.reason}` : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Async>
    </section>
  )
}
