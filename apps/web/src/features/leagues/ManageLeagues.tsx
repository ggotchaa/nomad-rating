import { useState } from 'react'
import { Link } from 'react-router'
import { localDate } from '../../i18n/format.ts'
import { api } from '../../api/client.ts'
import { useApi } from '../../app/hooks.ts'
import { errorText, t } from '../../i18n/index.ts'
import { Async, Field } from '../../ui/kit.tsx'
import { PlayerSearch, useClub } from '../manage/ManageLayout.tsx'
import type { LeagueRow, SeasonView, TableRow } from './Leagues.tsx'
import { SeasonTables } from './Leagues.tsx'

type LeagueData = LeagueRow & { seasons: { id: number; name: string; status: string }[]; current: SeasonView | null }

/** Manual draft (L-3): drag players between division columns, then save. */
function Draft({ s, onSave }: { s: SeasonView; onSave: (manual: { participantId: number; divisionId: number }[]) => void }) {
  const [moved, setMoved] = useState<Record<number, number>>({})
  const [drag, setDrag] = useState<number | null>(null)
  const divisionOf = (r: TableRow) => moved[r.participantId] ?? r.divisionId
  return (
    <div className="stack">
      <p className="small muted">{t.leagues.dragHint}</p>
      <div className="grid grid--2">
        {s.divisions.map((d) => (
          <div
            key={d.id}
            className="panel stack"
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => drag != null && setMoved((m) => ({ ...m, [drag]: d.id }))}
          >
            <b>{d.name}</b>
            {s.table
              .filter((r) => divisionOf(r) === d.id)
              .map((r) => (
                <span key={r.participantId} className="chip" draggable onDragStart={() => setDrag(r.participantId)} style={{ cursor: 'grab' }}>
                  {r.name} · {r.rating ?? '—'}
                </span>
              ))}
          </div>
        ))}
      </div>
      {Object.keys(moved).length > 0 && (
        <button className="button button--primary" onClick={() => onSave(Object.entries(moved).map(([participantId, divisionId]) => ({ participantId: Number(participantId), divisionId })))}>
          {t.leagues.saveDraft}
        </button>
      )}
    </div>
  )
}

function SeasonAdmin({ s, hallId, reload }: { s: SeasonView; hallId: number; reload: () => void }) {
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [tourDate, setTourDate] = useState(`${localDate(new Date(Date.now() + 7 * 86400000))}T18:00`)
  const post = (path: string, json: unknown = {}) => {
    setError('')
    setInfo('')
    return api<{ warnings?: unknown[] }>(path, { method: 'POST', json })
      .then((r) => {
        if (r && Array.isArray(r.warnings) && r.warnings.length) setInfo(`${t.leagues.conflicts}: ${r.warnings.length}`)
        reload()
      })
      .catch((e: unknown) => setError(errorText(e)))
  }
  const base = `/leagues/seasons/${s.id}`
  const tourBased = s.format === 'divisions' || s.format === 'common_tour'
  return (
    <section className="panel stack">
      <h2>
        {s.name} · {t.leagues.status[s.status]}
      </h2>
      <div className="row">
        <PlayerSearch placeholder={t.leagues.addPlayers} onPick={(p) => void post(`${base}/participants`, { playerIds: [p.id] })} />
        {s.status !== 'finished' && (
          <button className="button button--sm" onClick={() => void post(`${base}/distribute`)}>
            {t.leagues.distribute}
          </button>
        )}
        {s.status === 'draft' && (
          <button className="button button--sm" onClick={() => void post(`${base}/status`, { status: 'registration' })}>
            {t.leagues.status.registration}
          </button>
        )}
        {['draft', 'registration'].includes(s.status) && (
          <button className="button button--sm button--primary" onClick={() => void post(`${base}/status`, { status: 'active' })}>
            {t.leagues.activate}
          </button>
        )}
        {s.status === 'active' && (
          <button className="button button--sm" onClick={() => void post(`${base}/status`, { status: 'finished' })}>
            {t.leagues.finish}
          </button>
        )}
        <button className="button button--sm" onClick={() => void post(`${base}/merge`)}>
          {t.leagues.merge}
        </button>
        {!tourBased && (
          <button className="button button--sm" onClick={() => void post(`${base}/fixtures`)}>
            {t.leagues.fixturesGen}
          </button>
        )}
        <button
          className="button button--sm"
          onClick={() => {
            const name = prompt(t.leagues.newSeason)
            if (name) void post(`${base}/next`, { name, startsOn: localDate(), endsOn: localDate(new Date(Date.now() + 120 * 86400000)) })
          }}
        >
          {t.leagues.next}
        </button>
      </div>
      {s.status === 'active' && tourBased && (
        <div className="row">
          <input type="datetime-local" value={tourDate} onChange={(e) => setTourDate(e.target.value)} />
          <button className="button button--sm button--primary" onClick={() => void post(`${base}/tours`, { startsAt: new Date(tourDate).toISOString(), hallId })}>
            {t.leagues.newTour}
          </button>
          <button className="button button--sm" onClick={() => void post(`${base}/tours`, { startsAt: new Date(tourDate).toISOString(), hallId, playoff: true })}>
            {t.leagues.playoffTour}
          </button>
        </div>
      )}
      {s.tours
        .filter((x) => x.status !== 'applied')
        .map((x) => (
          <div key={x.id} className="row row--between">
            <span>
              {x.kind === 'playoff' ? t.leagues.playoff : t.leagues.tour(x.number)} ·{' '}
              {x.tournaments.map((tt) => (
                <Link key={tt.id} to={`../tournaments/${tt.id}`} style={{ marginRight: 8 }}>
                  {tt.title.split('·').pop()}
                </Link>
              ))}
            </span>
            <button className="button button--sm" onClick={() => void post(`/leagues/tours/${x.id}/apply`)}>
              {t.leagues.apply}
            </button>
          </div>
        ))}
      {s.divisions.length > 1 && <Draft s={s} onSave={(manual) => void post(`${base}/distribute`, { manual })} />}
      <ul className="stack small">
        {s.table.map((r) => (
          <li key={r.participantId} className="row row--between">
            <span>{r.name}</span>
            {['active', 'frozen'].includes(r.status) && (
              <button className="button button--sm" onClick={() => void post(`/leagues/participants/${r.participantId}/freeze`, { frozen: r.status !== 'frozen' })}>
                {r.status === 'frozen' ? t.leagues.unfreeze : t.leagues.freeze}
              </button>
            )}
          </li>
        ))}
      </ul>
      {info && <p className="note">{info}</p>}
      {error && <p className="note note--error">{error}</p>}
    </section>
  )
}

function LeagueAdmin({ slug, hallId }: { slug: string; hallId: number }) {
  const data = useApi<LeagueData>(`/leagues/${slug}`)
  const [error, setError] = useState('')
  const [name, setName] = useState('')
  const [divisions, setDivisions] = useState('Высший, Первый, Второй')
  return (
    <Async state={data}>
      {(l) => (
        <div className="stack">
          {l.current && <SeasonAdmin s={l.current} hallId={hallId} reload={data.reload} />}
          {l.current && <SeasonTables s={l.current} />}
          <section className="panel form form--cols">
            <h2 className="field--wide">{t.leagues.newSeason}</h2>
            <Field label={t.m.name}>
              <input value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label={t.leagues.divisionNames}>
              <input value={divisions} onChange={(e) => setDivisions(e.target.value)} />
            </Field>
            <button
              className="button button--primary"
              disabled={name.trim().length < 2}
              onClick={() =>
                void api(`/leagues/${l.id}/seasons`, {
                  method: 'POST',
                  json: { name, startsOn: localDate(), endsOn: localDate(new Date(Date.now() + 120 * 86400000)), divisions: divisions.split(',').map((x) => x.trim()).filter(Boolean), payment: { mode: 'season' } },
                })
                  .then(data.reload)
                  .catch((e: unknown) => setError(errorText(e)))
              }
            >
              {t.leagues.newSeason}
            </button>
            {error && <p className="note note--error">{error}</p>}
          </section>
        </div>
      )}
    </Async>
  )
}

export function ManageLeagues() {
  const { club } = useClub()
  const list = useApi<LeagueRow[]>(`/clubs/${club.id}/leagues`)
  const [selected, setSelected] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [format, setFormat] = useState('divisions')
  const [error, setError] = useState('')
  const hallId = club.halls[0]?.id ?? 0
  return (
    <div className="stack">
      <Async state={list}>
        {(rows) => (
          <div className="row">
            {rows.map((l) => (
              <button key={l.id} className={`button button--sm${selected === l.slug ? ' button--primary' : ''}`} onClick={() => setSelected(l.slug)}>
                {l.name}
              </button>
            ))}
          </div>
        )}
      </Async>
      {selected && <LeagueAdmin key={selected} slug={selected} hallId={hallId} />}
      <section className="panel form form--cols">
        <h2 className="field--wide">{t.leagues.create}</h2>
        <Field label={t.m.name}>
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={t.leagues.title}>
          <select value={format} onChange={(e) => setFormat(e.target.value)}>
            {Object.entries(t.leagues.formats).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        <button
          className="button button--primary"
          disabled={name.trim().length < 3}
          onClick={() =>
            void api<LeagueRow>(`/clubs/${club.id}/leagues`, { method: 'POST', json: { name, format } })
              .then((l) => {
                setName('')
                list.reload()
                setSelected(l.slug)
              })
              .catch((e: unknown) => setError(errorText(e)))
          }
        >
          {t.leagues.create}
        </button>
        {error && <p className="note note--error">{error}</p>}
      </section>
    </div>
  )
}
