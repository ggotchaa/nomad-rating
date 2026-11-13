import { useState } from 'react'
import { locale } from '../../i18n/locale.ts'
import type { FormEvent } from 'react'
import { Link } from 'react-router'
import { api, ApiError } from '../../api/client.ts'
import type { ClubPlayer } from '../../api/types.ts'
import { useSession } from '../../app/auth.tsx'
import { useApi } from '../../app/hooks.ts'
import { errorText, t } from '../../i18n/index.ts'
import { Async, Field, Modal } from '../../ui/kit.tsx'
import { useClub } from './ManageLayout.tsx'

type Duplicate = { id: number; name: string; birthYear: number; city: string | null }

function NewPlayer({ onClose, onCreated }: { onClose: () => void; onCreated: (code: string) => void }) {
  const { club } = useClub()
  const { cities, city } = useSession()
  const [error, setError] = useState<string | null>(null)
  const [duplicates, setDuplicates] = useState<Duplicate[]>([])
  const [busy, setBusy] = useState(false)

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    setBusy(true)
    setError(null)
    try {
      const created = await api<{ claimCode: string }>(`/clubs/${club.id}/players`, {
        method: 'POST',
        json: {
          firstName: f.get('firstName'),
          lastName: f.get('lastName'),
          gender: f.get('gender'),
          birthYear: Number(f.get('birthYear')),
          cityId: Number(f.get('cityId')),
          startLevel: f.get('startLevel'),
          ...(f.get('email') ? { email: f.get('email') } : {}),
          force: duplicates.length > 0,
        },
      })
      onCreated(created.claimCode)
    } catch (err) {
      if (err instanceof ApiError && err.code === 'player.possible_duplicates') setDuplicates(err.details as Duplicate[])
      else setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={t.m.newPlayer} onClose={onClose}>
      <form className="form form--cols" onSubmit={(e) => void onSubmit(e)}>
        <Field label={t.a.lastName}>
          <input name="lastName" required />
        </Field>
        <Field label={t.a.firstName}>
          <input name="firstName" required />
        </Field>
        <Field label={t.a.gender}>
          <select name="gender">
            <option value="m">{t.a.male}</option>
            <option value="f">{t.a.female}</option>
          </select>
        </Field>
        <Field label={t.a.birthYear}>
          <input name="birthYear" type="number" min={1920} max={new Date().getFullYear() - 5} defaultValue={1990} required />
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
        <Field label={`${t.a.email} (${t.misc.optional})`} wide>
          <input name="email" type="email" />
        </Field>
        {duplicates.length > 0 && (
          <div className="note field--wide">
            {t.m.duplicates}
            <ul>
              {duplicates.map((d) => (
                <li key={d.id}>
                  {d.name}, {d.birthYear}, {d.city}
                </li>
              ))}
            </ul>
          </div>
        )}
        {error && <p className="note note--error field--wide">{error}</p>}
        <button className="button button--primary field--wide" disabled={busy}>
          {duplicates.length ? t.m.createAnyway : t.common.save}
        </button>
      </form>
    </Modal>
  )
}

function LevelCell({ p, onDone }: { p: ClubPlayer; onDone: () => void }) {
  const { club } = useClub()
  const [error, setError] = useState('')
  const send = (json: object) =>
    void api(`/clubs/${club.id}/players/${p.id}/start-level`, { method: 'POST', json })
      .then(onDone)
      .catch((e: unknown) => setError(errorText(e)))
  if (p.rating != null) return <>{p.rating}</>
  return (
    <span className="stack">
      <select aria-label={t.m.changeLevel} value={Object.keys(t.a.levels).find((k) => t.a.levels[k]?.includes(`(${p.startLevel})`)) ?? ''} onChange={(e) => send({ startLevel: e.target.value })}>
        {!Object.values(t.a.levels).some((v) => v.includes(`(${p.startLevel})`)) && <option value="">{p.startLevel}</option>}
        {Object.entries(t.a.levels).map(([k, v]) => (
          <option key={k} value={k}>
            {v}
          </option>
        ))}
      </select>
      {p.levelStatus === 'pending' && (
        <span className="row small">
          <span className="chip chip--warn">{t.m.levelPending(p.requestedLevel ?? 1600)}</span>
          <button className="button button--sm button--primary" onClick={() => send({ decision: 'confirm' })}>
            {t.m.confirmLevel}
          </button>
          <button className="button button--sm" onClick={() => send({ decision: 'reject' })}>
            {t.m.rejectLevel}
          </button>
        </span>
      )}
      {error && <span className="note note--error">{error}</span>}
    </span>
  )
}

export function ManagePlayers() {
  const { club } = useClub()
  const list = useApi<ClubPlayer[]>(`/clubs/${club.id}/players`)
  const [adding, setAdding] = useState(false)
  const [code, setCode] = useState<string | null>(null)
  const [q, setQ] = useState('')
  return (
    <section className="panel">
      <div className="panel__head">
        <h2>{t.m.clubPlayers}</h2>
        <div className="row">
          <input type="search" style={{ width: 200 }} placeholder={t.r.searchName} aria-label={t.r.searchName} value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="button button--primary button--sm" onClick={() => setAdding(true)}>
            + {t.m.newPlayer}
          </button>
        </div>
      </div>
      {code && <p className="note note--ok">{t.m.claimCode(code)}</p>}
      <Async state={list}>
        {(rows) => (
          <div className="tablewrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t.t.player}</th>
                  <th>{t.common.city}</th>
                  <th className="num">{t.t.rating}</th>
                  <th className="num">{t.p.tournaments}</th>
                  <th className="num">{t.m.noShows}</th>
                  <th>{t.m.account}</th>
                </tr>
              </thead>
              <tbody>
                {rows
                  .filter((p) => p.name.toLowerCase().includes(q.trim().toLowerCase()))
                  .map((p) => (
                    <tr key={p.id}>
                      <td>
                        <Link to={`/players/${p.id}`}>{p.name}</Link> <span className="muted small">{p.birthYear}</span>
                      </td>
                      <td className="muted">{p.city}</td>
                      <td className="num">
                        <LevelCell p={p} onDone={list.reload} />
                      </td>
                      <td className="num">{p.tournaments}</td>
                      <td className="num">{p.bookingNoShows || '—'}</td>
                      <td>
                        <span className={`chip ${p.hasAccount ? 'chip--ok' : 'chip--warn'}`}>{p.hasAccount ? t.m.hasAccount : t.m.noAccount}</span>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </Async>
      {adding && (
        <NewPlayer
          onClose={() => setAdding(false)}
          onCreated={(c) => {
            setAdding(false)
            setCode(c)
            list.reload()
          }}
        />
      )}
    </section>
  )
}
