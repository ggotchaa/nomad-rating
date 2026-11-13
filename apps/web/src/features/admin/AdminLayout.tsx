import { Link, Navigate, NavLink, Outlet } from 'react-router'
import { useSession } from '../../app/auth.tsx'
import { useApi } from '../../app/hooks.ts'
import { t } from '../../i18n/index.ts'

type Overview = { clubs: number; merges: number; rttf: number }

/** Admin sections: add an entry here and a route in main.tsx. `badge` reads a counter of /admin/overview. */
export const ADMIN_SECTIONS: { to: string; label: string; badge?: keyof Overview }[] = [
  { to: 'tournaments', label: t.adminT.title },
  { to: 'clubs', label: t.admin.clubs, badge: 'clubs' },
  { to: 'merges', label: t.admin.merges, badge: 'merges' },
  { to: 'rttf', label: t.admin.rttf, badge: 'rttf' },
  { to: 'players', label: t.admin2.players },
  { to: 'disputes', label: t.admin2.disputes },
  { to: 'audit', label: t.admin2.audit },
  { to: 'settings', label: t.admin2.settings },
  { to: 'view-as', label: t.admin2.viewAs },
]

export function AdminLayout() {
  const { me, ready } = useSession()
  const overview = useApi<Overview>(me.user?.role === 'admin' ? '/admin/overview' : null)
  if (ready && !me.user) return <Navigate to="/login" state={{ from: '/admin' }} replace />
  if (ready && me.user?.role !== 'admin') return <main className="page"><p className="note note--error">{t.errors['club.right_missing']}</p></main>
  if (me.user?.mfaRequired) return <Navigate to="/mfa?returnTo=/admin" replace />
  const code = (overview.error as { code?: string } | null)?.code
  return (
    <main className="page">
      <header className="pagehead">
        <span className="kicker">{t.admin.title}</span>
        <nav className="subnav">
          <NavLink to="/admin" end>
            {t.admin.dashboard}
          </NavLink>
          {ADMIN_SECTIONS.map((s) => (
            <NavLink key={s.to} to={s.to}>
              {s.label}
              {s.badge && overview.data?.[s.badge] ? ` · ${overview.data[s.badge]}` : ''}
            </NavLink>
          ))}
        </nav>
      </header>
      {code === 'auth.mfa_setup_required' ? (
        <p className="note note--error">
          {t.admin.needs2fa} <Link to="/me/security">{t.acc.security}</Link>
        </p>
      ) : (
        <Outlet context={{ reloadOverview: overview.reload }} />
      )}
    </main>
  )
}

export const AdminIndex = () => <Navigate to={ADMIN_SECTIONS[0]!.to} replace />
