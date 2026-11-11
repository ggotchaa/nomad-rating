import { useEffect, useState } from 'react'
import { NavLink, Navigate, Outlet, useOutletContext } from 'react-router'
import { api } from '../../api/client.ts'
import type { ClubRight, MyClub, PlayerSearchItem } from '../../api/types.ts'
import { useSession } from '../../app/auth.tsx'
import { useApi } from '../../app/hooks.ts'
import { t } from '../../i18n/index.ts'
import { Async, Soon } from '../../ui/kit.tsx'

export type ClubCtx = { club: MyClub; can: (right: ClubRight) => boolean }
export const useClub = () => useOutletContext<ClubCtx>()

const SECTIONS: { to: string; right: ClubRight; label: string }[] = [
  { to: 'tournaments', right: 'tournaments', label: t.m.tournaments },
  { to: 'bookings', right: 'bookings', label: t.m.desk },
  { to: 'players', right: 'players', label: t.m.players },
  { to: 'settings', right: 'club', label: t.m.settings },
]

export function ManageLayout() {
  const { me, ready } = useSession()
  const clubs = useApi<MyClub[]>(me.user ? '/my/clubs' : null)
  const [clubId, setClubId] = useState<number | null>(null)
  if (ready && !me.user) return <Navigate to="/login" replace />
  return (
    <main className="page">
      <Async state={clubs}>
        {(list) => {
          const club = list.find((c) => c.id === clubId) ?? list[0]
          if (!club) return <p className="note">{t.m.noClub}</p>
          const can = (right: ClubRight) => club.role === 'organizer' || club.rights.includes(right)
          return (
            <>
              <header className="pagehead">
                <span className="kicker">{t.m.title}</span>
                <div className="row row--between">
                  <h1>{club.name}</h1>
                  {list.length > 1 && (
                    <select style={{ width: 'auto' }} value={club.id} onChange={(e) => setClubId(Number(e.target.value))}>
                      {list.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
                <nav className="subnav">
                  {SECTIONS.filter((s) => can(s.right)).map((s) => (
                    <NavLink key={s.to} to={s.to}>
                      {s.label}
                    </NavLink>
                  ))}
                  <NavLink to="more">{t.common.soon}</NavLink>
                </nav>
              </header>
              <Outlet context={{ club, can } satisfies ClubCtx} />
            </>
          )
        }}
      </Async>
    </main>
  )
}

export function ManageIndex() {
  const { can } = useClub()
  const first = SECTIONS.find((s) => can(s.right))
  return <Navigate to={first?.to ?? 'more'} replace />
}

export function Guard({ right, children }: { right: ClubRight; children: React.ReactNode }) {
  const { can } = useClub()
  return can(right) ? <>{children}</> : <p className="note note--error">{t.m.noRight}</p>
}

export const ManageMore = () => (
  <div className="grid grid--cards">
    {[t.m.conduct, ...t.m.other, t.m.editor].map((title) => (
      <Soon key={title} title={title} />
    ))}
  </div>
)

export function PlayerSearch({ onPick, placeholder }: { onPick: (p: PlayerSearchItem) => void; placeholder?: string }) {
  const [q, setQ] = useState('')
  const [items, setItems] = useState<PlayerSearchItem[]>([])
  useEffect(() => {
    if (q.trim().length < 2) {
      setItems([])
      return
    }
    let alive = true
    const id = setTimeout(() => {
      api<PlayerSearchItem[]>(`/players/search?q=${encodeURIComponent(q.trim())}`)
        .then((r) => alive && setItems(r))
        .catch(() => {})
    }, 250)
    return () => {
      alive = false
      clearTimeout(id)
    }
  }, [q])
  return (
    <div className="stack">
      <input type="search" value={q} placeholder={placeholder ?? t.r.searchName} aria-label={placeholder ?? t.r.searchName} onChange={(e) => setQ(e.target.value)} />
      {items.length > 0 && (
        <div className="suggest">
          {items.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => {
                onPick(p)
                setQ('')
              }}
            >
              {p.name} <span className="muted small">· {p.birthYear} · {p.city} · {p.rating ?? t.t.calibrating}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
