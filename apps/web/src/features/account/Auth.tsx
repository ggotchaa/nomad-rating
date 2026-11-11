import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { api } from '../../api/client.ts'
import type { Me } from '../../api/types.ts'
import { useSession } from '../../app/auth.tsx'
import { errorText, t } from '../../i18n/index.ts'
import { Field } from '../../ui/kit.tsx'

function useAuthSubmit() {
  const { setMe } = useSession()
  const navigate = useNavigate()
  const from = (useLocation().state as { from?: string } | null)?.from
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submit = async (path: string, json: unknown) => {
    setBusy(true)
    setError(null)
    try {
      const me = await api<Me>(path, { method: 'POST', json })
      setMe(me)
      navigate(from ?? (me.clubs.length ? '/manage' : '/me'), { replace: true })
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  return { busy, error, submit, from }
}

export function Login() {
  const { busy, error, submit, from } = useAuthSubmit()
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    void submit('/auth/login', { email: f.get('email'), password: f.get('password') })
  }
  return (
    <main className="page page--narrow">
      <h1>{t.a.login}</h1>
      <form className="panel form" onSubmit={onSubmit}>
        <Field label={t.a.email}>
          <input name="email" type="email" autoComplete="email" required />
        </Field>
        <Field label={t.a.password}>
          <input name="password" type="password" autoComplete="current-password" required />
        </Field>
        {error && <p className="note note--error">{error}</p>}
        <button className="button button--primary" disabled={busy}>
          {t.a.signIn}
        </button>
        <button className="button" type="button" disabled>
          {t.a.google}
        </button>
        <p className="small muted">
          {t.a.noAccount}{' '}
          <Link to="/register" state={{ from }} style={{ color: 'var(--holo)' }}>
            {t.a.register}
          </Link>
        </p>
      </form>
    </main>
  )
}

export function Register() {
  const { cities, city } = useSession()
  const { busy, error, submit, from } = useAuthSubmit()
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    void submit('/auth/register', {
      email: f.get('email'),
      password: f.get('password'),
      firstName: f.get('firstName'),
      lastName: f.get('lastName'),
      gender: f.get('gender'),
      birthYear: Number(f.get('birthYear')),
      cityId: Number(f.get('cityId')),
      startLevel: f.get('startLevel'),
    })
  }
  return (
    <main className="page page--narrow">
      <h1>{t.a.register}</h1>
      <form className="panel form form--cols" onSubmit={onSubmit}>
        <Field label={t.a.lastName}>
          <input name="lastName" autoComplete="family-name" required />
        </Field>
        <Field label={t.a.firstName}>
          <input name="firstName" autoComplete="given-name" required />
        </Field>
        <Field label={t.a.gender}>
          <select name="gender" defaultValue="m">
            <option value="m">{t.a.male}</option>
            <option value="f">{t.a.female}</option>
          </select>
        </Field>
        <Field label={t.a.birthYear}>
          <input name="birthYear" type="number" min="1920" max={new Date().getFullYear() - 5} defaultValue="1995" required />
        </Field>
        <Field label={t.common.city}>
          <select name="cityId" defaultValue={cities.find((c) => c.slug === city)?.id}>
            {cities.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name.ru}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t.a.startLevel}>
          <select name="startLevel" defaultValue="amateur">
            {Object.entries(t.a.levels).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t.a.email} wide>
          <input name="email" type="email" autoComplete="email" required />
        </Field>
        <Field label={`${t.a.password} — ${t.a.passwordHint}`} wide>
          <input name="password" type="password" autoComplete="new-password" minLength={8} required />
        </Field>
        {error && <p className="note note--error field--wide">{error}</p>}
        <button className="button button--primary field--wide" disabled={busy}>
          {t.a.signUp}
        </button>
        <p className="small muted field--wide">
          {t.a.haveAccount}{' '}
          <Link to="/login" state={{ from }} style={{ color: 'var(--holo)' }}>
            {t.a.login}
          </Link>
        </p>
      </form>
    </main>
  )
}
