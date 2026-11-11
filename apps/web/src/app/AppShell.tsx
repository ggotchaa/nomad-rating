import { useEffect } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router'
import { DemoBar } from '../demo/DemoBar.tsx'
import { t } from '../i18n/index.ts'
import { useSession } from './auth.tsx'
import '../styles/app.css'

export function AppShell() {
  const { me, demo, cities, city, setCity, logout } = useSession()
  const navigate = useNavigate()
  const { pathname } = useLocation()

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])

  return (
    <div className="app">
      {demo && <DemoBar />}
      <header className="topbar">
        <div className="topbar__in">
          <Link className="logo" to="/" aria-label="Nomad">
            <i />
            NOMAD
          </Link>
          <nav className="mainnav" aria-label="Разделы">
            <NavLink to="/home">{t.nav.home}</NavLink>
            <NavLink to="/tournaments">{t.nav.tournaments}</NavLink>
            <NavLink to="/rating">{t.nav.rating}</NavLink>
            <NavLink to="/clubs">{t.nav.clubs}</NavLink>
            {me.player && <NavLink to="/me">{t.nav.cabinet}</NavLink>}
            {me.clubs.length > 0 && <NavLink to="/manage">{t.nav.manage}</NavLink>}
          </nav>
          <div className="topbar__right">
            <select aria-label={t.common.city} value={city} onChange={(e) => setCity(e.target.value)}>
              {cities.map((c) => (
                <option key={c.slug} value={c.slug}>
                  {c.name.ru}
                </option>
              ))}
            </select>
            {me.user ? (
              <>
                <span className="usertag">{me.player ? `${me.player.first_name} ${me.player.last_name}` : me.user.email}</span>
                <button
                  className="button button--sm"
                  onClick={() => {
                    void logout().then(() => navigate('/home'))
                  }}
                >
                  {t.nav.logout}
                </button>
              </>
            ) : (
              <Link className="button button--sm button--primary" to="/login">
                {t.nav.login}
              </Link>
            )}
          </div>
        </div>
      </header>
      <Outlet key={me.user?.id ?? 0} />
      <footer className="foot">
        <span>© 2026 Nomad</span>
        <span>RU · KZ · EN</span>
      </footer>
    </div>
  )
}
