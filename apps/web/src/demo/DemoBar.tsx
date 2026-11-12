// DEMO_MODE only: banner and «Войти как…» switcher. Delete this folder with the flag.

import { useNavigate } from 'react-router'
import { api } from '../api/client.ts'
import type { DemoAccount, Me } from '../api/types.ts'
import { useApi } from '../app/hooks.ts'
import { useSession } from '../app/auth.tsx'
import { t } from '../i18n/index.ts'

export function DemoBar() {
  const { me, setMe, logout } = useSession()
  const navigate = useNavigate()
  const accounts = useApi<DemoAccount[]>('/demo/accounts')
  const current = accounts.data?.find((a) => a.email === me.user?.email)?.key ?? ''

  const switchTo = async (key: string) => {
    if (!key) {
      await logout()
      navigate('/home')
      return
    }
    const next = await api<Me>('/demo/login-as', { method: 'POST', json: { key } })
    setMe(next)
    navigate(next.clubs.length ? '/manage' : next.player ? '/me' : '/home')
  }

  return (
    <div className="demo-bar">
      <span>{t.demo.banner}</span>
      <select aria-label={t.demo.loginAs} value={current} onChange={(e) => void switchTo(e.target.value)}>
        <option value="">{me.user ? t.demo.guest : t.demo.loginAs}</option>
        {accounts.data?.map((a) => (
          <option key={a.key} value={a.key}>
            {t.demo.personas[a.key] ?? a.title}
          </option>
        ))}
      </select>
    </div>
  )
}
