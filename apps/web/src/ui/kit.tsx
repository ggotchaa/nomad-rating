import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { errorText, t } from '../i18n/index.ts'
import { formatDate, formatTenge, formatTime, restrictionLabel, signed } from '../i18n/format.ts'
import type { Restrictions } from '../api/types.ts'

export function Async<T>({ state, children, skeleton = 1 }: { state: { data: T | null; error: unknown; loading: boolean; reload: () => void }; children: (data: T) => ReactNode; skeleton?: number }) {
  if (state.data) return <>{children(state.data)}</>
  if (state.error)
    return (
      <div className="note note--error row row--between">
        <span>{errorText(state.error) === t.errorFallback ? t.common.loadError : errorText(state.error)}</span>
        <button className="button button--sm" onClick={state.reload}>
          {t.common.retry}
        </button>
      </div>
    )
  return (
    <>
      {Array.from({ length: skeleton }, (_, i) => (
        <div className="skeleton" key={i} aria-label={t.common.loading} />
      ))}
    </>
  )
}

export function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: readonly (readonly [T, string])[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={v} type="button" aria-pressed={v === value} onClick={() => onChange(v)}>
          {text}
        </button>
      ))}
    </div>
  )
}

export const Delta = ({ value }: { value: number | null | undefined }) =>
  value == null ? <span className="muted">—</span> : <span className={value > 0 ? 'up' : value < 0 ? 'down' : 'muted'}>{signed(Math.round(value))}</span>

const STATUS_TONE: Record<string, string> = { published: 'chip--ok', running: 'chip--warn', finished: '', finished_early: '', cancelled: 'chip--bad', draft: '', registration_closed: 'chip--holo' }

export const StatusChip = ({ status }: { status: string }) => (
  <span className={`chip ${STATUS_TONE[status] ?? ''}`}>
    {status === 'running' && <i className="dot" />}
    {t.t.status[status] ?? status}
  </span>
)

export function TournamentCard(p: { slug: string; title: string; startsAt: string; fee: number; max: number; taken: number; restrictions: Restrictions; club: string; city?: string; status: string; hideSpots?: boolean }) {
  const full = p.taken >= p.max
  const open = p.status === 'published'
  const limits = restrictionLabel(p.restrictions)
  return (
    <Link className="tcard" to={`/t/${p.slug}`}>
      <div className="tcard__date">
        <span>{formatDate(p.startsAt)}</span>
        <span>{formatTime(p.startsAt)}</span>
      </div>
      <h3>{p.title}</h3>
      <p className="muted small">
        {p.club}
        {p.city ? ` · ${p.city}` : ''}
      </p>
      <div className="row">
        {!open && <StatusChip status={p.status} />}
        {limits && <span className="chip chip--holo">{limits}</span>}
        <span className="chip">{p.fee ? formatTenge(p.fee) : t.common.free}</span>
      </div>
      {!p.hideSpots && (
        <>
          <div className={`meter${full ? ' meter--full' : ''}`}>
            <div style={{ width: `${Math.min(100, (p.taken / p.max) * 100)}%` }} />
          </div>
          <p className="small muted">{full && open ? t.t.full : t.t.taken(p.taken, p.max)}</p>
        </>
      )}
    </Link>
  )
}

export const Field = ({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) => (
  <label className={`field${wide ? ' field--wide' : ''}`}>
    {label}
    {children}
  </label>
)

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="panel">
        <div className="panel__head">
          <h2>{title}</h2>
          <button className="button button--sm" onClick={onClose}>
            {t.common.close}
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

