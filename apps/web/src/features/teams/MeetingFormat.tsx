// Team meeting format: the ready schemes plus a constructor for a club's own one —
// how many boys and girls play a meeting, how many wins it takes and who meets whom
// (A_boy_1 vs B_boy_1). Mirrors MeetingScheme / validateScheme of @nomad/engine, which
// validates the same thing again on the server.

import { t } from '../../i18n/index.ts'
import { Field } from '../../ui/kit.tsx'
import { MEETING_SCHEMES } from './Meeting.tsx'

export type SlotGender = 'm' | 'f'
export type MeetingGameSpec = { kind: 'singles' | 'doubles'; home: number[]; away: number[] }
export type MeetingScheme = {
  id: string
  name: string
  slots: number
  games: MeetingGameSpec[]
  firstTo: number
  playAll: boolean
  tables: 1 | 2
  slotGenders?: SlotGender[]
}

export const READY_SCHEMES = Object.values(MEETING_SCHEMES) as MeetingScheme[]

export const isCustomScheme = (s: MeetingScheme | null | undefined): boolean => Boolean(s && !(s.id in MEETING_SCHEMES))

/** A_boy_1 / B_girl_2, the names the organiser writes the order of games in. */
export function slotName(scheme: Pick<MeetingScheme, 'slotGenders'>, side: 'home' | 'away', slot: number): string {
  const team = side === 'home' ? 'A' : 'B'
  const genders = scheme.slotGenders
  if (!genders || slot >= genders.length) return `${team}_${slot + 1}`
  const kind = genders[slot] === 'f' ? 'girl' : 'boy'
  const n = genders.slice(0, slot + 1).filter((g) => g === genders[slot]).length
  return `${team}_${kind}_${n}`
}

export function validateScheme(scheme: MeetingScheme): string[] {
  const errors: string[] = []
  if (scheme.slots < 1 || scheme.slots > 8) errors.push('scheme.slots')
  if (!scheme.games.length) errors.push('scheme.no_games')
  if (scheme.firstTo < 1 || scheme.firstTo * 2 - 1 > scheme.games.length) errors.push('scheme.first_to')
  if (scheme.slotGenders && scheme.slotGenders.length !== scheme.slots) errors.push('scheme.slot_genders')
  scheme.games.forEach((g, i) => {
    const size = g.kind === 'singles' ? 1 : 2
    if (g.home.length !== size || g.away.length !== size) errors.push(`scheme.game_size:${i + 1}`)
    if ([...g.home, ...g.away].some((x) => !Number.isInteger(x) || x < 0 || x >= scheme.slots))
      errors.push(`scheme.slot:${i + 1}`)
    if (new Set(g.home).size !== g.home.length || new Set(g.away).size !== g.away.length)
      errors.push(`scheme.duplicate:${i + 1}`)
  })
  if (scheme.games.length && !errors.some((e) => e.startsWith('scheme.slot:'))) {
    const used = new Set(scheme.games.flatMap((g) => [...g.home, ...g.away]))
    for (let i = 0; i < scheme.slots; i++) if (!used.has(i)) errors.push(`scheme.slot_unused:${i + 1}`)
  }
  return errors
}

/** «scheme.slot:3» → «Игра 3: указан игрок, которого нет в составе». */
export function schemeErrorText(scheme: MeetingScheme, code: string): string {
  const [key = code, arg] = code.split(':')
  const text = t.meeting.schemeErr[key] ?? key
  if (!arg) return text[0]!.toUpperCase() + text.slice(1)
  if (key === 'scheme.slot_unused') return t.meeting.errSlot(slotName(scheme, 'home', Number(arg) - 1), text)
  return t.meeting.errGame(arg, text)
}

const genders = (boys: number, girls: number): SlotGender[] => [
  ...Array<SlotGender>(boys).fill('m'),
  ...Array<SlotGender>(girls).fill('f'),
]

export const countOf = (scheme: MeetingScheme, g: SlotGender): number =>
  (scheme.slotGenders ?? []).filter((x) => x === g).length

export function emptyCustomScheme(): MeetingScheme {
  const slotGenders = genders(3, 2)
  return {
    id: `custom-${Date.now().toString(36)}`,
    name: t.meeting.customNew,
    slots: slotGenders.length,
    slotGenders,
    // 3 boys, 2 girls, first to 3 — the example from the spec.
    games: [
      { kind: 'singles', home: [0], away: [0] },
      { kind: 'singles', home: [3], away: [3] },
      { kind: 'singles', home: [1], away: [1] },
      { kind: 'singles', home: [4], away: [4] },
      { kind: 'doubles', home: [3, 2], away: [3, 2] },
    ],
    firstTo: 3,
    playAll: false,
    tables: 1,
  }
}

function SlotPick({
  scheme,
  side,
  value,
  onChange,
}: {
  scheme: MeetingScheme
  side: 'home' | 'away'
  value: number
  onChange: (v: number) => void
}) {
  return (
    <select
      className="mono"
      aria-label={t.meeting.slotCol}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      style={{ width: 'auto' }}
    >
      {Array.from({ length: scheme.slots }, (_, i) => (
        <option key={i} value={i}>
          {slotName(scheme, side, i)}
        </option>
      ))}
      {value >= scheme.slots && <option value={value}>{`?_${value + 1}`}</option>}
    </select>
  )
}

/**
 * Editor of one custom scheme. The format is rejected (here and on the server) when the games
 * do not match the declared line-up — for example when a non-existent A_boy_4 is used.
 */
export function MeetingFormatBuilder({
  scheme,
  onChange,
}: {
  scheme: MeetingScheme
  onChange: (s: MeetingScheme) => void
}) {
  const boys = countOf(scheme, 'm')
  const girls = countOf(scheme, 'f')
  const errors = validateScheme(scheme)
  const set = (patch: Partial<MeetingScheme>) => onChange({ ...scheme, ...patch })
  const setCount = (g: SlotGender, n: number) => {
    const next = g === 'm' ? genders(n, girls) : genders(boys, n)
    set({ slotGenders: next, slots: next.length })
  }
  const setGame = (i: number, patch: Partial<MeetingGameSpec>) =>
    set({ games: scheme.games.map((g, k) => (k === i ? { ...g, ...patch } : g)) })
  const setKind = (i: number, kind: MeetingGameSpec['kind']) => {
    const g = scheme.games[i]!
    const grow = (side: number[]) =>
      kind === 'singles' ? side.slice(0, 1) : [side[0] ?? 0, side[1] ?? (side[0] === 1 ? 0 : 1)]
    setGame(i, { kind, home: grow(g.home), away: grow(g.away) })
  }

  return (
    <div className="stack">
      <div className="form form--cols">
        <Field label={t.meeting.schemeName} wide>
          <input value={scheme.name} maxLength={60} onChange={(e) => set({ name: e.target.value })} />
        </Field>
        <Field label={t.meeting.boys}>
          <input
            type="number"
            min={0}
            max={8}
            value={boys}
            onChange={(e) => setCount('m', Math.max(0, Math.min(8, Number(e.target.value))))}
          />
        </Field>
        <Field label={t.meeting.girls}>
          <input
            type="number"
            min={0}
            max={8}
            value={girls}
            onChange={(e) => setCount('f', Math.max(0, Math.min(8, Number(e.target.value))))}
          />
        </Field>
        <Field label={t.meeting.winsTo}>
          <input
            type="number"
            min={1}
            max={8}
            value={scheme.firstTo}
            onChange={(e) => set({ firstTo: Number(e.target.value) })}
          />
        </Field>
      </div>
      <p className="small muted">{t.meeting.summary(boys, girls, scheme.firstTo)}</p>
      <div className="row">
        <label className="switch">
          <input type="checkbox" checked={scheme.playAll} onChange={(e) => set({ playAll: e.target.checked })} />
          {t.meeting.playAll}
        </label>
        <label className="switch">
          <input
            type="checkbox"
            checked={scheme.tables === 2}
            onChange={(e) => set({ tables: e.target.checked ? 2 : 1 })}
          />
          {t.meeting.tables(2)}
        </label>
      </div>

      <h3>{t.meeting.order}</h3>
      <div className="tablewrap">
        <table className="table">
          <thead>
            <tr>
              <th>#</th>
              <th>{t.meeting.kind}</th>
              <th>{t.meeting.gameCol}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {scheme.games.map((g, i) => (
              <tr key={i}>
                <td className="rank">{i + 1}</td>
                <td>
                  <select
                    aria-label={t.meeting.kind}
                    value={g.kind}
                    onChange={(e) => setKind(i, e.target.value as MeetingGameSpec['kind'])}
                    style={{ width: 'auto' }}
                  >
                    <option value="singles">{t.meeting.singles}</option>
                    <option value="doubles">{t.meeting.doubles}</option>
                  </select>
                </td>
                <td>
                  <div className="row">
                    {g.home.map((s, k) => (
                      <SlotPick
                        key={`h${k}`}
                        scheme={scheme}
                        side="home"
                        value={s}
                        onChange={(v) => setGame(i, { home: g.home.map((x, j) => (j === k ? v : x)) })}
                      />
                    ))}
                    <span className="muted small">vs</span>
                    {g.away.map((s, k) => (
                      <SlotPick
                        key={`a${k}`}
                        scheme={scheme}
                        side="away"
                        value={s}
                        onChange={(v) => setGame(i, { away: g.away.map((x, j) => (j === k ? v : x)) })}
                      />
                    ))}
                  </div>
                </td>
                <td className="num">
                  <button
                    type="button"
                    className="button button--sm button--ghost"
                    aria-label={t.meeting.removeGame}
                    onClick={() => set({ games: scheme.games.filter((_, k) => k !== i) })}
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div>
        <button
          type="button"
          className="button button--sm"
          disabled={scheme.games.length >= 15}
          onClick={() => set({ games: [...scheme.games, { kind: 'singles', home: [0], away: [0] }] })}
        >
          {t.meeting.addGame}
        </button>
      </div>
      {errors.length > 0 && (
        <div className="note note--error stack">
          <b>{t.meeting.notSaved}</b>
          <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
            {errors.map((e) => (
              <li key={e}>{schemeErrorText(scheme, e)}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
