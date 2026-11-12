import { useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { HallPlanData } from '../../api/types.ts'
import { t } from '../../i18n/index.ts'

export type TableState = 'free' | 'partly' | 'busy' | 'off' | 'playing' | 'called'
export type PlanTable = { id: number; number: number; x: number; y: number; rotation: 0 | 90; label?: string | null }
export type PlanSelection = { kind: 'table'; id: number } | { kind: 'landmark'; index: number } | null

const LONG = 2.74
const SHORT = 1.525
const SNAP = 0.25
const snap = (v: number) => Math.max(0, Math.round(v / SNAP) * SNAP)

type Props = {
  plan: HallPlanData
  tables: PlanTable[]
  /** view: static; booking: pick a table; tournament: match state per table; editor: drag, rotate, select. */
  mode?: 'view' | 'booking' | 'tournament' | 'editor'
  state?: (id: number) => TableState
  caption?: (id: number) => string | undefined
  selected?: number | null
  onSelect?: (id: number) => void
  selection?: PlanSelection
  onSelection?: (s: PlanSelection) => void
  onChange?: (tables: PlanTable[], plan: HallPlanData) => void
}

/** Top view of a hall in metres: one component for the editor, booking and tournament screens (B-1…B-4, B-13). */
export function HallPlan({ plan, tables, mode = 'view', state, caption, selected, onSelect, selection, onSelection, onChange }: Props) {
  const svg = useRef<SVGSVGElement>(null)
  const drag = useRef<{ sel: Exclude<PlanSelection, null>; dx: number; dy: number } | null>(null)
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const pinch = useRef<{ dist: number; zoom: number } | null>(null)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const editor = mode === 'editor'
  const width = Math.max(plan.width, ...tables.map((x) => x.x + 2))
  const length = Math.max(plan.length, ...tables.map((x) => x.y + 2))
  const vw = (width + 1) / zoom
  const vh = (length + 1) / zoom
  const vx = Math.min(Math.max(-0.5, -0.5 + pan.x), width + 0.5 - vw)
  const vy = Math.min(Math.max(-0.5, -0.5 + pan.y), length + 0.5 - vh)

  const toPlan = (e: { clientX: number; clientY: number }) => {
    const m = svg.current?.getScreenCTM()
    if (!m) return { x: 0, y: 0 }
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse())
    return { x: p.x, y: p.y }
  }

  const startDrag = (e: ReactPointerEvent, sel: Exclude<PlanSelection, null>, x: number, y: number) => {
    if (!editor) return
    e.stopPropagation()
    const p = toPlan(e)
    drag.current = { sel, dx: p.x - x, dy: p.y - y }
    svg.current?.setPointerCapture(e.pointerId)
    onSelection?.(sel)
  }

  const onMove = (e: ReactPointerEvent) => {
    if (drag.current && onChange) {
      const p = toPlan(e)
      const x = snap(p.x - drag.current.dx)
      const y = snap(p.y - drag.current.dy)
      const sel = drag.current.sel
      if (sel.kind === 'table') onChange(tables.map((tb) => (tb.id === sel.id ? { ...tb, x, y } : tb)), plan)
      else onChange(tables, { ...plan, landmarks: plan.landmarks.map((l, i) => (i === sel.index ? { ...l, x, y } : l)) })
      return
    }
    if (editor || !pointers.current.has(e.pointerId)) return
    const prev = pointers.current.get(e.pointerId)!
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const pts = [...pointers.current.values()]
    if (pts.length === 2) {
      const dist = Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y)
      pinch.current ??= { dist, zoom }
      setZoom(Math.min(4, Math.max(1, pinch.current.zoom * (dist / pinch.current.dist))))
    } else if (zoom > 1) {
      const rect = svg.current!.getBoundingClientRect()
      setPan((p) => ({ x: p.x - ((e.clientX - prev.x) / rect.width) * vw, y: p.y - ((e.clientY - prev.y) / rect.height) * vh }))
    }
  }

  const onDown = (e: ReactPointerEvent) => {
    if (editor) onSelection?.(null)
    else if (e.pointerType === 'touch' || zoom > 1) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
  }
  const onUp = (e: ReactPointerEvent) => {
    drag.current = null
    pointers.current.delete(e.pointerId)
    if (pointers.current.size < 2) pinch.current = null
  }

  const grid: number[][] = []
  if (editor) {
    for (let x = 0; x <= width; x++) grid.push([x, 0, x, length])
    for (let y = 0; y <= length; y++) grid.push([0, y, width, y])
  }

  return (
    <div className={`planwrap${editor ? ' planwrap--editor' : ''}`}>
      <svg
        ref={svg}
        className="plan"
        viewBox={`${vx} ${vy} ${vw} ${vh}`}
        role="group"
        aria-label={t.plan.aria}
        style={{ touchAction: editor || zoom > 1 ? 'none' : 'pan-y' }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        {grid.map(([x1, y1, x2, y2], i) => (
          <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} className="plan__grid" />
        ))}
        <rect x="0" y="0" width={width} height={length} fill="none" stroke="rgba(94,242,255,0.3)" strokeWidth="0.08" rx="0.3" />
        {plan.landmarks.map((l, i) => {
          const sel = selection?.kind === 'landmark' && selection.index === i
          return (
            <g key={i} className={`${l.kind === 'zone' ? 'lm-zone' : ''}${sel ? ' lm--sel' : ''}`} onPointerDown={(e) => startDrag(e, { kind: 'landmark', index: i }, l.x, l.y)} style={editor ? { cursor: 'move' } : undefined}>
              {l.w && l.h ? <rect className="lm" x={l.x - l.w / 2} y={l.y - l.h / 2} width={l.w} height={l.h} rx="0.15" /> : <circle className="lm" cx={l.x} cy={l.y} r="0.35" />}
              <text x={l.x} y={l.y - (l.h ? l.h / 2 + 0.25 : 0.55)} fontSize="0.55" textAnchor="middle">
                {l.label}
              </text>
            </g>
          )
        })}
        {tables.map((tb) => {
          const s = state?.(tb.id) ?? 'free'
          const w = tb.rotation === 90 ? SHORT : LONG
          const h = tb.rotation === 90 ? LONG : SHORT
          const active = mode === 'booking' && s !== 'off'
          const isSel = editor ? selection?.kind === 'table' && selection.id === tb.id : selected === tb.id
          const cap = caption?.(tb.id)
          return (
            <g
              key={tb.id}
              className={`tbl tbl--${mode === 'view' || editor ? 'partly' : s}${isSel ? ' tbl--sel' : ''}`}
              role={active ? 'button' : undefined}
              tabIndex={active ? 0 : undefined}
              aria-label={`${t.me.table} ${tb.number}${cap ? `: ${cap}` : ''}`}
              aria-pressed={active ? selected === tb.id : undefined}
              style={editor ? { cursor: 'move' } : undefined}
              onPointerDown={(e) => startDrag(e, { kind: 'table', id: tb.id }, tb.x, tb.y)}
              onClick={active ? () => onSelect?.(tb.id) : undefined}
              onKeyDown={active ? (e) => (e.key === 'Enter' || e.key === ' ') && onSelect?.(tb.id) : undefined}
            >
              <rect x={tb.x - w / 2} y={tb.y - h / 2} width={w} height={h} rx="0.12" />
              <line x1={tb.rotation === 90 ? tb.x - w / 2 : tb.x} x2={tb.rotation === 90 ? tb.x + w / 2 : tb.x} y1={tb.rotation === 90 ? tb.y : tb.y - h / 2} y2={tb.rotation === 90 ? tb.y : tb.y + h / 2} stroke="currentColor" strokeOpacity="0.35" strokeWidth="0.05" />
              <text x={tb.x} y={tb.y + 0.3} fontSize="0.85" textAnchor="middle" fontWeight="700">
                {tb.number}
              </text>
              {(cap || (editor && tb.label)) && (
                <text x={tb.x} y={tb.y + h / 2 + 0.55} fontSize="0.42" textAnchor="middle" className="tbl__cap">
                  {cap ?? tb.label}
                </text>
              )}
            </g>
          )
        })}
      </svg>
      {!editor && (
        <div className="planzoom">
          <button type="button" className="button button--sm" aria-label={t.plan.zoomIn} onClick={() => setZoom((z) => Math.min(4, z * 1.5))}>
            +
          </button>
          <button
            type="button"
            className="button button--sm"
            aria-label={t.plan.zoomOut}
            onClick={() => {
              setZoom((z) => Math.max(1, z / 1.5))
              if (zoom <= 1.5) setPan({ x: 0, y: 0 })
            }}
          >
            −
          </button>
        </div>
      )}
    </div>
  )
}
