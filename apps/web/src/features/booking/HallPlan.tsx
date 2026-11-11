import type { HallPlanData } from '../../api/types.ts'

export type TableState = 'free' | 'partly' | 'busy' | 'off'

type PlanTable = { id: number; number: number; x: number; y: number; rotation: 0 | 90 }

const LONG = 2.74
const SHORT = 1.525

/** Top view of a hall in metres. Stage 6 adds the editor and tournament modes to this component. */
export function HallPlan({ plan, tables, mode = 'view', state, selected, onSelect }: { plan: HallPlanData; tables: PlanTable[]; mode?: 'view' | 'booking'; state?: (id: number) => TableState; selected?: number | null; onSelect?: (id: number) => void }) {
  const width = Math.max(plan.width, ...tables.map((t) => t.x + 2))
  const length = Math.max(plan.length, ...tables.map((t) => t.y + 2))
  return (
    <svg className="plan" viewBox={`-0.5 -0.5 ${width + 1} ${length + 1}`} role="group" aria-label="План зала">
      <rect x="0" y="0" width={width} height={length} fill="none" stroke="rgba(94,242,255,0.3)" strokeWidth="0.08" rx="0.3" />
      {plan.landmarks.map((l, i) => (
        <g key={i}>
          {l.w && l.h ? <rect className="lm" x={l.x - l.w / 2} y={l.y - l.h / 2} width={l.w} height={l.h} rx="0.15" /> : <circle className="lm" cx={l.x} cy={l.y} r="0.35" />}
          <text x={l.x} y={l.y - (l.h ? l.h / 2 + 0.25 : 0.55)} fontSize="0.55" textAnchor="middle">
            {l.label}
          </text>
        </g>
      ))}
      {tables.map((tb) => {
        const s = state?.(tb.id) ?? 'free'
        const w = tb.rotation === 90 ? SHORT : LONG
        const h = tb.rotation === 90 ? LONG : SHORT
        const active = mode === 'booking' && s !== 'off'
        return (
          <g
            key={tb.id}
            className={`tbl tbl--${mode === 'view' ? 'partly' : s}${selected === tb.id ? ' tbl--sel' : ''}`}
            role={active ? 'button' : undefined}
            tabIndex={active ? 0 : undefined}
            aria-label={`Стол ${tb.number}`}
            aria-pressed={active ? selected === tb.id : undefined}
            onClick={active ? () => onSelect?.(tb.id) : undefined}
            onKeyDown={active ? (e) => (e.key === 'Enter' || e.key === ' ') && onSelect?.(tb.id) : undefined}
          >
            <rect x={tb.x - w / 2} y={tb.y - h / 2} width={w} height={h} rx="0.12" />
            <line x1={tb.rotation === 90 ? tb.x - w / 2 : tb.x} x2={tb.rotation === 90 ? tb.x + w / 2 : tb.x} y1={tb.rotation === 90 ? tb.y : tb.y - h / 2} y2={tb.rotation === 90 ? tb.y : tb.y + h / 2} stroke="currentColor" strokeOpacity="0.35" strokeWidth="0.05" />
            <text x={tb.x} y={tb.y + 0.3} fontSize="0.85" textAnchor="middle" fontWeight="700">
              {tb.number}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
