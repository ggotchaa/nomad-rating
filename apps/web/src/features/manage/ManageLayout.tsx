import { useEffect, useState } from 'react'
import { NavLink, Navigate, Outlet, useOutletContext } from 'react-router'
import { api } from '../../api/client.ts'
import type { ClubRight, MyClub, PlayerSearchItem } from '../../api/types.ts'
import { useSession } from '../../app/auth.tsx'
import { useApi } from '../../app/hooks.ts'
import { t } from '../../i18n/index.ts'
import { Async } from '../../ui/kit.tsx'
import { VIEW_AS_KEY } from '../admin/AdminTools.tsx'

const viewAsId = () => {
  try {
    return sessionStorage.getItem(VIEW_AS_KEY)
  } catch {
    return null
  }
}

type Need = ClubRight | 'organizer' | 'any'
export type ClubCtx = { club: MyClub; can: (right: Need) => boolean }
export const useClub = () => useOutletContext<ClubCtx>()

const SECTIONS: { to: string; right: Need; label: string }[] = [
  { to: 'today', right: 'any', label: t.m.today },
  { to: 'club', right: 'organizer', label: t.clubreg.clubSection },
  { to: 'tournaments', right: 'tournaments', label: t.m.tournaments },
  { to: 'leagues', right: 'tournaments', label: t.leagues.title },
  { to: 'bookings', right: 'bookings', label: t.m.desk },
  { to: 'players', right: 'players', label: t.m.players },
  { to: 'settings', right: 'club', label: t.m.settings },
  { to: 'import', right: 'players', label: t.imp.title },
  { to: 'finance', right: 'finance', label: t.finance.title },
  { to: 'helpers', right: 'organizer', label: t.helpers.title },
  { to: 'audit', right: 'organizer', label: t.helpers.audit },
]

export function ManageLayout() {
  const { me, ready, setActiveClub } = useSession()
  // «View as club» (4.8): an admin opens any club read-only; the server rejects every write.
  const [viewAs, setViewAs] = useState(viewAsId)
  const asAdmin = viewAs && me.user?.role === 'admin' ? viewAs : null
  const own = useApi<MyClub[]>(me.user && !asAdmin ? '/my/clubs' : null)
  const viewed = useApi<MyClub>(asAdmin ? `/admin/clubs/${asAdmin}/view` : null)
  const clubs = asAdmin ? { ...viewed, data: viewed.data ? [viewed.data] : null } : own
  const clubId = me.activeClubId ?? null
  if (ready && !me.user) return <Navigate to="/login" replace />
  return (
    <main className="page">
      <Async state={clubs}>
        {(list) => {
          const club = list.find((c) => c.id === clubId) ?? list[0]
          if (!club) return <p className="note">{t.m.noClub}</p>
          const can = (right: Need) => right === 'any' || club.role === 'organizer' || (right !== 'organizer' && club.rights.includes(right))
          return (
            <>
              <header className="pagehead">
                {asAdmin && (
                  <p className="note row row--between">
                    {t.admin2.readOnly}
                    <button
                      className="button button--sm"
                      onClick={() => {
                        try {
                          sessionStorage.removeItem(VIEW_AS_KEY)
                        } catch {
                          /* storage blocked */
                        }
                        setViewAs(null)
                      }}
                    >
                      {t.admin2.exit}
                    </button>
                  </p>
                )}
                <span className="kicker">{t.m.title}</span>
                <div className="row row--between">
                  <h1>{club.name}</h1>
                  {list.length > 1 && (
                    <select style={{ width: 'auto' }} value={club.id} onChange={(e) => void setActiveClub(Number(e.target.value))}>
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
  return first ? <Navigate to={first.to} replace /> : <p className="note note--error">{t.m.noRight}</p>
}

export function Guard({ right, children }: { right: Need; children: React.ReactNode }) {
  const { can } = useClub()
  return can(right) ? <>{children}</> : <p className="note note--error">{t.m.noRight}</p>
}


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
