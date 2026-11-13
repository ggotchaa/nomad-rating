import { useState } from 'react'
import { Link } from 'react-router'
import { localDate } from '../../i18n/format.ts'
import { api, ApiError } from '../../api/client.ts'
import { useApi } from '../../app/hooks.ts'
import { errorText, t } from '../../i18n/index.ts'
import { Async, Field } from '../../ui/kit.tsx'
import { PlayerSearch, useClub } from '../manage/ManageLayout.tsx'
import type { LeagueRow, SeasonView, TableRow } from './Leagues.tsx'
import { SeasonTables } from './Leagues.tsx'
import { ask } from '../../ui/dialogs.tsx'

type LeagueData = LeagueRow & { seasons: { id: number; name: string; status: string }[]; current: SeasonView | null }
type Rules = SeasonView['rules']
type SeasonPayload = { name: string; startsOn: string; endsOn: string; divisions: string[]; rules: Partial<Rules>; payment: SeasonView['payment'] }

function seasonError(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code === 'validation.failed' && Array.isArray(e.details)) {
      const msgs = (e.details as { path: string; message: string }[]).map((d) => t.leagues.issues[d.message] ?? `${errorText(e)}: ${d.path}`)
      return [...new Set(msgs)].join('; ')
    }
    const known = t.leagues.issues[e.code]
    if (known) return known
  }
  return errorText(e)
}

function SeasonForm({ format, initial, locked, submitLabel, onSubmit }: { format: string; initial?: SeasonView; locked?: boolean; submitLabel: string; onSubmit: (p: SeasonPayload) => Promise<unknown> }) {
  const r = initial?.rules
  const [name, setName] = useState(initial?.name ?? '')
  const [startsOn, setStartsOn] = useState(initial?.startsOn?.slice(0, 10) ?? localDate())
  const [endsOn, setEndsOn] = useState(initial?.endsOn?.slice(0, 10) ?? localDate(new Date(Date.now() + 120 * 86400000)))
  const [divisions, setDivisions] = useState<string[]>(initial?.divisions.map((d) => d.name) ?? t.misc.leagueDivisions.split(',').map((x) => x.trim()))
  const [boundaries, setBoundaries] = useState(r?.boundaries ?? [])
  const [points, setPoints] = useState(r?.pointsTable?.join(', ') ?? '')
  const [participation, setParticipation] = useState(String(r?.participationPoints ?? 1))
  const [bestTours, setBestTours] = useState(r?.bestTours ? String(r.bestTours) : '')
  const [toursPlanned, setToursPlanned] = useState(String(r?.toursPlanned ?? 6))
  const [missedRule, setMissedRule] = useState(r?.missedRule ?? 'last')
  const [minSize, setMinSize] = useState(String(r?.minDivisionSize ?? 4))
  const [windowFrom, setWindowFrom] = useState(r?.transferWindow?.from?.slice(0, 10) ?? '')
  const [windowTo, setWindowTo] = useState(r?.transferWindow?.to?.slice(0, 10) ?? '')
  const [confirmBy, setConfirmBy] = useState(r?.confirmBy?.slice(0, 10) ?? '')
  const [mode, setMode] = useState(initial?.payment.mode ?? 'season')
  const [seasonPrice, setSeasonPrice] = useState(initial?.payment.seasonPrice != null ? String(initial.payment.seasonPrice) : '')
  const [tourPrice, setTourPrice] = useState(initial?.payment.tourPrice != null ? String(initial.payment.tourPrice) : '')
  const [noShowWarn, setNoShowWarn] = useState(String(r?.noShowWarn ?? 2))
  const [freezeEnabled, setFreezeEnabled] = useState(r?.freezeEnabled ?? true)
  const [newcomer, setNewcomer] = useState(r?.newcomerPlacement ?? 'bottom')
  const [divisionSize, setDivisionSize] = useState(r?.divisionSize ? String(r.divisionSize) : '')
  const [matchPoints, setMatchPoints] = useState(r?.matchPoints ?? { win: 2, loss: 1, noShow: 0 })
  const [playoffMatches, setPlayoffMatches] = useState(r?.playoffMatches ?? false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const multi = format !== 'common_tour'
  const fixtures = format === 'season_rr' || format === 'free_dates'
  const names = (multi ? divisions : divisions.slice(0, 1)).map((x) => x.trim())
  const borders = names.slice(1).map((_, i) => boundaries[i] ?? { promote: 2, relegate: 2 })
  const setBorder = (i: number, key: 'promote' | 'relegate', v: string) => setBoundaries(borders.map((b, j) => (j === i ? { ...b, [key]: Number(v) } : b)))
  const pointsList = points.split(/[,\s]+/).filter(Boolean).map(Number)
  const check = () => {
    const i = t.leagues.issues
    if (name.trim().length < 2) return i.name
    if (!startsOn || !endsOn || endsOn < startsOn) return i['league.dates_invalid']
    if (names.some((x) => !x)) return i.divisions
    if (pointsList.some((x) => !Number.isInteger(x) || x < 0)) return i.points
    if (!windowFrom !== !windowTo || windowTo < windowFrom) return i['league.window_invalid']
    return ''
  }
  const submit = () => {
    const problem = check() ?? ''
    setError(problem)
    setSaved(false)
    if (problem) return
    const rules: Partial<Rules> = {
      toursPlanned: Number(toursPlanned),
      transferWindow: windowFrom ? { from: windowFrom, to: windowTo } : null,
      confirmBy: confirmBy || null,
      noShowWarn: Number(noShowWarn) || 2,
      freezeEnabled,
      newcomerPlacement: newcomer,
      divisionSize: divisionSize ? Number(divisionSize) : null,
    }
    if (!locked)
      Object.assign(rules, { boundaries: borders, pointsTable: pointsList, participationPoints: Number(participation), bestTours: bestTours ? Number(bestTours) : null, missedRule, minDivisionSize: Number(minSize), matchPoints, playoffMatches })
    const payment = { mode, ...(seasonPrice ? { seasonPrice: Number(seasonPrice) } : {}), ...(tourPrice ? { tourPrice: Number(tourPrice) } : {}) }
    onSubmit({ name: name.trim(), startsOn, endsOn, divisions: names, rules, payment })
      .then(() => setSaved(true))
      .catch((e: unknown) => setError(seasonError(e)))
  }
  return (
    <div className="form form--cols">
      <Field label={t.m.name}>
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label={t.leagues.toursPlanned}>
        <input type="number" min={1} max={52} value={toursPlanned} onChange={(e) => setToursPlanned(e.target.value)} />
      </Field>
      <Field label={t.leagues.startsOn}>
        <input type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
      </Field>
      <Field label={t.leagues.endsOn}>
        <input type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />
      </Field>
      {locked && <p className="note field--wide">{t.leagues.formatLocked}</p>}
      <fieldset className="field--wide stack" disabled={locked} style={{ border: 0, padding: 0, margin: 0 }}>
        <b>{t.leagues.divisionsTitle}</b>
        {names.map((_, i) => (
          <div key={i} className="stack">
            <div className="row">
              <input value={divisions[i]} onChange={(e) => setDivisions(divisions.map((x, j) => (j === i ? e.target.value : x)))} />
              {multi && names.length > 1 && (
                <button
                  type="button"
                  className="button button--sm button--danger"
                  onClick={() => {
                    setDivisions(divisions.filter((_, j) => j !== i))
                    setBoundaries(borders.filter((_, j) => j !== Math.max(0, i - 1)))
                  }}
                >
                  {t.leagues.removeDivision}
                </button>
              )}
            </div>
            {i < borders.length && (
              <div className="row small muted">
                <span>{t.leagues.border(names[i]!, names[i + 1]!)}</span>
                <label>
                  {t.leagues.promote}{' '}
                  <input type="number" min={0} max={10} style={{ width: 64 }} value={borders[i]!.promote} onChange={(e) => setBorder(i, 'promote', e.target.value)} />
                </label>
                <label>
                  {t.leagues.relegate}{' '}
                  <input type="number" min={0} max={10} style={{ width: 64 }} value={borders[i]!.relegate} onChange={(e) => setBorder(i, 'relegate', e.target.value)} />
                </label>
              </div>
            )}
          </div>
        ))}
        {multi && divisions.length < 12 && (
          <button type="button" className="button button--sm" onClick={() => setDivisions([...divisions, ''])}>
            {t.leagues.addDivision}
          </button>
        )}
      </fieldset>
      <Field label={t.leagues.pointsTable} wide>
        <input value={points} disabled={locked} placeholder={t.leagues.pointsAuto} onChange={(e) => setPoints(e.target.value)} />
      </Field>
      <Field label={t.leagues.participationPoints}>
        <input type="number" min={0} value={participation} disabled={locked} onChange={(e) => setParticipation(e.target.value)} />
      </Field>
      <Field label={t.leagues.bestToursField}>
        <input type="number" min={1} value={bestTours} disabled={locked} placeholder={t.leagues.allTours} onChange={(e) => setBestTours(e.target.value)} />
      </Field>
      <Field label={t.leagues.missedRule}>
        <select value={missedRule} disabled={locked} onChange={(e) => setMissedRule(e.target.value as NonNullable<Rules['missedRule']>)}>
          {Object.entries(t.leagues.missedRules).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </Field>
      <Field label={t.leagues.minDivisionSize}>
        <input type="number" min={2} value={minSize} disabled={locked} onChange={(e) => setMinSize(e.target.value)} />
      </Field>
      {fixtures && (
        <fieldset className="field--wide row" disabled={locked} style={{ border: 0, padding: 0, margin: 0 }}>
          <b>{t.leagues.matchPoints}</b>
          {(['win', 'loss', 'noShow'] as const).map((k) => (
            <label key={k} className="small">
              {t.leagues.matchPointKeys[k]}{' '}
              <input type="number" min={0} max={10} style={{ width: 64 }} value={matchPoints[k]} onChange={(e) => setMatchPoints({ ...matchPoints, [k]: Number(e.target.value) })} />
            </label>
          ))}
          <label className="small">
            <input type="checkbox" checked={playoffMatches} onChange={(e) => setPlayoffMatches(e.target.checked)} /> {t.leagues.playoffMatches}
          </label>
        </fieldset>
      )}
      <Field label={t.leagues.newcomerPlacement}>
        <select value={newcomer} onChange={(e) => setNewcomer(e.target.value as 'bottom' | 'rating')}>
          <option value="bottom">{t.leagues.newcomerBottom}</option>
          <option value="rating">{t.leagues.newcomerRating}</option>
        </select>
      </Field>
      <Field label={t.leagues.divisionSize}>
        <input type="number" min={2} value={divisionSize} placeholder="—" onChange={(e) => setDivisionSize(e.target.value)} />
      </Field>
      <Field label={t.leagues.noShowWarn}>
        <input type="number" min={1} max={20} value={noShowWarn} onChange={(e) => setNoShowWarn(e.target.value)} />
      </Field>
      <label className="small">
        <input type="checkbox" checked={freezeEnabled} onChange={(e) => setFreezeEnabled(e.target.checked)} /> {t.leagues.freezeEnabled}
      </label>
      <Field label={t.leagues.transferFrom}>
        <input type="date" value={windowFrom} onChange={(e) => setWindowFrom(e.target.value)} />
      </Field>
      <Field label={t.leagues.transferTo}>
        <input type="date" value={windowTo} onChange={(e) => setWindowTo(e.target.value)} />
      </Field>
      <Field label={t.leagues.confirmBy}>
        <input type="date" value={confirmBy} onChange={(e) => setConfirmBy(e.target.value)} />
      </Field>
      <Field label={`${t.leagues.payment} · ${t.leagues.payAtClub}`}>
        <select value={mode} onChange={(e) => setMode(e.target.value)}>
          {Object.entries(t.leagues.paymentModes).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </Field>
      {mode !== 'per_tour' && (
        <Field label={t.leagues.seasonPrice}>
          <input type="number" min={0} value={seasonPrice} onChange={(e) => setSeasonPrice(e.target.value)} />
        </Field>
      )}
      {mode !== 'season' && (
        <Field label={t.leagues.tourPrice}>
          <input type="number" min={0} value={tourPrice} onChange={(e) => setTourPrice(e.target.value)} />
        </Field>
      )}
      <button type="button" className="button button--primary field--wide" onClick={submit}>
        {submitLabel}
      </button>
      {saved && <p className="note note--ok field--wide">{t.leagues.saved}</p>}
      {error && <p className="note note--error field--wide">{error}</p>}
    </div>
  )
}

/** Division draft (L-13/L-15): drag players between division columns, save, then publish. */
function Draft({ s, onSave, onPublish }: { s: SeasonView; onSave: (manual: { participantId: number; divisionId: number }[]) => void; onPublish: () => void }) {
  const [moved, setMoved] = useState<Record<number, number>>({})
  const [drag, setDrag] = useState<number | null>(null)
  const divisionOf = (r: TableRow) => moved[r.participantId] ?? r.draftDivisionId ?? r.divisionId
  const changed = (r: TableRow) => divisionOf(r) !== r.divisionId
  return (
    <div className="stack">
      <p className="small muted">{t.leagues.dragHint}</p>
      {s.draftPending && (
        <div className="row">
          <span className="note">{t.leagues.draftPending}</span>
          <button className="button button--sm button--primary" onClick={onPublish}>
            {t.leagues.publishDraft}
          </button>
        </div>
      )}
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
              .filter((r) => divisionOf(r) === d.id && r.status !== 'waiting')
              .map((r) => (
                <span key={r.participantId} className="chip" draggable onDragStart={() => setDrag(r.participantId)} style={{ cursor: 'grab', outline: changed(r) ? '1px solid var(--holo)' : undefined }}>
                  {r.name} · {r.rating ?? '—'}
                  {changed(r) && r.draftReason ? ` · ${t.leagues.reasons[r.draftReason] ?? r.draftReason}` : ''}
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
  const [editing, setEditing] = useState(false)
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
  const overdue = s.fixtures.filter((f) => f.status !== 'confirmed' && f.deadlineAt && new Date(f.deadlineAt) < new Date())
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
          <button className="button button--sm" onClick={() => void (tourBased ? post(`${base}/status`, { status: 'finished' }) : post(`${base}/finish`))}>
            {t.leagues.finish}
          </button>
        )}
        {s.status === 'registration' && (
          <button className="button button--sm" onClick={() => void post(`${base}/expire`)}>
            {t.leagues.expire}
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
          onClick={async () => {
            const name = await ask.prompt(t.leagues.newSeason)
            if (name) void post(`${base}/next`, { name, startsOn: localDate(), endsOn: localDate(new Date(Date.now() + 120 * 86400000)), confirmBy: new Date(Date.now() + 7 * 86400000).toISOString() })
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
      {s.status !== 'finished' && (
        <button className="button button--sm" onClick={() => setEditing(!editing)}>
          {t.leagues.settings}
        </button>
      )}
      {editing && (
        <SeasonForm
          key={s.id}
          format={s.format}
          initial={s}
          locked={s.tours.length > 0}
          submitLabel={t.leagues.saveSettings}
          onSubmit={(p) => api(base, { method: 'PATCH', json: s.tours.length > 0 ? { ...p, divisions: undefined } : p }).then(reload)}
        />
      )}
      {overdue.length > 0 && (
        <div className="stack">
          <b>{t.leagues.overdue}</b>
          {overdue.map((f) => (
            <div key={f.id} className="row small">
              <span>
                {f.home.name} — {f.away.name}
              </span>
              {(['home', 'away', 'both'] as const).map((loser) => (
                <button key={loser} className="button button--sm" onClick={() => void post(`/leagues/fixtures/${f.id}/technical`, { loser })}>
                  {t.leagues.technical[loser]}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
      {(s.divisions.length > 1 || s.draftPending) && <Draft s={s} onSave={(manual) => void post(`${base}/distribute`, { manual })} onPublish={() => void post(`${base}/publish`)} />}
      <ul className="stack small">
        {s.table.map((r) => (
          <li key={r.participantId} className="row row--between">
            <span>
              {r.name}
              {r.status === 'waiting' && <span className="chip">{t.leagues.status.waiting}</span>}
              {r.noShows > 0 && <span className={`chip${r.noShows >= (s.rules.noShowWarn ?? 2) ? ' chip--warn' : ''}`}>{t.leagues.noShows(r.noShows)}</span>}
            </span>
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
  return (
    <Async state={data}>
      {(l) => (
        <div className="stack">
          {l.current && <SeasonAdmin s={l.current} hallId={hallId} reload={data.reload} />}
          {l.current && <SeasonTables s={l.current} />}
          <section className="panel stack">
            <h2>{t.leagues.newSeason}</h2>
            <SeasonForm format={l.format} submitLabel={t.leagues.newSeason} onSubmit={(p) => api(`/leagues/${l.id}/seasons`, { method: 'POST', json: p }).then(data.reload)} />
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
