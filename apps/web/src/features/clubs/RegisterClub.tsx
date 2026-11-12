import { Navigate, useNavigate } from 'react-router'
import { api } from '../../api/client.ts'
import type { Me } from '../../api/types.ts'
import { useSession } from '../../app/auth.tsx'
import { t } from '../../i18n/index.ts'
import { Field } from '../../ui/kit.tsx'
import { useAction } from '../account/AccountFlows.tsx'

export function RegisterClub() {
  const { me, ready, setMe, cities, city } = useSession()
  const navigate = useNavigate()
  const { busy, run, notes } = useAction()
  if (ready && !me.user) return <Navigate to="/login" state={{ from: '/clubs/new' }} replace />
  return (
    <main className="page page--narrow">
      <h1>{t.clubreg.title}</h1>
      <p className="muted">{t.clubreg.lead}</p>
      <form
        className="panel form form--cols"
        onSubmit={(e) => {
          e.preventDefault()
          const f = new FormData(e.currentTarget)
          void run(async () => {
            await api('/clubs', {
              method: 'POST',
              json: {
                name: f.get('name'),
                cityId: Number(f.get('cityId')),
                description: f.get('description'),
                ...(f.get('contactEmail') ? { contactEmail: f.get('contactEmail') } : {}),
                hall: { name: f.get('hallName'), address: f.get('address') },
              },
            })
            setMe(await api<Me>('/auth/me'))
            navigate('/manage/club')
          })
        }}
      >
        <Field label={t.clubreg.name} wide>
          <input name="name" minLength={2} required />
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
        <Field label={t.a.email}>
          <input name="contactEmail" type="email" />
        </Field>
        <Field label={t.clubreg.hallName}>
          <input name="hallName" defaultValue="Основной зал" required />
        </Field>
        <Field label={t.clubreg.address}>
          <input name="address" minLength={3} required />
        </Field>
        <Field label={t.m.description} wide>
          <textarea name="description" rows={4} />
        </Field>
        <div className="field--wide">{notes}</div>
        <button className="button button--primary field--wide" disabled={busy}>
          {t.clubreg.create}
        </button>
      </form>
    </main>
  )
}
