import { useEffect, useRef, useState } from 'react'
import { locale } from '../../i18n/locale.ts'
import type { FormEvent, ReactNode } from 'react'
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router'
import { api } from '../../api/client.ts'
import type { Me } from '../../api/types.ts'
import { useSession } from '../../app/auth.tsx'
import { useApi } from '../../app/hooks.ts'
import { errorText, t } from '../../i18n/index.ts'
import { Async, Field } from '../../ui/kit.tsx'
import { afterLogin, safePath } from './Auth.tsx'

/** busy / error / ok state around one async action. */
export function useAction() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const run = async (fn: () => Promise<string | void>) => {
    setBusy(true)
    setError(null)
    setOk(null)
    try {
      const msg = await fn()
      if (msg) setOk(msg)
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  const notes = (
    <>
      {error && <p className="note note--error">{error}</p>}
      {ok && <p className="note note--ok">{ok}</p>}
    </>
  )
  return { busy, run, notes }
}

const formValues = (e: FormEvent<HTMLFormElement>) => {
  e.preventDefault()
  return new FormData(e.currentTarget)
}

const Narrow = ({ title, children }: { title: string; children: ReactNode }) => (
  <main className="page page--narrow">
    <h1>{title}</h1>
    {children}
  </main>
)

export function ConfirmEmail() {
  const [params] = useSearchParams()
  const { run, notes } = useAction()
  const started = useRef(false)
  useEffect(() => {
    if (started.current) return
    started.current = true
    void run(async () => {
      await api('/auth/confirm-email', { method: 'POST', json: { token: params.get('token') ?? '' } })
      return t.acc.confirmed
    })
  }, [params, run])
  return (
    <Narrow title={t.acc.confirmTitle}>
      <div className="panel stack">
        {notes}
        <Link className="button" to="/me">
          {t.nav.cabinet}
        </Link>
      </div>
    </Narrow>
  )
}

export function ForgotPassword() {
  const { busy, run, notes } = useAction()
  return (
    <Narrow title={t.acc.forgotTitle}>
      <form
        className="panel form"
        onSubmit={(e) => {
          const f = formValues(e)
          void run(async () => {
            await api('/auth/forgot-password', { method: 'POST', json: { email: f.get('email') } })
            return t.acc.forgotSent
          })
        }}
      >
        <Field label={t.a.email}>
          <input name="email" type="email" required />
        </Field>
        {notes}
        <button className="button button--primary" disabled={busy}>
          {t.acc.send}
        </button>
      </form>
    </Narrow>
  )
}

export function ResetPassword() {
  const [params] = useSearchParams()
  const { setMe } = useSession()
  const navigate = useNavigate()
  const { busy, run, notes } = useAction()
  return (
    <Narrow title={t.acc.resetTitle}>
      <form
        className="panel form"
        onSubmit={(e) => {
          const f = formValues(e)
          void run(async () => {
            const me = await api<Me>('/auth/reset-password', { method: 'POST', json: { token: params.get('token') ?? '', password: f.get('password') } })
            setMe(me)
            navigate(afterLogin(me, undefined), { replace: true })
          })
        }}
      >
        <Field label={`${t.acc.newPassword} — ${t.a.passwordHint}`}>
          <input name="password" type="password" minLength={8} autoComplete="new-password" required />
        </Field>
        {notes}
        <button className="button button--primary" disabled={busy}>
          {t.common.save}
        </button>
      </form>
    </Narrow>
  )
}

/** First login (Google accounts): consent and, without a player profile, the questionnaire. */
export function Welcome() {
  const { me, ready, setMe, cities, city } = useSession()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { busy, run, notes } = useAction()
  if (ready && !me.user) return <Navigate to="/login" replace />
  const needProfile = !me.player
  return (
    <Narrow title={t.acc.welcomeTitle}>
      <p className="muted">{t.acc.welcomeLead}</p>
      <form
        className="panel form form--cols"
        onSubmit={(e) => {
          const f = formValues(e)
          void run(async () => {
            const next = await api<Me>('/auth/welcome', {
              method: 'POST',
              json: {
                consent: f.get('consent') === 'on',
                ...(needProfile && {
                  profile: {
                    lastName: f.get('lastName'),
                    firstName: f.get('firstName'),
                    gender: f.get('gender'),
                    birthYear: Number(f.get('birthYear')),
                    cityId: Number(f.get('cityId')),
                    startLevel: f.get('startLevel'),
                  },
                }),
              },
            })
            setMe(next)
            navigate(safePath(params.get('returnTo')) ?? '/me', { replace: true })
          })
        }}
      >
        {needProfile && (
          <>
            <Field label={t.a.lastName}>
              <input name="lastName" required />
            </Field>
            <Field label={t.a.firstName}>
              <input name="firstName" required />
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
                    {c.name[locale]}
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
          </>
        )}
        <label className="check field--wide">
          <input type="checkbox" name="consent" required /> {t.acc.consent}
        </label>
        <div className="field--wide">{notes}</div>
        <button className="button button--primary field--wide" disabled={busy}>
          {t.acc.continue}
        </button>
      </form>
    </Narrow>
  )
}

export function MfaVerify() {
  const { setMe } = useSession()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { busy, run, notes } = useAction()
  return (
    <Narrow title={t.acc.mfaTitle}>
      <form
        className="panel form"
        onSubmit={(e) => {
          const f = formValues(e)
          void run(async () => {
            const me = await api<Me>('/auth/2fa/verify', { method: 'POST', json: { code: f.get('code') } })
            setMe(me)
            navigate(afterLogin(me, safePath(params.get('returnTo'))), { replace: true })
          })
        }}
      >
        <p className="muted">{t.acc.mfaLead}</p>
        <Field label={t.acc.code}>
          <input name="code" inputMode="numeric" pattern="\d{6}" autoComplete="one-time-code" required />
        </Field>
        {notes}
        <button className="button button--primary" disabled={busy}>
          {t.acc.verify}
        </button>
      </form>
    </Narrow>
  )
}

export function Security() {
  const { me, ready, setMe } = useSession()
  const [params] = useSearchParams()
  const providers = useApi<{ google: boolean }>('/auth/providers')
  const pw = useAction()
  const methods = useAction()
  const mfa = useAction()
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null)
  if (ready && !me.user) return <Navigate to="/login" state={{ from: '/me/security' }} replace />
  const user = me.user
  if (!user) return null
  const removeMethod = (m: 'password' | 'google') => methods.run(async () => setMe(await api<Me>(`/auth/methods/${m}`, { method: 'DELETE' })))
  return (
    <main className="page page--narrow">
      <h1>{t.acc.security}</h1>
      {params.get('error') && <p className="note note--error">{t.errors[params.get('error')!] ?? t.errorFallback}</p>}
      {!user.emailVerified && <ResendConfirmation />}
      <section className="panel stack">
        <h2>{t.acc.methods}</h2>
        <div className="row row--between">
          <span>{user.hasPassword ? t.acc.passwordSet : t.acc.passwordNone}</span>
          {user.hasPassword && (
            <button className="button button--sm" disabled={methods.busy} onClick={() => void removeMethod('password')}>
              {t.acc.removePassword}
            </button>
          )}
        </div>
        <div className="row row--between">
          <span>{user.googleLinked ? t.acc.googleLinked : t.acc.googleNone}</span>
          {user.googleLinked ? (
            <button className="button button--sm" disabled={methods.busy} onClick={() => void removeMethod('google')}>
              {t.acc.unlinkGoogle}
            </button>
          ) : (
            providers.data?.google && (
              <a className="button button--sm" href="/api/auth/google">
                {t.acc.linkGoogle}
              </a>
            )
          )}
        </div>
        {methods.notes}
        <form
          className="form"
          onSubmit={(e) => {
            const f = formValues(e)
            void pw.run(async () => {
              setMe(await api<Me>('/auth/password', { method: 'PUT', json: { current: f.get('current') || undefined, password: f.get('password') } }))
              return t.common.saved
            })
          }}
        >
          {user.hasPassword && (
            <Field label={t.acc.currentPassword}>
              <input name="current" type="password" autoComplete="current-password" required />
            </Field>
          )}
          <Field label={`${t.acc.newPassword} — ${t.a.passwordHint}`}>
            <input name="password" type="password" minLength={8} autoComplete="new-password" required />
          </Field>
          {pw.notes}
          <button className="button" disabled={pw.busy}>
            {t.acc.setPassword}
          </button>
        </form>
      </section>
      {user.role === 'admin' && (
        <section className="panel stack">
          <h2>{t.acc.twofa}</h2>
          {user.totpEnabled ? (
            <form
              className="form"
              onSubmit={(e) => {
                const f = formValues(e)
                void mfa.run(async () => setMe(await api<Me>('/auth/2fa/disable', { method: 'POST', json: { code: f.get('code') } })))
              }}
            >
              <span className="chip chip--ok">{t.acc.twofaOn}</span>
              <Field label={t.acc.code}>
                <input name="code" inputMode="numeric" pattern="\d{6}" required />
              </Field>
              <button className="button button--sm button--danger" disabled={mfa.busy}>
                {t.acc.disable}
              </button>
            </form>
          ) : setup ? (
            <form
              className="form"
              onSubmit={(e) => {
                const f = formValues(e)
                void mfa.run(async () => {
                  setMe(await api<Me>('/auth/2fa/enable', { method: 'POST', json: { code: f.get('code') } }))
                  setSetup(null)
                })
              }}
            >
              <p className="small muted">{t.acc.twofaHint}</p>
              <code className="mono small" style={{ wordBreak: 'break-all' }}>
                {setup.secret}
              </code>
              <a className="small" href={setup.uri} style={{ color: 'var(--holo)' }}>
                otpauth://
              </a>
              <Field label={t.acc.code}>
                <input name="code" inputMode="numeric" pattern="\d{6}" required />
              </Field>
              <button className="button button--primary" disabled={mfa.busy}>
                {t.acc.enable}
              </button>
            </form>
          ) : (
            <button className="button" disabled={mfa.busy} onClick={() => void mfa.run(async () => setSetup(await api('/auth/2fa/setup', { method: 'POST' })))}>
              {t.acc.twofaSetup}
            </button>
          )}
          {mfa.notes}
        </section>
      )}
    </main>
  )
}

function ResendConfirmation() {
  const { busy, run, notes } = useAction()
  return (
    <div className="note row row--between">
      <span>{t.acc.notVerified}</span>
      <button
        className="button button--sm"
        disabled={busy}
        onClick={() =>
          void run(async () => {
            await api('/auth/resend-confirmation', { method: 'POST' })
            return t.acc.resent
          })
        }
      >
        {t.acc.resend}
      </button>
      {notes}
    </div>
  )
}

export function ProfileEdit() {
  const { me, ready, setMe, cities } = useSession()
  const save = useAction()
  const photo = useAction()
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  if (ready && !me.user) return <Navigate to="/login" state={{ from: '/me/profile' }} replace />
  const p = me.player
  if (!p) return ready ? <Navigate to="/welcome" replace /> : null
  return (
    <main className="page page--narrow">
      <h1>{t.acc.profileEdit}</h1>
      <form
        className="panel form form--cols"
        onSubmit={(e) => {
          const f = formValues(e)
          void save.run(async () => {
            setMe(
              await api<Me>('/my/profile', {
                method: 'PATCH',
                json: {
                  lastName: f.get('lastName'),
                  firstName: f.get('firstName'),
                  middleName: f.get('middleName') || null,
                  gender: f.get('gender'),
                  birthYear: Number(f.get('birthYear')),
                  cityId: Number(f.get('cityId')),
                  hand: f.get('hand') || null,
                  ...(p.rating == null && { startLevel: f.get('startLevel') }),
                },
              }),
            )
            return t.common.saved
          })
        }}
      >
        <Field label={t.a.lastName}>
          <input name="lastName" defaultValue={p.last_name} required />
        </Field>
        <Field label={t.a.firstName}>
          <input name="firstName" defaultValue={p.first_name} required />
        </Field>
        <Field label={t.acc.middleName}>
          <input name="middleName" />
        </Field>
        <Field label={t.a.gender}>
          <select name="gender" defaultValue={p.gender}>
            <option value="m">{t.a.male}</option>
            <option value="f">{t.a.female}</option>
          </select>
        </Field>
        <Field label={t.a.birthYear}>
          <input name="birthYear" type="number" min="1920" max={new Date().getFullYear() - 5} defaultValue={p.birth_year} required />
        </Field>
        <Field label={t.common.city}>
          <select name="cityId" defaultValue={cities.find((c) => c.name.ru === p.city)?.id}>
            {cities.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name[locale]}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t.acc.hand}>
          <select name="hand" defaultValue="">
            <option value="">—</option>
            {Object.entries(t.acc.hands).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        {p.rating == null && (
          <Field label={t.a.startLevel}>
            <select name="startLevel" defaultValue={Object.keys(t.a.levels).find((k) => t.a.levels[k]?.includes(`(${p.start_level})`)) ?? 'amateur'}>
              {Object.entries(t.a.levels).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
        )}
        <div className="field--wide">{save.notes}</div>
        <button className="button button--primary field--wide" disabled={save.busy}>
          {t.common.save}
        </button>
      </form>
      <section className="panel stack">
        <h2>{t.acc.photo}</h2>
        {(photoUrl ?? p.photo_url) && <img src={photoUrl ?? p.photo_url!} alt="" width={120} height={120} style={{ objectFit: 'cover', borderRadius: 12 }} />}
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          aria-label={t.acc.photo}
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void photo.run(async () => setPhotoUrl((await api<{ photoUrl: string }>('/my/photo', { method: 'POST', body: file, headers: { 'Content-Type': file.type } })).photoUrl))
          }}
        />
        <p className="small muted">{t.acc.photoHint}</p>
        {photo.notes}
      </section>
      <ClaimByCode />
    </main>
  )
}

export function ClaimByCode() {
  const { setMe } = useSession()
  const { busy, run, notes } = useAction()
  return (
    <form
      className="panel form"
      onSubmit={(e) => {
        const f = formValues(e)
        void run(async () => {
          const r = await api<{ claimed: number | null; mergeRequest: number | null }>('/my/claim', { method: 'POST', json: { code: f.get('code') } })
          setMe(await api<Me>('/auth/me'))
          return r.claimed ? t.acc.claimDone : t.acc.claimMerge
        })
      }}
    >
      <h2>{t.acc.claimTitle}</h2>
      <p className="small muted">{t.acc.claimLead}</p>
      <Field label={t.acc.code}>
        <input name="code" inputMode="numeric" required />
      </Field>
      {notes}
      <button className="button" disabled={busy}>
        {t.acc.claim}
      </button>
    </form>
  )
}

type InvitationView = { club: string; slug: string; email: string | null; rights: string[] }

export function AcceptInvitation() {
  const { token = '' } = useParams()
  const { me, setMe } = useSession()
  const navigate = useNavigate()
  const inv = useApi<InvitationView>(`/invitations/${token}`)
  const { busy, run, notes } = useAction()
  return (
    <Narrow title={t.acc.inviteTitle}>
      <Async state={inv}>
        {(v) => (
          <div className="panel stack">
            <p>{t.acc.inviteLead(v.club)}</p>
            <div className="row">
              {v.rights.map((r) => (
                <span key={r} className="chip">
                  {t.helpers.rights[r] ?? r}
                </span>
              ))}
            </div>
            {notes}
            {me.user ? (
              <button
                className="button button--primary"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await api(`/invitations/${token}/accept`, { method: 'POST' })
                    setMe(await api<Me>('/auth/me'))
                    navigate('/manage')
                  })
                }
              >
                {t.acc.accept}
              </button>
            ) : (
              <Link className="button button--primary" to="/login" state={{ from: `/invite/${token}` }}>
                {t.acc.loginToAccept}
              </Link>
            )}
          </div>
        )}
      </Async>
    </Narrow>
  )
}
