// Tournament editor (T-1…T-4, F-1…F-5): a four-step constructor — basics, tournament format,
// team meeting format, payment and the rest — with a live preview of matches and duration.

import { useEffect, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { utcToZoned, zonedToUtc } from '@nomad/shared'
import { api } from '../../api/client.ts'
import type { FormatOption, FormatPreview, Hall } from '../../api/types.ts'
import { useApi } from '../../app/hooks.ts'
import { errorText, t } from '../../i18n/index.ts'
import { formatDuration, localDate, parseHhmm, hhmm } from '../../i18n/format.ts'
import { Field } from '../../ui/kit.tsx'
import {
  MeetingFormatBuilder,
  READY_SCHEMES,
  emptyCustomScheme,
  isCustomScheme,
  slotName,
  validateScheme,
} from '../teams/MeetingFormat.tsx'
import type { MeetingScheme } from '../teams/MeetingFormat.tsx'
import { ask } from '../../ui/dialogs.tsx'

type Rules = { winsNeeded: number; pointsToWin: number; gamePoints: 'none' | 'optional' | 'required' }
type StageMatch = { match?: Partial<Rules>; rounds?: { semifinal?: Partial<Rules>; final?: Partial<Rules> } }
type Stage = StageMatch &
  (
    | {
        id: string
        kind: 'groups'
        name: string
        groupSize: number
        seeding: 'snake' | 'random' | 'manual'
        separateClubs?: boolean
      }
    | { id: string; kind: 'round_robin'; name: string }
    | { id: string; kind: 'single_elim'; name: string; thirdPlace: 'match' | 'shared' }
    | { id: string; kind: 'all_places'; name: string }
  )
type Rule =
  | { by: 'places'; places: number[] }
  | { by: 'top'; count: number }
  | { by: 'all' }
  | { by: 'best_of_place'; place: number; count: number }
export type Format = {
  version: 1
  template: string
  stages: Stage[]
  transitions: { from: string; to: string; rule: Rule }[]
  placement: { stage: string; who: 'all' | 'not_advanced' }[]
  match: Rules
  groupPoints: { win: number; loss: number; walkover: number }
  tiebreaks: string[]
  restMinutes: number
}
type Settings = {
  scoreEntry?: 'staff' | 'players'
  checkinWindowMinutes?: number
  restMinutes?: number
  sameDayRegistration?: boolean
  requireCheckin?: boolean
  waitlist?: boolean
  meeting?: MeetingScheme
}
export type TournamentInput = {
  id?: number
  status?: string
  type?: string
  template?: string
  title?: string
  startsAt?: string
  registrationClosesAt?: string | null
  maxParticipants?: number
  minParticipants?: number
  fee?: number
  description?: string
  restrictions?: {
    ratingMin?: number | null
    ratingMax?: number | null
    gender?: 'm' | 'f' | null
    ageMin?: number | null
    ageMax?: number | null
    ratingSumMax?: number | null
  }
  refundRules?: { hoursBefore: number; percent: number }[]
  settings?: Settings
  tableIds?: number[]
  seriesId?: number | null
  format?: Format
  ratingCoefficient?: number
}
type ClubTemplate = { id: number; name: string; format: Format }
type StepId = 'basics' | 'format' | 'meeting' | 'payment'

const KINDS = ['groups', 'round_robin', 'single_elim', 'all_places'] as const
const TIEBREAKS = ['h2h_points', 'h2h_sets_ratio', 'h2h_points_ratio', 'rating', 'lots']
const TZ = 'Asia/Almaty'
const CLOSE_HOURS = [0, 2, 6, 12, 24, 48, 72]

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
  const transitions = f.transitions.filter(
    (x) => ids.includes(x.from) && ids.includes(x.to) && ids.indexOf(x.to) > ids.indexOf(x.from),
  )
  f.stages.forEach((s, i) => {
    if (i > 0 && !transitions.some((x) => x.to === s.id)) {
      const from = [...f.stages.slice(0, i)].reverse().find((p) => p.kind === 'groups' || p.kind === 'round_robin')
      if (from) transitions.push({ from: from.id, to: s.id, rule: { by: 'top', count: 8 } })
    }
  })
  const placement: Format['placement'] = [
    ...f.stages
      .filter((s) => s.kind === 'single_elim' || s.kind === 'all_places')
      .map((s) => ({ stage: s.id, who: 'all' as const })),
    ...f.stages
      .filter(
        (s) =>
          (s.kind === 'groups' || s.kind === 'round_robin') &&
          !transitions.some((x) => x.from === s.id && x.rule.by === 'all'),
      )
      .map((s) => ({
        stage: s.id,
        who: (transitions.some((x) => x.from === s.id) ? 'not_advanced' : 'all') as 'all' | 'not_advanced',
      })),
  ]
  return { ...f, template: 'custom', transitions, placement }
}

/** Override select: empty value = inherit from the tournament setting. */
function Override({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string | number | undefined
  options: [string, string][]
  onChange: (v: string | undefined) => void
}) {
  return (
    <label className="small">
      {label}{' '}
      <select value={value ?? ''} onChange={(e) => onChange(e.target.value || undefined)}>
        <option value="">{t.ctor.inherit}</option>
        {options.map(([k, v]) => (
          <option key={k} value={k}>
            {v}
          </option>
        ))}
      </select>
    </label>
  )
}

const WINS: [string, string][] = [2, 3, 4].map((n) => [String(n), `${n} (bo${n * 2 - 1})`])

function StageMatchEditor({ stage, onChange }: { stage: Stage; onChange: (patch: StageMatch) => void }) {
  const bracket = stage.kind === 'single_elim' || stage.kind === 'all_places'
  const clean = (r: Partial<Rules>) => (Object.values(r).some((v) => v != null) ? r : undefined)
  const setMatch = (patch: Partial<Rules>) => onChange({ match: clean({ ...stage.match, ...patch }) })
  const setRound = (round: 'semifinal' | 'final', wins: string | undefined) =>
    onChange({ rounds: { ...stage.rounds, [round]: wins ? { winsNeeded: Number(wins) } : undefined } })
  return (
    <div className="row">
      <Override
        label={t.ctor.winsNeeded}
        value={stage.match?.winsNeeded}
        options={WINS}
        onChange={(v) => setMatch({ winsNeeded: v ? Number(v) : undefined })}
      />
      <Override
        label={t.ctor.gamePoints}
        value={stage.match?.gamePoints}
        options={Object.entries(t.ctor.gamePointsMode)}
        onChange={(v) => setMatch({ gamePoints: v as Rules['gamePoints'] | undefined })}
      />
      {bracket && (
        <Override
          label={t.ctor.semifinal}
          value={stage.rounds?.semifinal?.winsNeeded}
          options={WINS}
          onChange={(v) => setRound('semifinal', v)}
        />
      )}
      {bracket && (
        <Override
          label={t.ctor.final}
          value={stage.rounds?.final?.winsNeeded}
          options={WINS}
          onChange={(v) => setRound('final', v)}
        />
      )}
    </div>
  )
}

function FormatBuilder({ format, onChange }: { format: Format; onChange: (f: Format) => void }) {
  const set = (f: Partial<Format>) => onChange(normalize({ ...format, ...f }))
  const setStage = (i: number, patch: Partial<Stage>) =>
    set({ stages: format.stages.map((s, k) => (k === i ? ({ ...s, ...patch } as Stage) : s)) })
  const move = (i: number) =>
    set({
      stages: format.stages.map((s, k) => (k === i - 1 ? format.stages[i]! : k === i ? format.stages[i - 1]! : s)),
    })
  const gp = format.groupPoints
  const setRule = (to: string, rule: Rule) =>
    set({ transitions: format.transitions.map((x) => (x.to === to ? { ...x, rule } : x)) })
  return (
    <div className="stack ctor">
      {format.stages.map((s, i) => {
        const incoming = format.transitions.find((x) => x.to === s.id)
        return (
          <div className="ctor__stage" key={s.id}>
            <div className="row">
              <b>{i + 1}.</b>
              <select
                value={s.kind}
                onChange={(e) =>
                  set({
                    stages: format.stages.map((x, k) =>
                      k === i ? { ...newStage(e.target.value as Stage['kind'], i), id: x.id } : x,
                    ),
                  })
                }
                style={{ width: 'auto' }}
              >
                {KINDS.map((k) => (
                  <option key={k} value={k}>
                    {t.ctor.kind[k]}
                  </option>
                ))}
              </select>
              <input
                value={s.name}
                onChange={(e) => setStage(i, { name: e.target.value })}
                aria-label={t.m.name}
                style={{ width: 'auto', flex: '1 1 160px' }}
              />
              {i > 0 && (
                <button type="button" className="button button--sm" aria-label={t.ctor.moveUp} onClick={() => move(i)}>
                  {t.ctor.up}
                </button>
              )}
              {format.stages.length > 1 && (
                <button
                  type="button"
                  className="button button--sm"
                  onClick={() => set({ stages: format.stages.filter((_, k) => k !== i) })}
                >
                  {t.ctor.remove}
                </button>
              )}
            </div>
            {s.kind === 'groups' && (
              <div className="row">
                <label className="small">
                  {t.ctor.groupSize}
                  <input
                    type="number"
                    min={3}
                    max={8}
                    value={s.groupSize}
                    onChange={(e) => setStage(i, { groupSize: Number(e.target.value) })}
                  />
                </label>
                <select
                  value={s.seeding}
                  onChange={(e) => setStage(i, { seeding: e.target.value as 'snake' })}
                  style={{ width: 'auto' }}
                >
                  {Object.entries(t.ctor.seeding).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={s.separateClubs !== false}
                    onChange={(e) => setStage(i, { separateClubs: e.target.checked })}
                  />{' '}
                  {t.ctor.separateClubs}
                </label>
              </div>
            )}
            {s.kind === 'single_elim' && (
              <select
                value={s.thirdPlace}
                onChange={(e) => setStage(i, { thirdPlace: e.target.value as 'match' })}
                style={{ width: 'auto' }}
              >
                {Object.entries(t.ctor.thirdPlace).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            )}
            <StageMatchEditor stage={s} onChange={(patch) => setStage(i, patch)} />
            {incoming && (
              <div className="row small">
                <span className="muted">
                  {t.ctor.who} ({format.stages.find((x) => x.id === incoming.from)?.name}):
                </span>
                <select
                  value={incoming.rule.by}
                  style={{ width: 'auto' }}
                  onChange={(e) => {
                    const by = e.target.value
                    setRule(
                      s.id,
                      by === 'places'
                        ? { by, places: [1, 2] }
                        : by === 'all'
                          ? { by }
                          : by === 'best_of_place'
                            ? { by, place: 3, count: 2 }
                            : { by: 'top', count: 8 },
                    )
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
                    onBlur={(e) =>
                      setRule(s.id, {
                        by: 'places',
                        places: e.target.value
                          .split(',')
                          .map((x) => Number(x.trim()))
                          .filter((n) => n > 0),
                      })
                    }
                  />
                )}
                {(incoming.rule.by === 'top' || incoming.rule.by === 'best_of_place') && (
                  <input
                    type="number"
                    min={1}
                    max={128}
                    aria-label={t.ctor.count}
                    value={incoming.rule.count}
                    onChange={(e) =>
                      setRule(s.id, {
                        ...(incoming.rule as { by: 'top'; count: number }),
                        count: Number(e.target.value),
                      })
                    }
                  />
                )}
                {incoming.rule.by === 'best_of_place' && (
                  <input
                    type="number"
                    min={1}
                    max={8}
                    aria-label={t.ctor.place}
                    value={incoming.rule.place}
                    onChange={(e) =>
                      setRule(s.id, {
                        ...(incoming.rule as { by: 'best_of_place'; place: number; count: number }),
                        place: Number(e.target.value),
                      })
                    }
                  />
                )}
              </div>
            )}
          </div>
        )
      })}
      <div className="row">
        {KINDS.map((k) => (
          <button
            key={k}
            type="button"
            className="button button--sm"
            onClick={() =>
              set({ stages: [...format.stages, newStage(k, format.stages.length + Math.floor(Math.random() * 1000))] })
            }
          >
            + {t.ctor.kind[k]}
          </button>
        ))}
      </div>
      <h3>{t.ctor.groupPoints}</h3>
      <div className="row">
        {(['win', 'loss', 'walkover'] as const).map((k) => (
          <label className="small" key={k}>
            {t.ctor.groupPointsFor[k]}{' '}
            <input
              type="number"
              min={0}
              max={10}
              value={gp[k]}
              onChange={(e) => set({ groupPoints: { ...gp, [k]: Number(e.target.value) } })}
            />
          </label>
        ))}
      </div>
      <h3>{t.ctor.tiebreaks}</h3>
      <ol className="small">
        {format.tiebreaks.map((tb, i) => (
          <li key={tb}>
            {t.ctor.tiebreak[tb]}{' '}
            {i > 0 && (
              <button
                type="button"
                className="button button--sm"
                onClick={() =>
                  set({
                    tiebreaks: format.tiebreaks.map((x, k) =>
                      k === i - 1 ? tb : k === i ? format.tiebreaks[i - 1]! : x,
                    ),
                  })
                }
              >
                {t.ctor.up}
              </button>
            )}{' '}
            {format.tiebreaks.length > 1 && (
              <button
                type="button"
                className="button button--sm"
                onClick={() => set({ tiebreaks: format.tiebreaks.filter((x) => x !== tb) })}
              >
                {t.ctor.off}
              </button>
            )}
          </li>
        ))}
      </ol>
      <div className="row">
        {TIEBREAKS.filter((x) => !format.tiebreaks.includes(x)).map((x) => (
          <button
            key={x}
            type="button"
            className="button button--sm"
            onClick={() => set({ tiebreaks: [...format.tiebreaks, x] })}
          >
            + {t.ctor.tiebreak[x]}
          </button>
        ))}
      </div>
    </div>
  )
}

/** Rating / age limit: a switch for «not needed» and a from–to pair behind it. */
function LimitBlock({
  label,
  on,
  onToggle,
  children,
}: {
  label: string
  on: boolean
  onToggle: (v: boolean) => void
  children: ReactNode
}) {
  return (
    <fieldset className="field--wide">
      <legend>{label}</legend>
      <div className="stack">
        <label className="switch">
          <input type="checkbox" checked={!on} onChange={(e) => onToggle(!e.target.checked)} />
          {t.wiz.noLimit}
        </label>
        {on && <div className="form form--cols">{children}</div>}
      </div>
    </fieldset>
  )
}

export function TournamentForm({
  clubId,
  hallId,
  initial,
  onSaved,
}: {
  clubId: number
  hallId: number
  initial?: TournamentInput
  onSaved: (id: number) => void
}) {
  const editing = initial?.id != null
  const formRef = useRef<HTMLFormElement>(null)
  const formats = useApi<FormatOption[]>('/formats')
  const hall = useApi<Hall>(`/halls/${hallId}`)
  const series = useApi<{ id: number; name: string }[]>(`/clubs/${clubId}/series`)
  const [step, setStep] = useState<StepId>('basics')
  const [type, setType] = useState(initial?.type ?? 'singles')
  const [template, setTemplate] = useState(editing ? 'custom' : (initial?.template ?? 'gs1'))
  const [format, setFormat] = useState<Format | null>(initial?.format ?? null)
  const [max, setMax] = useState(initial?.maxParticipants ?? 16)
  const [tableIds, setTableIds] = useState<number[] | null>(initial?.tableIds ?? null)
  const [refund, setRefund] = useState(initial?.refundRules ?? [{ hoursBefore: 24, percent: 100 }])
  const [winsNeeded, setWinsNeeded] = useState(initial?.format?.match.winsNeeded ?? 3)
  const [gamePoints, setGamePoints] = useState(initial?.format?.match.gamePoints ?? 'optional')
  const [pointsToWin, setPointsToWin] = useState(initial?.format?.match.pointsToWin ?? 11)
  const [scheme, setScheme] = useState<MeetingScheme>(initial?.settings?.meeting ?? READY_SCHEMES[0]!)
  const [waitlist, setWaitlist] = useState(initial?.settings?.waitlist !== false)
  const r0 = initial?.restrictions ?? {}
  const [ratingLimit, setRatingLimit] = useState(r0.ratingMin != null || r0.ratingMax != null)
  const [ageLimit, setAgeLimit] = useState(r0.ageMin != null || r0.ageMax != null)
  const [closeHours, setCloseHours] = useState(() => {
    if (!initial?.startsAt || !initial.registrationClosesAt) return 0
    const diff = Math.round(
      (new Date(initial.startsAt).getTime() - new Date(initial.registrationClosesAt).getTime()) / 3600000,
    )
    return CLOSE_HOURS.includes(diff) ? diff : 0
  })
  const clubTemplates = useApi<ClubTemplate[]>(`/clubs/${clubId}/format-templates`)
  const [preview, setPreview] = useState<(FormatPreview & { format: Format }) | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const activeTables = hall.data?.tables.filter((x) => x.status === 'active') ?? []
  const tables = tableIds?.length ?? activeTables.length
  const effective =
    template === 'custom' && format
      ? { ...format, match: { ...format.match, winsNeeded, gamePoints, pointsToWin } }
      : null
  const matchParams = { winsNeeded, gamePoints, pointsToWin }
  const schemeErrors = type === 'team' ? validateScheme(scheme) : []
  const steps: StepId[] = type === 'team' ? ['basics', 'format', 'meeting', 'payment'] : ['basics', 'format', 'payment']
  // Switching away from a team tournament removes the meeting step under our feet.
  const current = steps.includes(step) ? step : 'basics'

  const applyTemplate = (tpl: ClubTemplate) => {
    setFormat(normalize(tpl.format))
    setWinsNeeded(tpl.format.match.winsNeeded)
    setGamePoints(tpl.format.match.gamePoints)
    setPointsToWin(tpl.format.match.pointsToWin)
    setTemplate('custom')
  }
  useEffect(() => {
    if (!template.startsWith('club:') || !clubTemplates.data) return
    const tpl = clubTemplates.data.find((x) => `club:${x.id}` === template)
    if (tpl) applyTemplate(tpl)
    else setTemplate('gs1')
  }, [template, clubTemplates.data])

  const pickTemplate = (value: string) => {
    if (value === 'custom' && preview) setFormat(normalize(preview.format))
    setTemplate(value)
    if (value === 'custom') setStep('format')
  }

  const saveTemplate = async () => {
    if (!effective) return
    const name = await ask.prompt(t.ctor.templateName)
    if (!name) return
    try {
      await api(`/clubs/${clubId}/format-templates`, { method: 'POST', json: { name, format: effective } })
      clubTemplates.reload()
      setMessage({ ok: true, text: t.ctor.templateSaved })
    } catch (err) {
      setMessage({ ok: false, text: errorText(err) })
    }
  }
  const deleteTemplate = async (tpl: ClubTemplate) => {
    if (!(await ask.confirm(t.ctor.templateDelete(tpl.name)))) return
    await api(`/clubs/${clubId}/format-templates/${tpl.id}`, { method: 'DELETE' }).catch((err: unknown) =>
      setMessage({ ok: false, text: errorText(err) }),
    )
    clubTemplates.reload()
  }

  useEffect(() => {
    if (!tables || max < 2) return
    let alive = true
    const id = setTimeout(() => {
      if (template.startsWith('club:')) return
      const body = effective
        ? { format: effective, players: max, tables }
        : { template, params: { match: matchParams }, players: max, tables }
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
  }, [template, max, tables, JSON.stringify(effective), winsNeeded, gamePoints, pointsToWin])

  const local = initial?.startsAt ? utcToZoned(new Date(initial.startsAt), TZ) : null
  const r = r0
  const s = initial?.settings ?? {}

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const form = e.currentTarget
    // Steps stay mounted but hidden, so an invalid field can live on another tab — open it first.
    if (!form.checkValidity()) {
      const bad = form.querySelector(':invalid')
      const owner = bad?.closest('[data-step]')?.getAttribute('data-step') as StepId | undefined
      if (owner) setStep(owner)
      requestAnimationFrame(() => form.reportValidity())
      return
    }
    if (type === 'team' && schemeErrors.length) {
      setStep('meeting')
      setMessage({ ok: false, text: t.meeting.notSaved })
      return
    }
    const f = new FormData(form)
    const num = (k: string) => (f.get(k) ? Number(f.get(k)) : null)
    let seriesId = f.get('seriesId') ? Number(f.get('seriesId')) : null
    setBusy(true)
    setMessage(null)
    try {
      if (f.get('seriesId') === 'new') {
        const name = await ask.prompt(t.ctor.seriesName)
        seriesId = name
          ? (await api<{ id: number }>(`/clubs/${clubId}/series`, { method: 'POST', json: { name } })).id
          : null
        series.reload()
      }
      const startsAt = zonedToUtc(String(f.get('date')), parseHhmm(String(f.get('time'))), TZ)
      const body = {
        ...(!editing && { type }),
        title: f.get('title'),
        startsAt: startsAt.toISOString(),
        registrationClosesAt: new Date(startsAt.getTime() - closeHours * 3600000).toISOString(),
        ...(effective ? { format: effective } : { template, templateParams: { match: matchParams } }),
        ratingCoefficient: Number(f.get('ratingCoefficient') || 1),
        maxParticipants: max,
        minParticipants: num('minParticipants') ?? 4,
        ...(!editing || initial?.status === 'draft' ? { fee: Math.round(Number(f.get('fee') || 0) * 100) } : {}),
        restrictions: {
          ratingMin: ratingLimit ? num('ratingMin') : null,
          ratingMax: ratingLimit ? num('ratingMax') : null,
          gender: f.get('gender') || null,
          ageMin: ageLimit ? num('ageMin') : null,
          ageMax: ageLimit ? num('ageMax') : null,
          ratingSumMax: num('ratingSumMax'),
        },
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
          waitlist,
          ...(type === 'team' && { meeting: scheme }),
        },
      }
      if (editing) {
        await api(`/tournaments/${initial.id}`, { method: 'PATCH', json: body })
        setMessage({ ok: true, text: t.ctor.saved })
        onSaved(initial.id!)
      } else {
        const created = await api<{ id: number }>(`/clubs/${clubId}/tournaments`, {
          method: 'POST',
          json: { hallId, ...body },
        })
        onSaved(created.id)
      }
    } catch (err) {
      setMessage({ ok: false, text: errorText(err) })
    } finally {
      setBusy(false)
    }
  }

  const templateSelect = (
    <select value={template} onChange={(e) => pickTemplate(e.target.value)}>
      {clubTemplates.data?.length ? (
        <optgroup label={t.ctor.clubTemplates}>
          {clubTemplates.data.map((x) => (
            <option key={x.id} value={`club:${x.id}`}>
              {x.name}
            </option>
          ))}
        </optgroup>
      ) : null}
      <optgroup label={t.ctor.template}>
        {formats.data?.map((f) => (
          <option key={f.id} value={f.id}>
            {f.name}
          </option>
        ))}
      </optgroup>
      <optgroup label="——">
        <option value="custom">⚙ {t.ctor.custom}</option>
      </optgroup>
    </select>
  )

  return (
    <div className="grid grid--2">
      <form ref={formRef} className="panel" noValidate onSubmit={(e) => void onSubmit(e)}>
        <h2>{editing ? t.ctor.edit : t.m.newTournament}</h2>
        <div className="steps" role="tablist">
          {steps.map((id, i) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-current={current === id ? 'step' : undefined}
              className={id === 'meeting' && schemeErrors.length ? 'is-invalid' : undefined}
              onClick={() => setStep(id)}
            >
              <i>{i + 1}</i>
              <span>
                {t.wiz.steps[id]}
                <br />
                <span className="small muted">{t.wiz.hint[id]}</span>
              </span>
            </button>
          ))}
        </div>

        {/* 1 — basics */}
        <div className="tabpanel" data-step="basics" hidden={current !== 'basics'}>
          <div className="form form--cols">
            <Field label={t.m.name} wide>
              <input
                name="title"
                required
                minLength={3}
                maxLength={150}
                defaultValue={initial?.title}
                placeholder={t.misc.tournamentPlaceholder}
              />
            </Field>
            <Field label={t.m.date}>
              <input
                name="date"
                type="date"
                required
                defaultValue={local ? local.date : localDate(new Date(Date.now() + 7 * 86400000))}
              />
            </Field>
            <Field label={t.m.time}>
              <input name="time" type="time" required defaultValue={local ? hhmm(local.minutes) : '11:00'} />
            </Field>
            <Field label={t.wiz.kind}>
              {editing ? (
                <input
                  value={type === 'team' ? t.teams.team : type === 'doubles' ? t.teams.pair : t.doubles.singles}
                  readOnly
                  disabled
                />
              ) : (
                <select value={type} onChange={(e) => setType(e.target.value)}>
                  <option value="singles">{t.doubles.singles}</option>
                  <option value="doubles">{t.teams.pair}</option>
                  <option value="team">{t.teams.team}</option>
                </select>
              )}
            </Field>
            <Field label={t.ctor.template} wide>
              {templateSelect}
              {template === 'custom' && (
                <span className="hint">
                  {t.wiz.customHint}{' '}
                  <button type="button" className="linkbtn small" onClick={() => setStep('format')}>
                    {t.wiz.toFormat}
                  </button>
                </span>
              )}
            </Field>
            <Field label={t.m.max}>
              <input
                type="number"
                min={4}
                max={256}
                value={max}
                onChange={(e) => setMax(Number(e.target.value))}
                required
              />
            </Field>
            <Field label={t.ctor.minParticipants}>
              <input
                name="minParticipants"
                type="number"
                min={2}
                max={256}
                defaultValue={initial?.minParticipants ?? 4}
              />
            </Field>
            <Field label={t.ctor.gender}>
              <select name="gender" defaultValue={r.gender ?? ''}>
                <option value="">{t.ctor.genderAny}</option>
                <option value="m">{t.ctor.genderValue.m}</option>
                <option value="f">{t.ctor.genderValue.f}</option>
              </select>
            </Field>
            {type !== 'singles' && (
              <Field label={t.teams.ratingSumMax}>
                <input name="ratingSumMax" type="number" min={0} defaultValue={r.ratingSumMax ?? ''} placeholder="—" />
              </Field>
            )}
            <LimitBlock label={t.wiz.ratingLimit} on={ratingLimit} onToggle={setRatingLimit}>
              <Field label={t.m.ratingFrom}>
                <input
                  name="ratingMin"
                  type="number"
                  min={0}
                  max={3000}
                  defaultValue={r.ratingMin ?? ''}
                  placeholder="—"
                />
              </Field>
              <Field label={t.m.ratingTo}>
                <input
                  name="ratingMax"
                  type="number"
                  min={0}
                  max={3000}
                  defaultValue={r.ratingMax ?? ''}
                  placeholder="—"
                />
              </Field>
            </LimitBlock>
            <LimitBlock label={t.wiz.ageLimit} on={ageLimit} onToggle={setAgeLimit}>
              <Field label={t.ctor.ageFrom}>
                <input name="ageMin" type="number" min={5} max={100} defaultValue={r.ageMin ?? ''} placeholder="—" />
              </Field>
              <Field label={t.ctor.ageTo}>
                <input name="ageMax" type="number" min={5} max={100} defaultValue={r.ageMax ?? ''} placeholder="—" />
              </Field>
            </LimitBlock>
            <Field label={t.m.description} wide>
              <textarea name="description" maxLength={10000} defaultValue={initial?.description} />
            </Field>
          </div>
        </div>

        {/* 2 — tournament format */}
        <div className="tabpanel" data-step="format" hidden={current !== 'format'}>
          <div className="form form--cols">
            <Field label={t.ctor.template} wide>
              {templateSelect}
            </Field>
            {clubTemplates.data?.length ? (
              <div className="field--wide row small">
                <span className="muted">{t.ctor.clubTemplates}:</span>
                {clubTemplates.data.map((x) => (
                  <span key={x.id} className="chip">
                    {x.name}{' '}
                    <button
                      type="button"
                      className="linkbtn"
                      aria-label={t.ctor.templateDelete(x.name)}
                      onClick={() => void deleteTemplate(x)}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            ) : null}
            {template === 'custom' && format && (
              <div className="field--wide stack">
                <FormatBuilder format={format} onChange={setFormat} />
                <div>
                  <button
                    type="button"
                    className="button button--sm"
                    disabled={Boolean(previewError)}
                    onClick={() => void saveTemplate()}
                  >
                    {t.ctor.saveTemplate}
                  </button>
                </div>
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
            <Field label={t.ctor.pointsToWin}>
              <input
                type="number"
                min={5}
                max={21}
                value={pointsToWin}
                onChange={(e) => setPointsToWin(Number(e.target.value))}
              />
            </Field>
            <Field label={t.ctor.ratingCoefficient}>
              <input
                name="ratingCoefficient"
                type="number"
                min={0.5}
                max={2}
                step={0.05}
                defaultValue={initial?.ratingCoefficient ?? 1}
              />
            </Field>
            <Field label={t.ctor.rest}>
              <input
                name="restMinutes"
                type="number"
                min={0}
                max={30}
                defaultValue={s.restMinutes ?? initial?.format?.restMinutes ?? 10}
              />
            </Field>
            <fieldset className="field--wide">
              <legend>{t.wiz.tablesHint}</legend>
              <div className="row">
                {activeTables.map((x) => {
                  const on = tableIds ? tableIds.includes(x.id) : true
                  return (
                    <label key={x.id} className="check check--pill">
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => {
                          const cur = tableIds ?? activeTables.map((y) => y.id)
                          setTableIds(on ? cur.filter((id) => id !== x.id) : [...cur, x.id])
                        }}
                      />
                      {x.number}
                    </label>
                  )
                })}
              </div>
            </fieldset>
          </div>
        </div>

        {/* 3 — team meeting format */}
        {type === 'team' && (
          <div className="tabpanel" data-step="meeting" hidden={current !== 'meeting'}>
            <Field label={t.meeting.ready} wide>
              <select
                value={isCustomScheme(scheme) ? 'custom' : scheme.id}
                onChange={(e) =>
                  setScheme(
                    e.target.value === 'custom'
                      ? emptyCustomScheme()
                      : READY_SCHEMES.find((x) => x.id === e.target.value)!,
                  )
                }
              >
                {READY_SCHEMES.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
                <optgroup label="——">
                  <option value="custom">⚙ {t.meeting.custom}</option>
                </optgroup>
              </select>
            </Field>
            {isCustomScheme(scheme) ? (
              <MeetingFormatBuilder scheme={scheme} onChange={setScheme} />
            ) : (
              <p className="note">
                {scheme.name} · {t.meeting.firstTo(scheme.firstTo)} · {scheme.games.length}{' '}
                {t.meeting.order.toLowerCase()}
              </p>
            )}
          </div>
        )}

        {/* 4 — payment and the rest */}
        <div className="tabpanel" data-step="payment" hidden={current !== 'payment'}>
          <p className="note note--info">{t.wiz.fromClub}</p>
          <div className="form form--cols">
            <Field label={t.m.fee}>
              <input
                name="fee"
                type="number"
                min={0}
                step={100}
                defaultValue={initial?.fee != null ? initial.fee / 100 : 3000}
                disabled={editing && initial?.status !== 'draft'}
              />
            </Field>
            <Field label={t.wiz.regCloses}>
              <select value={closeHours} onChange={(e) => setCloseHours(Number(e.target.value))}>
                {CLOSE_HOURS.map((h) => (
                  <option key={h} value={h}>
                    {h === 0 ? t.wiz.regClosesAtStart : t.wiz.regClosesHours(h)}
                  </option>
                ))}
              </select>
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
            <div className="field--wide stack">
              <label className="switch">
                <input type="checkbox" checked={waitlist} onChange={(e) => setWaitlist(e.target.checked)} />
                {t.wiz.waitlist}
              </label>
              <span className="hint">{t.wiz.waitlistHint}</span>
            </div>
            <fieldset className="field--wide">
              <legend>{t.ctor.refund}</legend>
              <div className="stack">
                {refund.map((rule, i) => (
                  <div className="row" key={i}>
                    <input
                      type="number"
                      min={0}
                      style={{ width: '7em' }}
                      aria-label={t.ctor.refundHours}
                      value={rule.hoursBefore}
                      onChange={(e) =>
                        setRefund(refund.map((x, k) => (k === i ? { ...x, hoursBefore: Number(e.target.value) } : x)))
                      }
                    />
                    <input
                      type="number"
                      min={0}
                      max={100}
                      style={{ width: '7em' }}
                      aria-label={t.ctor.refundPercent}
                      value={rule.percent}
                      onChange={(e) =>
                        setRefund(refund.map((x, k) => (k === i ? { ...x, percent: Number(e.target.value) } : x)))
                      }
                    />
                    <span className="small muted">{t.ctor.refundRule(rule.hoursBefore, rule.percent)}</span>
                    <button
                      type="button"
                      className="button button--sm button--ghost"
                      onClick={() => setRefund(refund.filter((_, k) => k !== i))}
                    >
                      {t.ctor.remove}
                    </button>
                  </div>
                ))}
                <div>
                  <button
                    type="button"
                    className="button button--sm"
                    onClick={() => setRefund([...refund, { hoursBefore: 0, percent: 0 }])}
                  >
                    +
                  </button>
                </div>
              </div>
            </fieldset>
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
                  <input
                    name="checkinWindowMinutes"
                    type="number"
                    min={10}
                    max={240}
                    defaultValue={s.checkinWindowMinutes ?? 60}
                  />
                </Field>
                <label className="switch field--wide">
                  <input name="sameDayRegistration" type="checkbox" defaultChecked={s.sameDayRegistration} />{' '}
                  {t.ctor.sameDay}
                </label>
                <label className="switch field--wide">
                  <input name="requireCheckin" type="checkbox" defaultChecked={s.requireCheckin} />{' '}
                  {t.ctor.requireCheckin}
                </label>
              </div>
            </fieldset>
          </div>
        </div>

        {message && <p className={`note ${message.ok ? 'note--ok' : 'note--error'}`}>{message.text}</p>}
        <div className="formbar">
          <button
            type="button"
            className="button"
            disabled={steps.indexOf(current) === 0}
            onClick={() => setStep(steps[steps.indexOf(current) - 1]!)}
          >
            ← {t.wiz.back}
          </button>
          {steps.indexOf(current) < steps.length - 1 ? (
            <button type="button" className="button" onClick={() => setStep(steps[steps.indexOf(current) + 1]!)}>
              {t.wiz.next} →
            </button>
          ) : null}
          <span className="spacer" />
          <button className="button button--primary" disabled={busy || Boolean(previewError)}>
            {editing ? t.ctor.save : t.m.create}
          </button>
        </div>
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
            <div className="tiles">
              <div className="tile">
                <span>{t.t.matches}</span>
                <b>{preview.estimate.totalMatches}</b>
              </div>
              <div className="tile">
                <span>{t.t.duration}</span>
                <b>{formatDuration(preview.estimate.minutes)}</b>
              </div>
            </div>
          </>
        )}
        {type === 'team' && (
          <div className="stack">
            <h3>{t.wiz.steps.meeting}</h3>
            <p className="small muted">{scheme.name}</p>
            <ol className="small stack">
              {scheme.games.map((g, i) => (
                <li key={i} className="mono">
                  {g.home.map((x) => slotName(scheme, 'home', x)).join(' + ')} —{' '}
                  {g.away.map((x) => slotName(scheme, 'away', x)).join(' + ')}
                </li>
              ))}
            </ol>
          </div>
        )}
      </aside>
    </div>
  )
}
