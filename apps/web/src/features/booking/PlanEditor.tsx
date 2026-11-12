import { useState } from 'react'
import type { HallPlanData, HallTable } from '../../api/types.ts'
import { t } from '../../i18n/index.ts'
import { Field } from '../../ui/kit.tsx'
import { HallPlan } from './HallPlan.tsx'
import type { PlanSelection, PlanTable } from './HallPlan.tsx'

type Landmark = HallPlanData['landmarks'][number]
const KINDS = ['entrance', 'locker', 'window', 'zone', 'other'] as const

/** Plan editor (B-1…B-4): metre grid with 25 cm snapping, drag, rotate 90°, labels, landmarks and zones. */
export function PlanEditor({ plan, tables, onChange }: { plan: HallPlanData; tables: HallTable[]; onChange: (tables: HallTable[], plan: HallPlanData) => void }) {
  const [sel, setSel] = useState<PlanSelection>(null)
  const table = sel?.kind === 'table' ? tables.find((x) => x.id === sel.id) : undefined
  const landmark = sel?.kind === 'landmark' ? plan.landmarks[sel.index] : undefined
  const setTable = (patch: Partial<HallTable>) => table && onChange(tables.map((x) => (x.id === table.id ? { ...x, ...patch } : x)), plan)
  const setLandmark = (patch: Partial<Landmark>) => sel?.kind === 'landmark' && onChange(tables, { ...plan, landmarks: plan.landmarks.map((l, i) => (i === sel.index ? { ...l, ...patch } : l)) })
  const merge = (next: PlanTable[], nextPlan: HallPlanData) => onChange(tables.map((x) => { const n = next.find((m) => m.id === x.id); return n ? { ...x, x: n.x, y: n.y } : x }), nextPlan)

  const addTable = () => {
    const number = Math.max(0, ...tables.map((x) => x.number)) + 1
    // Negative ids mark new tables; the server assigns real ids on save.
    const id = Math.min(0, ...tables.map((x) => x.id)) - 1
    onChange([...tables, { id, number, label: `${t.me.table} ${number}`, x: 2, y: 2, rotation: 0, bookable: true, pricePerHour: null, model: null, status: 'active' }], plan)
    setSel({ kind: 'table', id })
  }
  const addLandmark = (kind: Landmark['kind']) => {
    const l: Landmark = kind === 'zone' ? { kind, label: t.plan.kinds.zone ?? '', x: 3, y: 3, w: 4, h: 2 } : { kind, label: t.plan.kinds[kind] ?? kind, x: 1, y: 1 }
    onChange(tables, { ...plan, landmarks: [...plan.landmarks, l] })
    setSel({ kind: 'landmark', index: plan.landmarks.length })
  }
  const remove = () => {
    if (table) onChange(tables.filter((x) => x.id !== table.id), plan)
    if (sel?.kind === 'landmark') onChange(tables, { ...plan, landmarks: plan.landmarks.filter((_, i) => i !== sel.index) })
    setSel(null)
  }

  return (
    <div className="stack">
      <div className="row">
        <button type="button" className="button button--sm" onClick={addTable}>
          + {t.plan.addTable}
        </button>
        <select style={{ width: 'auto' }} value="" aria-label={t.plan.addLandmark} onChange={(e) => e.target.value && addLandmark(e.target.value as Landmark['kind'])}>
          <option value="">+ {t.plan.addLandmark}</option>
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {t.plan.kinds[k]}
            </option>
          ))}
        </select>
        <label className="small">
          {t.plan.width}{' '}
          <input type="number" min={4} max={100} style={{ width: '5em' }} value={plan.width} onChange={(e) => onChange(tables, { ...plan, width: Number(e.target.value) || plan.width })} />
        </label>
        <label className="small">
          {t.plan.length}{' '}
          <input type="number" min={4} max={100} style={{ width: '5em' }} value={plan.length} onChange={(e) => onChange(tables, { ...plan, length: Number(e.target.value) || plan.length })} />
        </label>
      </div>
      <HallPlan plan={plan} tables={tables} mode="editor" selection={sel} onSelection={setSel} onChange={merge} />
      <p className="small muted">{t.plan.hint}</p>
      {table && (
        <div className="row">
          <b>
            {t.me.table} {table.number}
          </b>
          <input aria-label={t.plan.label} style={{ width: 'auto' }} value={table.label} onChange={(e) => setTable({ label: e.target.value })} />
          <button type="button" className="button button--sm" onClick={() => setTable({ rotation: table.rotation === 90 ? 0 : 90 })}>
            ⟳ 90°
          </button>
          <button type="button" className="button button--sm button--danger" onClick={remove}>
            {t.plan.remove}
          </button>
        </div>
      )}
      {landmark && (
        <div className="form form--cols">
          <Field label={t.plan.label}>
            <input value={landmark.label} onChange={(e) => setLandmark({ label: e.target.value })} />
          </Field>
          {landmark.kind === 'zone' && (
            <>
              <Field label={t.plan.width}>
                <input type="number" min={0.5} step={0.25} value={landmark.w ?? 1} onChange={(e) => setLandmark({ w: Number(e.target.value) })} />
              </Field>
              <Field label={t.plan.length}>
                <input type="number" min={0.5} step={0.25} value={landmark.h ?? 1} onChange={(e) => setLandmark({ h: Number(e.target.value) })} />
              </Field>
            </>
          )}
          <div>
            <button type="button" className="button button--sm button--danger" onClick={remove}>
              {t.plan.remove}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
