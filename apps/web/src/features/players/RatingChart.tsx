import { useState } from 'react'
import type { RatingPoint } from '../../api/types.ts'
import { formatDateShort, signed } from '../../i18n/format.ts'
import { t } from '../../i18n/index.ts'

const W = 720
const H = 240
const PAD = { l: 44, r: 16, t: 14, b: 26 }

export function RatingChart({ points }: { points: RatingPoint[] }) {
  const [hover, setHover] = useState<number | null>(null)
  if (points.length < 2) return <p className="empty">{t.misc.notEnoughData}</p>
  const times = points.map((p) => new Date(p.date).getTime())
  const values = points.map((p) => p.rating)
  const t0 = Math.min(...times)
  const t1 = Math.max(...times)
  const lo = Math.floor((Math.min(...values) - 15) / 50) * 50
  const hi = Math.ceil((Math.max(...values) + 15) / 50) * 50
  const x = (ms: number) => PAD.l + ((ms - t0) / (t1 - t0 || 1)) * (W - PAD.l - PAD.r)
  const y = (v: number) => PAD.t + (1 - (v - lo) / (hi - lo || 1)) * (H - PAD.t - PAD.b)
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(times[i]!).toFixed(1)},${y(p.rating).toFixed(1)}`).join(' ')
  const ticks = Array.from({ length: Math.round((hi - lo) / 50) + 1 }, (_, i) => lo + i * 50).filter((_, i, a) => a.length <= 6 || i % 2 === 0)
  const active = hover == null ? points.length - 1 : hover
  const p = points[active]!

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect()
    const px = ((e.clientX - box.left) / box.width) * W
    let best = 0
    for (let i = 1; i < points.length; i++) if (Math.abs(x(times[i]!) - px) < Math.abs(x(times[best]!) - px)) best = i
    setHover(best)
  }

  return (
    <div className="stack">
      <p className="charttip">
        {formatDateShort(p.date)} · {p.title} · <b style={{ color: 'var(--text)' }}>{p.rating}</b>
        {p.delta != null && ` (${signed(Math.round(p.delta))})`}
      </p>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t.misc.ratingChart} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
        <defs>
          <linearGradient id="rating-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#5ef2ff" stopOpacity="0.28" />
            <stop offset="1" stopColor="#5ef2ff" stopOpacity="0" />
          </linearGradient>
        </defs>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} stroke="rgba(94,242,255,0.1)" />
            <text x={PAD.l - 8} y={y(v) + 4} textAnchor="end">
              {v}
            </text>
          </g>
        ))}
        <text x={PAD.l} y={H - 6}>
          {formatDateShort(points[0]!.date)}
        </text>
        <text x={W - PAD.r} y={H - 6} textAnchor="end">
          {formatDateShort(points[points.length - 1]!.date)}
        </text>
        <path d={`${line} L${x(t1)},${H - PAD.b} L${x(t0)},${H - PAD.b} Z`} fill="url(#rating-fill)" />
        <path d={line} fill="none" stroke="#5ef2ff" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        <line x1={x(times[active]!)} x2={x(times[active]!)} y1={PAD.t} y2={H - PAD.b} stroke="rgba(94,242,255,0.35)" strokeDasharray="3 3" />
        <circle cx={x(times[active]!)} cy={y(p.rating)} r="5" fill="#03050b" stroke="#5ef2ff" strokeWidth="2" />
      </svg>
    </div>
  )
}
