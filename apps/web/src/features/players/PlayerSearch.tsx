import { useEffect, useState } from 'react'
import type { RatingRow } from '../../api/types.ts'
import { useApi } from '../../app/hooks.ts'
import { CalibratingMark } from '../rating/widgets.tsx'

/** Name search over all players (incl. calibrating and inactive); calls onPick with the chosen row. */
export function PlayerSearch({ placeholder, onPick, exclude }: { placeholder: string; onPick: (p: RatingRow) => void; exclude?: number }) {
  const [q, setQ] = useState('')
  const [term, setTerm] = useState('')
  useEffect(() => {
    const id = setTimeout(() => setTerm(q.trim()), 300)
    return () => clearTimeout(id)
  }, [q])
  const list = useApi<{ items: RatingRow[] }>(term.length >= 2 ? `/players?${new URLSearchParams({ q: term, limit: '8', inactive: 'true', calibrating: 'true' })}` : null)
  const items = term.length >= 2 ? (list.data?.items ?? []).filter((p) => p.id !== exclude) : []
  return (
    <div className="stack">
      <input type="search" placeholder={placeholder} aria-label={placeholder} value={q} onChange={(e) => setQ(e.target.value)} />
      {items.length > 0 && (
        <div className="linklist">
          {items.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => {
                setQ('')
                setTerm('')
                onPick(p)
              }}
            >
              <div>
                <b>{p.name}</b>
                <span>{[p.city, p.birthYear].filter(Boolean).join(' · ')}</span>
              </div>
              {p.calibrating ? <CalibratingMark /> : <span className="mono">{p.rating}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
