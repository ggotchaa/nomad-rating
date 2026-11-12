// Tournament editor with the format constructor and live preview (T-1…T-4, F-1…F-5).

import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { utcToZoned, zonedToUtc } from '@nomad/shared'
import { api } from '../../api/client.ts'
import type { FormatOption, FormatPreview, Hall } from '../../api/types.ts'
import { useApi } from '../../app/hooks.ts'
import { errorText, t } from '../../i18n/index.ts'
import { formatDuration, localDate, parseHhmm, hhmm } from '../../i18n/format.ts'
import { Field } from '../../ui/kit.tsx'
import { MEETING_SCHEMES } from '../teams/Meeting.tsx'
import { ask } from '../../ui/dialogs.tsx'

type Stage =
  | { id: string; kind: 'groups'; name: string; groupSize: number; seeding: 'snake' | 'random' | 'manual'; separateClubs?: boolean }
  | { id: string; kind: 'round_robin'; name: string }
  | { id: string; kind: 'single_elim'; name: string; thirdPlace: 'match' | 'shared' }
  | { id: string; kind: 'all_places'; name: string }
type Rule = { by: 'places'; places: number[] } | { by: 'top'; count: number } | { by: 'all' } | { by: 'best_of_place'; place: number; count: number }
export type Format = {
  version: 1
  template: string
  stages: Stage[]
  transitions: { from: string; to: string; rule: Rule }[]
  placement: { stage: string; who: 'all' | 'not_advanced' }[]
  match: { winsNeeded: number; pointsToWin: number; gamePoints: 'none' | 'optional' | 'required' }
  groupPoints: { win: number; loss: number; walkover: number }
  tiebreaks: string[]
  restMinutes: number
}
type Settings = { scoreEntry?: 'staff' | 'players'; checkinWindowMinutes?: number; restMinutes?: number; sameDayRegistration?: boolean; requireCheckin?: boolean }
export type TournamentInput = {
  id?: number
  status?: string
  title?: string
  startsAt?: string
  maxParticipants?: number
  minParticipants?: number
  fee?: number
  description?: string
  restrictions?: { ratingMin?: number | null; ratingMax?: number | null; gender?: 'm' | 'f' | null; ageMin?: number | null; ageMax?: number | null }
  refundRules?: { hoursBefore: number; percent: number }[]
  settings?: Settings
  tableIds?: number[]
  seriesId?: number | null
  format?: Format
}

const KINDS = ['groups', 'round_robin', 'single_elim', 'all_places'] as const
const TIEBREAKS = ['h2h_points', 'h2h_sets_ratio', 'h2h_points_ratio', 'rating', 'lots']
const TZ = 'Asia/Almaty'

function newStage(kind: (typeof KINDS)[number], index: number): Stage {
  const id = `s${index + 1}`
  const name = t.ctor.kind[kind]!
  if (kind === 'groups') return { id, kind, name, groupSize: 4, seeding: 'snake', separateClubs: true }
  if (kind === 'single_elim') return { id, kind, name, thirdPlace: 'match' }
  return { id, kind, name }
}

/** Keeps transitions and final placement consistent after the stage list changed. */
function normalize(f: Format): Format {
  const ids = f.stages.map((s) => s.id)
  const transitions = f.transitions.filter((x) => ids.includes(x.from) && ids.includes(x.to) && ids.indexOf(x.to) > ids.indexOf(x.from))
  f.stages.forEach((s, i) => {
    if (i > 0 && !transitions.some((x) => x.to === s.id)) {
      const from = [...f.stages.slice(0, i)].reverse().find((p) => p.kind === 'groups' || p.kind === 'round_robin')
      if (from) transitions.push({ from: from.id, to: s.id, rule: { by: 'top', count: 8 } })
    }
  })
  const placement: Format['placement'] = [
    ...f.stages.filter((s) => s.kind === 'single_elim' || s.kind === 'all_places').map((s) => ({ stage: s.id, who: 'all' as const })),
    ...f.stages
      .filter((s) => (s.kind === 'groups' || s.kind === 'round_robin') && !transitions.some((x) => x.from === s.id && x.rule.by === 'all'))
      .map((s) => ({ stage: s.id, who: (transitions.some((x) => x.from === s.id) ? 'not_advanced' : 'all') as 'all' | 'not_advanced' })),
  ]
  return { ...f, template: 'custom', transitions, placement }
}

function FormatBuilder({ format, onChange }: { format: Format; onChange: (f: Format) => void }) {
  const set = (f: Partial<Format>) => onChange(normalize({ ...format, ...f }))
  const setStage = (i: number, patch: Partial<Stage>) => set({ stages: format.stages.map((s, k) => (k === i ? ({ ...s, ...patch } as Stage) : s)) })
  const setRule = (to: string, rule: Rule) => set({ transitions: format.transitions.map((x) => (x.to === to ? { ...x, rule } : x)) })
  return (
    <div className="stack ctor">
      {format.stages.map((s, i) => {
        const incoming = format.transitions.find((x) => x.to === s.id)
        return (
          <div className="ctor__stage" key={s.id}>
            <div className="row">
              <b>{i + 1}.</b>
              <select value={s.kind} onChange={(e) => set({ stages: format.stages.map((x, k) => (k === i ? { ...newStage(e.target.value as Stage['kind'], i), id: x.id } : x)) })}>
                {KINDS.map((k) => (
                  <option key={k} value={k}>
                    {t.ctor.kind[k]}
                  </option>
                ))}
              </select>
              <input value={s.name} onChange={(e) => setStage(i, { name: e.target.value })} aria-label={t.m.name} />
              {format.stages.length > 1 && (
                <button type="button" className="button button--sm" onClick={() => set({ stages: format.stages.filter((_, k) => k !== i) })}>
                  {t.ctor.remove}
                </button>
              )}
            </div>
            {s.kind === 'groups' && (
              <div className="row">
                <label className="small">
                  {t.ctor.groupSize}
                  <input type="number" min={3} max={8} value={s.groupSize} onChange={(e) => setStage(i, { groupSize: Number(e.target.value) })} />
                </label>
                <select value={s.seeding} onChange={(e) => setStage(i, { seeding: e.target.value as 'snake' })}>
                  {Object.entries(t.ctor.seeding).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
                <label className="small">
                  <input type="checkbox" checked={s.separateClubs !== false} onChange={(e) => setStage(i, { separateClubs: e.target.checked })} /> {t.ctor.separateClubs}
                </label>
              </div>
            )}
            {s.kind === 'single_elim' && (
              <select value={s.thirdPlace} onChange={(e) => setStage(i, { thirdPlace: e.target.value as 'match' })}>
                {Object.entries(t.ctor.thirdPlace).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            )}
            {incoming && (
              <div className="row small">
                <span className="muted">
                  {t.ctor.who} ({format.stages.find((x) => x.id === incoming.from)?.name}):
                </span>
                <select
                  value={incoming.rule.by}
                  onChange={(e) => {
                    const by = e.target.value
                    setRule(s.id, by === 'places' ? { by, places: [1, 2] } : by === 'all' ? { by } : by === 'best_of_place' ? { by, place: 3, count: 2 } : { by: 'top', count: 8 })
                  }}
                >
                  {Object.entries(t.ctor.rule).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
                {incoming.rule.by === 'places' && (
                  <input
                    aria-label={t.ctor.places}
                    defaultValue={incoming.rule.places.join(',')}
                    onBlur={(e) => setRule(s.id, { by: 'places', places: e.target.value.split(',').map((x) => Number(x.trim())).filter((n) => n > 0) })}
                  />
                )}
                {(incoming.rule.by === 'top' || incoming.rule.by === 'best_of_place') && (
                  <input type="number" min={1} max={128} aria-label={t.ctor.count} value={incoming.rule.count} onChange={(e) => setRule(s.id, { ...(incoming.rule as { by: 'top'; count: number }), count: Number(e.target.value) })} />
                )}
                {incoming.rule.by === 'best_of_place' && (
                  <input type="number" min={1} max={8} aria-label={t.ctor.place} value={incoming.rule.place} onChange={(e) => setRule(s.id, { ...(incoming.rule as { by: 'best_of_place'; place: number; count: number }), place: Number(e.target.value) })} />
                )}
              </div>
            )}
          </div>
        )
      })}
      <div className="row">
        {KINDS.map((k) => (
          <button key={k} type="button" className="button button--sm" onClick={() => set({ stages: [...format.stages, newStage(k, format.stages.length + Math.floor(Math.random() * 1000))] })}>
            + {t.ctor.kind[k]}
          </button>
        ))}
      </div>
      <h3>{t.ctor.tiebreaks}</h3>
      <ol className="small">
        {format.tiebreaks.map((tb, i) => (
          <li key={tb}>
            {t.ctor.tiebreak[tb]}{' '}
            {i > 0 && (
              <button type="button" className="button button--sm" onClick={() => set({ tiebreaks: format.tiebreaks.map((x, k) => (k === i - 1 ? tb : k === i ? format.tiebreaks[i - 1]! : x)) })}>
                {t.ctor.up}
              </button>
            )}
          </li>
        ))}
      </ol>
      {TIEBREAKS.filter((x) => !format.tiebreaks.includes(x)).map((x) => (
        <button key={x} type="button" className="button button--sm" onClick={() => set({ tiebreaks: [...format.tiebreaks, x] })}>
          + {t.ctor.tiebreak[x]}
        </button>
      ))}
    </div>
  )
}

export function TournamentForm({ clubId, hallId, initial, onSaved }: { clubId: number; hallId: number; initial?: TournamentInput; onSaved: (id: number) => void }) {
  const editing = initial?.id != null
  const formats = useApi<FormatOption[]>('/formats')
  const hall = useApi<Hall>(`/halls/${hallId}`)
  const series = useApi<{ id: number; name: string }[]>(`/clubs/${clubId}/series`)
  const [template, setTemplate] = useState(editing ? 'custom' : 'gs1')
  const [format, setFormat] = useState<Format | null>(initial?.format ?? null)
  const [max, setMax] = useState(initial?.maxParticipants ?? 16)
  const [tableIds, setTableIds] = useState<number[] | null>(initial?.tableIds ?? null)
  const [refund, setRefund] = useState(initial?.refundRules ?? [{ hoursBefore: 24, percent: 100 }])
  const [winsNeeded, setWinsNeeded] = useState(initial?.format?.match.winsNeeded ?? 3)
  const [gamePoints, setGamePoints] = useState(initial?.format?.match.gamePoints ?? 'optional')
  const [preview, setPreview] = useState<(FormatPreview & { format: Format }) | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const activeTables = hall.data?.tables.filter((x) => x.status === 'active') ?? []
  const tables = tableIds?.length ?? activeTables.length
  const effective = template === 'custom' && format ? { ...format, match: { ...format.match, winsNeeded, gamePoints } } : null

  useEffect(() => {
    if (!tables || max < 2) return
    let alive = true
    const id = setTimeout(() => {
      const body = effective ? { format: effective, players: max, tables } : { template, params: { match: { winsNeeded, gamePoints } }, players: max, tables }
      api<FormatPreview & { format: Format }>('/formats/preview', { method: 'POST', json: body })
        .then((p) => {
          if (!alive) return
          setPreview(p)
          setPreviewError(p.errors.length ? `${t.errors['format.invalid']} (${p.errors.join(', ')})` : null)
        })
        .catch((e: unknown) => alive && (setPreview(null), setPreviewError(errorText(e))))
    }, 300)
    return () => {
      alive = false
      clearTimeout(id)
    }
  }, [template, max, tables, JSON.stringify(effective), winsNeeded, gamePoints])

  const local = initial?.startsAt ? utcToZoned(new Date(initial.startsAt), TZ) : null
  const r = initial?.restrictions ?? {}
  const s = initial?.settings ?? {}

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const num = (k: string) => (f.get(k) ? Number(f.get(k)) : null)
    let seriesId = f.get('seriesId') ? Number(f.get('seriesId')) : null
    setBusy(true)
    setMessage(null)
    try {
      if (f.get('seriesId') === 'new') {
        const name = await ask.prompt(t.ctor.seriesName)
        seriesId = name ? (await api<{ id: number }>(`/clubs/${clubId}/series`, { method: 'POST', json: { name } })).id : null
        series.reload()
      }
      const type = String(f.get('type') ?? 'singles')
      const scheme = MEETING_SCHEMES[String(f.get('scheme') ?? 'wc') as keyof typeof MEETING_SCHEMES]
      const body = {
        ...(!editing && { type }),
        title: f.get('title'),
        startsAt: zonedToUtc(String(f.get('date')), parseHhmm(String(f.get('time'))), TZ).toISOString(),
        ...(effective ? { format: effective } : { template, templateParams: { match: { winsNeeded, gamePoints } } }),
        maxParticipants: max,
        minParticipants: num('minParticipants') ?? 4,
        ...(!editing || initial?.status === 'draft' ? { fee: Math.round(Number(f.get('fee') || 0) * 100) } : {}),
        restrictions: { ratingMin: num('ratingMin'), ratingMax: num('ratingMax'), gender: f.get('gender') || null, ageMin: num('ageMin'), ageMax: num('ageMax'), ratingSumMax: num('ratingSumMax') },
        description: f.get('description') ?? '',
        refundRules: refund,
        tableIds: tableIds ?? undefined,
        seriesId,
        settings: {
          scoreEntry: f.get('scoreEntry'),
          checkinWindowMinutes: num('checkinWindowMinutes') ?? 60,
          restMinutes: num('restMinutes') ?? 10,
          sameDayRegistration: f.get('sameDayRegistration') === 'on',
          requireCheckin: f.get('requireCheckin') === 'on',
          ...(!editing && type === 'team' && { meeting: { ...scheme, playAll: f.get('playAll') === 'on', tables: f.get('twoTables') === 'on' ? 2 : 1 } }),
        },
      }
      if (editing) {
        await api(`/tournaments/${initial.id}`, { method: 'PATCH', json: body })
        setMessage({ ok: true, text: t.ctor.saved })
        onSaved(initial.id!)
      } else {
        const created = await api<{ id: number }>(`/clubs/${clubId}/tournaments`, { method: 'POST', json: { hallId, ...body } })
        onSaved(created.id)
      }
    } catch (err) {
      setMessage({ ok: false, text: errorText(err) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid grid--2">
      <form className="panel form form--cols" onSubmit={(e) => void onSubmit(e)}>
        <h2 className="field--wide">{editing ? t.ctor.edit : t.m.newTournament}</h2>
        <Field label={t.m.name} wide>
          <input name="title" required minLength={3} maxLength={150} defaultValue={initial?.title} placeholder={t.misc.tournamentPlaceholder} />
        </Field>
        <Field label={t.m.date}>
          <input name="date" type="date" required defaultValue={local ? local.date : localDate(new Date(Date.now() + 7 * 86400000))} />
        </Field>
        <Field label={t.m.time}>
          <input name="time" type="time" required defaultValue={local ? hhmm(local.minutes) : '11:00'} />
        </Field>
        {!editing && (
          <>
            <Field label={t.teams.title}>
              <select name="type" defaultValue="singles">
                <option value="singles">{t.doubles.singles}</option>
                <option value="doubles">{t.teams.pair}</option>
                <option value="team">{t.teams.team}</option>
              </select>
            </Field>
            <Field label={t.meeting.title}>
              <select name="scheme" defaultValue="wc">
                {Object.values(MEETING_SCHEMES).map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
            </Field>
            <label className="check">
              <input type="checkbox" name="playAll" />
              {t.meeting.playAll}
            </label>
            <label className="check">
              <input type="checkbox" name="twoTables" />
              {t.meeting.tables(2)}
            </label>
            <Field label={t.teams.ratingSumMax}>
              <input name="ratingSumMax" type="number" min={0} />
            </Field>
          </>
        )}
        <Field label={t.ctor.template} wide>
          <select
            value={template}
            onChange={(e) => {
              if (e.target.value === 'custom' && preview) setFormat(normalize(preview.format))
              setTemplate(e.target.value)
            }}
          >
            {formats.data?.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
            <option value="custom">{t.ctor.custom}</option>
          </select>
        </Field>
        {template === 'custom' && format && (
          <div className="field--wide">
            <FormatBuilder format={format} onChange={setFormat} />
          </div>
        )}
        <Field label={t.ctor.winsNeeded}>
          <select value={winsNeeded} onChange={(e) => setWinsNeeded(Number(e.target.value))}>
            {[2, 3, 4].map((n) => (
              <option key={n} value={n}>
                {n} (bo{n * 2 - 1})
              </option>
            ))}
          </select>
        </Field>
        <Field label={t.ctor.gamePoints}>
          <select value={gamePoints} onChange={(e) => setGamePoints(e.target.value as 'optional')}>
            {Object.entries(t.ctor.gamePointsMode).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t.m.max}>
          <input type="number" min={4} max={256} value={max} onChange={(e) => setMax(Number(e.target.value))} required />
        </Field>
        <Field label={t.ctor.minParticipants}>
          <input name="minParticipants" type="number" min={2} max={256} defaultValue={initial?.minParticipants ?? 4} />
        </Field>
        <Field label={t.m.fee}>
          <input name="fee" type="number" min={0} step={100} defaultValue={initial?.fee != null ? initial.fee / 100 : 3000} disabled={editing && initial?.status !== 'draft'} />
        </Field>
        <Field label={t.ctor.series}>
          <select name="seriesId" defaultValue={initial?.seriesId ?? ''}>
            <option value="">{t.ctor.noSeries}</option>
            {series.data?.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
            <option value="new">{t.ctor.newSeries}</option>
          </select>
        </Field>
        <Field label={t.m.ratingFrom}>
          <input name="ratingMin" type="number" min={0} max={3000} defaultValue={r.ratingMin ?? ''} placeholder="—" />
        </Field>
        <Field label={t.m.ratingTo}>
          <input name="ratingMax" type="number" min={0} max={3000} defaultValue={r.ratingMax ?? ''} placeholder="—" />
        </Field>
        <Field label={t.ctor.gender}>
          <select name="gender" defaultValue={r.gender ?? ''}>
            <option value="">{t.ctor.genderAny}</option>
            <option value="m">{t.ctor.genderValue.m}</option>
            <option value="f">{t.ctor.genderValue.f}</option>
          </select>
        </Field>
        <Field label={t.ctor.ageFrom}>
          <input name="ageMin" type="number" min={5} max={100} defaultValue={r.ageMin ?? ''} placeholder="—" />
        </Field>
        <Field label={t.ctor.ageTo}>
          <input name="ageMax" type="number" min={5} max={100} defaultValue={r.ageMax ?? ''} placeholder="—" />
        </Field>
        <Field label={t.ctor.tables} wide>
          <div className="row">
            {activeTables.map((x) => {
              const on = tableIds ? tableIds.includes(x.id) : true
              return (
                <label key={x.id} className="small">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => {
                      const cur = tableIds ?? activeTables.map((y) => y.id)
                      setTableIds(on ? cur.filter((id) => id !== x.id) : [...cur, x.id])
                    }}
                  />{' '}
                  {x.number}
                </label>
              )
            })}
          </div>
        </Field>
        <fieldset className="field--wide">
          <legend>{t.ctor.settings}</legend>
          <div className="form form--cols">
            <Field label={t.ctor.scoreEntry}>
              <select name="scoreEntry" defaultValue={s.scoreEntry ?? 'staff'}>
                {Object.entries(t.ctor.scoreEntryMode).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t.ctor.checkinWindow}>
              <input name="checkinWindowMinutes" type="number" min={10} max={240} defaultValue={s.checkinWindowMinutes ?? 60} />
            </Field>
            <Field label={t.ctor.rest}>
              <input name="restMinutes" type="number" min={0} max={30} defaultValue={s.restMinutes ?? initial?.format?.restMinutes ?? 10} />
            </Field>
            <label className="small">
              <input name="sameDayRegistration" type="checkbox" defaultChecked={s.sameDayRegistration} /> {t.ctor.sameDay}
            </label>
            <label className="small">
              <input name="requireCheckin" type="checkbox" defaultChecked={s.requireCheckin} /> {t.ctor.requireCheckin}
            </label>
          </div>
        </fieldset>
        <fieldset className="field--wide">
          <legend>{t.ctor.refund}</legend>
          {refund.map((rule, i) => (
            <div className="row" key={i}>
              <input type="number" min={0} aria-label={t.ctor.refundHours} value={rule.hoursBefore} onChange={(e) => setRefund(refund.map((x, k) => (k === i ? { ...x, hoursBefore: Number(e.target.value) } : x)))} />
              <input type="number" min={0} max={100} aria-label={t.ctor.refundPercent} value={rule.percent} onChange={(e) => setRefund(refund.map((x, k) => (k === i ? { ...x, percent: Number(e.target.value) } : x)))} />
              <span className="small muted">{t.ctor.refundRule(rule.hoursBefore, rule.percent)}</span>
              <button type="button" className="button button--sm" onClick={() => setRefund(refund.filter((_, k) => k !== i))}>
                {t.ctor.remove}
              </button>
            </div>
          ))}
          <button type="button" className="button button--sm" onClick={() => setRefund([...refund, { hoursBefore: 0, percent: 0 }])}>
            +
          </button>
        </fieldset>
        <Field label={t.m.description} wide>
          <textarea name="description" maxLength={10000} defaultValue={initial?.description} />
        </Field>
        {message && <p className={`note field--wide ${message.ok ? 'note--ok' : 'note--error'}`}>{message.text}</p>}
        <button className="button button--primary field--wide" disabled={busy || Boolean(previewError)}>
          {editing ? t.ctor.save : t.m.create}
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
              {preview.estimate.stages.map((st, i) => (
                <div className="row row--between" key={st.id}>
                  <span>
                    {i + 1}. {st.name}
                    {st.groups ? ` · ${st.groups.join(' + ')}` : st.bracketSize ? ` · ${st.bracketSize}` : ''}
                  </span>
                  <span className="chip">
                    {st.matches} {t.t.matches}
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
