import { useState } from 'react'
import { api } from '../../api/client.ts'
import type { BookingSettings, HallTable } from '../../api/types.ts'
import { useApi } from '../../app/hooks.ts'
import { errorText, t } from '../../i18n/index.ts'
import { formatDate, formatTime, hhmm, localDate, parseHhmm } from '../../i18n/format.ts'
import { Async, Field } from '../../ui/kit.tsx'

type Tariff = BookingSettings['tariffs'][number]
type Recurring = { id: number; kind: string; tableIds: number[]; weekdays: number[]; startMinutes: number; endMinutes: number; validFrom: string; validUntil: string | null; note: string }
type OneOff = { id: number; kind: string; tableIds: number[]; start: string; end: string; note: string; tournamentId: number | null }
type RulesView = { timezone: string; recurring: Recurring[]; blocks: OneOff[] }

function Days({ value, onChange }: { value: number[]; onChange: (v: number[]) => void }) {
  return (
    <div className="row" role="group">
      {t.bset.weekdays.map((d, i) => (
        <button key={d} type="button" className={`button button--sm${value.includes(i + 1) ? ' button--primary' : ''}`} aria-pressed={value.includes(i + 1)} onClick={() => onChange(value.includes(i + 1) ? value.filter((x) => x !== i + 1) : [...value, i + 1].sort())}>
          {d}
        </button>
      ))}
    </div>
  )
}

/** Time-of-day / weekday prices (B-9). Prices are edited in tenge and stored in tiyn. */
export function TariffsEditor({ tariffs, onChange }: { tariffs: Tariff[]; onChange: (v: Tariff[]) => void }) {
  const set = (i: number, patch: Partial<Tariff>) => onChange(tariffs.map((x, j) => (j === i ? { ...x, ...patch } : x)))
  return (
    <div className="stack">
      <h3>{t.bset.tariffs}</h3>
      <p className="small muted">{t.bset.tariffsHint}</p>
      {tariffs.map((x, i) => (
        <div key={i} className="stack panel">
          <div className="form form--cols">
            <Field label={t.bset.tariffName}>
              <input value={x.name} maxLength={40} onChange={(e) => set(i, { name: e.target.value })} />
            </Field>
            <Field label={t.bset.price}>
              <input type="number" min={0} step={100} value={x.pricePerHour / 100} onChange={(e) => set(i, { pricePerHour: Math.round(Number(e.target.value) * 100) })} />
            </Field>
            <Field label={t.bset.from}>
              <input type="time" value={hhmm(x.from)} onChange={(e) => set(i, { from: parseHhmm(e.target.value) })} />
            </Field>
            <Field label={t.bset.to}>
              <input type="time" value={hhmm(x.to % 1440)} onChange={(e) => set(i, { to: parseHhmm(e.target.value) || 1440 })} />
            </Field>
          </div>
          <div className="row row--between">
            <Days value={x.days} onChange={(days) => set(i, { days })} />
            <button type="button" className="button button--sm button--danger" onClick={() => onChange(tariffs.filter((_, j) => j !== i))}>
              ×
            </button>
          </div>
        </div>
      ))}
      <div>
        <button type="button" className="button button--sm" onClick={() => onChange([...tariffs, { name: '', days: [1, 2, 3, 4, 5], from: 18 * 60, to: 23 * 60, pricePerHour: 300000 }])}>
          + {t.bset.addTariff}
        </button>
      </div>
    </div>
  )
}

function TablePick({ tables, value, onChange }: { tables: HallTable[]; value: number[]; onChange: (v: number[]) => void }) {
  return (
    <div className="row" role="group" aria-label={t.bset.tables}>
      <button type="button" className={`button button--sm${value.length === 0 ? ' button--primary' : ''}`} onClick={() => onChange([])}>
        {t.bset.allTables}
      </button>
      {tables
        .filter((x) => x.id > 0)
        .map((x) => (
          <button key={x.id} type="button" className={`button button--sm${value.includes(x.id) ? ' button--primary' : ''}`} onClick={() => onChange(value.includes(x.id) ? value.filter((v) => v !== x.id) : [...value, x.id])}>
            {x.number}
          </button>
        ))}
    </div>
  )
}

const tablesText = (ids: number[], tables: HallTable[]) => (ids.length ? ids.map((id) => tables.find((x) => x.id === id)?.number ?? '?').join(', ') : t.bset.allTables)

/** Recurring and one-off blocks of the hall (B-6). */
export function BlocksSection({ hallId, tables }: { hallId: number; tables: HallTable[] }) {
  const state = useApi<RulesView>(`/halls/${hallId}/booking-settings`)
  const [form, setForm] = useState({ kind: 'training', tableIds: [] as number[], weekdays: [1, 3, 5], startMinutes: 18 * 60, endMinutes: 20 * 60, validFrom: localDate(), validUntil: '', note: '' })
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const run = async (fn: () => Promise<{ conflicts?: unknown[] } | unknown>) => {
    setMsg(null)
    try {
      const r = (await fn()) as { conflicts?: unknown[] } | undefined
      setMsg(r?.conflicts?.length ? { ok: false, text: t.bset.conflicts(r.conflicts.length) } : { ok: true, text: t.common.saved })
      state.reload()
    } catch (e) {
      setMsg({ ok: false, text: errorText(e) })
    }
  }
  return (
    <section className="panel">
      <h2>{t.bset.recurring}</h2>
      <p className="small muted">{t.bset.recurringHint}</p>
      <Async state={state}>
        {(v) => (
          <div className="stack">
            {v.recurring.length === 0 && <p className="muted small">{t.bset.none}</p>}
            {v.recurring.map((r) => (
              <div key={r.id} className="row row--between">
                <span>
                  <b>{t.bset.kind[r.kind]}</b> · {r.weekdays.map((d) => t.bset.weekdays[d - 1]).join(' ')} · {hhmm(r.startMinutes)}–{hhmm(r.endMinutes % 1440)} · {tablesText(r.tableIds, tables)}
                  {r.note && <span className="muted"> · {r.note}</span>}
                  <span className="muted small">
                    {' '}
                    ({r.validFrom}
                    {r.validUntil ? ` — ${r.validUntil}` : ''})
                  </span>
                </span>
                <button type="button" className="button button--sm button--danger" onClick={() => void run(() => api(`/halls/${hallId}/recurring-blocks/${r.id}`, { method: 'DELETE' }))}>
                  ×
                </button>
              </div>
            ))}
            <div className="form form--cols">
              <Field label={t.bset.kind.training!}>
                <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
                  {['training', 'closed', 'maintenance'].map((k) => (
                    <option key={k} value={k}>
                      {t.bset.kind[k]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t.bset.note}>
                <input value={form.note} maxLength={300} onChange={(e) => setForm({ ...form, note: e.target.value })} />
              </Field>
              <Field label={t.bset.from}>
                <input type="time" value={hhmm(form.startMinutes)} onChange={(e) => setForm({ ...form, startMinutes: parseHhmm(e.target.value) })} />
              </Field>
              <Field label={t.bset.to}>
                <input type="time" value={hhmm(form.endMinutes % 1440)} onChange={(e) => setForm({ ...form, endMinutes: parseHhmm(e.target.value) })} />
              </Field>
              <Field label={t.bset.validFrom}>
                <input type="date" value={form.validFrom} onChange={(e) => setForm({ ...form, validFrom: e.target.value })} />
              </Field>
              <Field label={t.bset.validUntil}>
                <input type="date" value={form.validUntil} onChange={(e) => setForm({ ...form, validUntil: e.target.value })} />
              </Field>
            </div>
            <Days value={form.weekdays} onChange={(weekdays) => setForm({ ...form, weekdays })} />
            <TablePick tables={tables} value={form.tableIds} onChange={(tableIds) => setForm({ ...form, tableIds })} />
            <div>
              <button type="button" className="button button--primary button--sm" disabled={!form.weekdays.length} onClick={() => void run(() => api(`/halls/${hallId}/recurring-blocks`, { method: 'POST', json: { ...form, validUntil: form.validUntil || null } }))}>
                {t.bset.add}
              </button>
            </div>
            {msg && <p className={`note ${msg.ok ? 'note--ok' : 'note--error'}`}>{msg.text}</p>}
            <h3>{t.bset.oneOff}</h3>
            {v.blocks.length === 0 && <p className="muted small">{t.bset.none}</p>}
            {v.blocks.map((b) => (
              <div key={b.id} className="row row--between">
                <span>
                  <b>{t.bset.kind[b.kind] ?? b.kind}</b> · {formatDate(b.start)} {formatTime(b.start)}–{formatTime(b.end)} · {tablesText(b.tableIds, tables)}
                  {b.note && <span className="muted"> · {b.note}</span>}
                </span>
                {b.kind !== 'tournament' && (
                  <button type="button" className="button button--sm button--danger" onClick={() => void run(() => api(`/halls/${hallId}/blocks/${b.id}`, { method: 'DELETE' }))}>
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </Async>
    </section>
  )
}
