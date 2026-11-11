import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { zonedToUtc } from '@nomad/shared'
import { api } from '../../api/client.ts'
import type { FormatOption, FormatPreview, Hall, ManageTournament, TournamentDetail } from '../../api/types.ts'
import { useApi, useRoom } from '../../app/hooks.ts'
import { errorText, t } from '../../i18n/index.ts'
import { formatDateTime, formatDuration, formatTenge, localDate, parseHhmm } from '../../i18n/format.ts'
import { Async, Field, Soon, StatusChip } from '../../ui/kit.tsx'
import { PlayerSearch, useClub } from './ManageLayout.tsx'

export function ManageTournaments() {
  const { club } = useClub()
  const list = useApi<ManageTournament[]>(`/clubs/${club.id}/tournaments`)
  return (
    <section className="panel">
      <div className="panel__head">
        <h2>{t.m.tournaments}</h2>
        <Link className="button button--primary button--sm" to="new">
          + {t.m.newTournament}
        </Link>
      </div>
      <Async state={list}>
        {(rows) => (
          <div className="tablewrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t.m.date}</th>
                  <th>{t.m.name}</th>
                  <th>Статус</th>
                  <th className="num">{t.t.participants}</th>
                  <th className="num">{t.t.fee}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((x) => (
                  <tr key={x.id}>
                    <td className="mono small muted">{formatDateTime(x.starts_at)}</td>
                    <td>
                      <Link to={String(x.id)}>{x.title}</Link>
                    </td>
                    <td>
                      <StatusChip status={x.status} />
                    </td>
                    <td className="num">
                      {x.taken} / {x.max_participants}
                    </td>
                    <td className="num">{formatTenge(x.fee)}</td>
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

export function NewTournament() {
  const { club } = useClub()
  const navigate = useNavigate()
  const hallId = club.halls[0]?.id
  const formats = useApi<FormatOption[]>('/formats')
  const hall = useApi<Hall>(hallId ? `/halls/${hallId}` : null)
  const [template, setTemplate] = useState('gs1')
  const [max, setMax] = useState(16)
  const [preview, setPreview] = useState<FormatPreview | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const tables = hall.data?.tables.filter((x) => x.status === 'active').length ?? 0

  useEffect(() => {
    if (!tables || max < 4) return
    let alive = true
    const id = setTimeout(() => {
      api<FormatPreview>('/formats/preview', { method: 'POST', json: { template, params: {}, players: max, tables } })
        .then((p) => {
          if (!alive) return
          setPreview(p)
          setPreviewError(p.errors.length ? t.errors['format.invalid']! : null)
        })
        .catch((e: unknown) => {
          if (!alive) return
          setPreview(null)
          setPreviewError(errorText(e))
        })
    }, 250)
    return () => {
      alive = false
      clearTimeout(id)
    }
  }, [template, max, tables])

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const num = (k: string) => (f.get(k) ? Number(f.get(k)) : null)
    setBusy(true)
    setError(null)
    try {
      const created = await api<{ id: number }>(`/clubs/${club.id}/tournaments`, {
        method: 'POST',
        json: {
          hallId,
          title: f.get('title'),
          startsAt: zonedToUtc(String(f.get('date')), parseHhmm(String(f.get('time'))), 'Asia/Almaty').toISOString(),
          template,
          templateParams: {},
          maxParticipants: max,
          fee: Math.round(Number(f.get('fee') || 0) * 100),
          restrictions: { ratingMin: num('ratingMin'), ratingMax: num('ratingMax') },
          description: f.get('description') ?? '',
        },
      })
      navigate(`../tournaments/${created.id}`)
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid grid--2">
      <form className="panel form form--cols" onSubmit={(e) => void onSubmit(e)}>
        <h2 className="field--wide">{t.m.newTournament}</h2>
        <Field label={t.m.name} wide>
          <input name="title" required minLength={3} maxLength={150} placeholder="Субботний рейтинговый турнир" />
        </Field>
        <Field label={t.m.date}>
          <input name="date" type="date" required min={localDate()} defaultValue={localDate(new Date(Date.now() + 7 * 86400000))} />
        </Field>
        <Field label={t.m.time}>
          <input name="time" type="time" required defaultValue="11:00" />
        </Field>
        <Field label={t.m.format} wide>
          <select value={template} onChange={(e) => setTemplate(e.target.value)}>
            {formats.data?.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t.m.max}>
          <input type="number" min={4} max={256} value={max} onChange={(e) => setMax(Number(e.target.value))} required />
        </Field>
        <Field label={t.m.fee}>
          <input name="fee" type="number" min={0} step={100} defaultValue={3000} />
        </Field>
        <Field label={t.m.ratingFrom}>
          <input name="ratingMin" type="number" min={0} max={3000} placeholder="—" />
        </Field>
        <Field label={t.m.ratingTo}>
          <input name="ratingMax" type="number" min={0} max={3000} placeholder="—" />
        </Field>
        <Field label={t.m.description} wide>
          <textarea name="description" maxLength={10000} />
        </Field>
        {error && <p className="note note--error field--wide">{error}</p>}
        <button className="button button--primary field--wide" disabled={busy || !hallId || Boolean(previewError)}>
          {t.m.create}
        </button>
      </form>
      <aside className="panel">
        <h2>{t.m.preview}</h2>
        <p className="small muted">
          {t.m.previewHint} · {tables} {t.common.tables}
        </p>
        {previewError && <p className="note note--error">{previewError}</p>}
        {preview && !previewError && (
          <>
            <div className="stack">
              {preview.estimate.stages.map((s, i) => (
                <div className="row row--between" key={s.id}>
                  <span>
                    {i + 1}. {s.name}
                    {s.groups ? ` · ${s.groups.join(' + ')}` : s.bracketSize ? ` · ${s.bracketSize}` : ''}
                  </span>
                  <span className="chip">
                    {s.matches} {t.t.matches}
                  </span>
                </div>
              ))}
            </div>
            <div className="facts">
              <div className="fact stat">
                <span>{t.t.matches}</span>
                <b>{preview.estimate.totalMatches}</b>
              </div>
              <div className="fact stat">
                <span>{t.t.duration}</span>
                <b>{formatDuration(preview.estimate.minutes)}</b>
              </div>
            </div>
          </>
        )}
      </aside>
    </div>
  )
}

export function ManageTournamentPage() {
  const { id } = useParams()
  const state = useApi<TournamentDetail>(`/tournaments/${id}`)
  useRoom(`tournament:${id}`, state.reload)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  const run = async (path: string, json?: unknown, ok?: string) => {
    setMessage(null)
    try {
      await api(path, { method: 'POST', json })
      if (ok) setMessage({ ok: true, text: ok })
      state.reload()
    } catch (e) {
      setMessage({ ok: false, text: errorText(e) })
    }
  }

  return (
    <Async state={state} skeleton={2}>
      {(d) => (
        <>
          <section className="panel">
            <Link className="crumb" to="..">
              ← {t.m.tournaments}
            </Link>
            <div className="panel__head">
              <h2>{d.title}</h2>
              <StatusChip status={d.status} />
            </div>
            <div className="facts">
              <div className="fact">
                <span>{t.t.start}</span>
                <b>{formatDateTime(d.startsAt)}</b>
              </div>
              <div className="fact">
                <span>{t.t.fee}</span>
                <b>{formatTenge(d.fee)}</b>
              </div>
              <div className="fact">
                <span>{t.t.participants}</span>
                <b>
                  {d.taken} / {d.maxParticipants}
                </b>
              </div>
              <div className="fact">
                <span>{t.t.scheme}</span>
                <b>
                  {d.estimate.totalMatches} {t.t.matches} · {formatDuration(d.estimate.minutes)}
                </b>
              </div>
            </div>
            {message && <p className={`note ${message.ok ? 'note--ok' : 'note--error'}`}>{message.text}</p>}
            <div className="row">
              {d.status === 'draft' && (
                <button className="button button--primary" onClick={() => void run(`/tournaments/${d.id}/publish`, undefined, t.m.published)}>
                  {t.m.publish}
                </button>
              )}
              {d.status !== 'draft' && (
                <Link className="button" to={`/t/${d.slug}`}>
                  {t.m.publicPage} →
                </Link>
              )}
            </div>
          </section>
          <section className="panel">
            <h2>
              {t.t.participants} · {d.participants.length}
            </h2>
            {(d.status === 'published' || d.status === 'registration_closed') && (
              <div className="stack" style={{ maxWidth: 420 }}>
                <h3>{t.m.addManually}</h3>
                <PlayerSearch onPick={(p) => void run(`/tournaments/${d.id}/entries/manual`, { playerId: p.id })} />
              </div>
            )}
            <div className="tablewrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>{t.t.player}</th>
                    <th className="num">{t.t.rating}</th>
                    <th>Статус</th>
                    <th>{t.m.payment}</th>
                  </tr>
                </thead>
                <tbody>
                  {d.participants.map((p, i) => (
                    <tr key={p.entryId}>
                      <td className="rank">{i + 1}</td>
                      <td>
                        <Link to={`/players/${p.playerId}`}>{p.name}</Link> <span className="muted small">{p.city}</span>
                      </td>
                      <td className="num">{p.rating ?? `${p.startLevel} ${t.t.calibrating}`}</td>
                      <td>
                        <span className={`chip ${p.status === 'waitlist' ? 'chip--warn' : 'chip--ok'}`}>{t.t.entryStatus[p.status] ?? p.status}</span>
                      </td>
                      <td className="muted small">{p.paymentMethod ? t.m.paymentMethod[p.paymentMethod] : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {d.participants.length === 0 && <p className="empty">—</p>}
          </section>
          <Soon title={t.m.conduct} />
        </>
      )}
    </Async>
  )
}
