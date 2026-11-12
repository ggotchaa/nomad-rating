import { api } from '../../api/client.ts'
import { useApi } from '../../app/hooks.ts'
import { t } from '../../i18n/index.ts'
import { Async, Field } from '../../ui/kit.tsx'
import { useAction } from '../account/AccountFlows.tsx'
import { useClub } from './ManageLayout.tsx'

type ClubManage = {
  id: number
  name: string
  description: string
  status: string
  statusReason: string | null
  commentForPlayers: string
  tournamentDefaults: { fee?: number; settings?: { checkinWindowMinutes?: number; avgMatchMinutes?: number } }
  requisites: Record<string, string> | null
  role: 'organizer' | 'helper'
  halls: { id: number; name: string; address: string; timezone: string; isDefault: boolean; tables: number }[]
}

const STATUS_TONE: Record<string, string> = { active: 'chip--ok', review: 'chip--warn', rejected: 'chip--bad', blocked: 'chip--bad', draft: '' }
const fd = (e: React.FormEvent<HTMLFormElement>) => {
  e.preventDefault()
  return new FormData(e.currentTarget)
}

export function ClubSettings() {
  const { club } = useClub()
  const state = useApi<ClubManage>(`/clubs/${club.id}/manage`)
  const status = useAction()
  const profile = useAction()
  const req = useAction()
  const hall = useAction()
  return (
    <Async state={state}>
      {(c) => (
        <div className="grid grid--half">
          <section className="panel stack">
            <div className="row row--between">
              <h2>{t.clubreg.clubSection}</h2>
              <span className={`chip ${STATUS_TONE[c.status] ?? ''}`}>{t.clubreg.status[c.status] ?? c.status}</span>
            </div>
            {c.statusReason && (
              <p className="note note--error">
                {t.clubreg.reason}: {c.statusReason}
              </p>
            )}
            {c.role === 'organizer' && (c.status === 'draft' || c.status === 'rejected') && (
              <button
                className="button button--primary"
                disabled={status.busy}
                onClick={() =>
                  void status.run(async () => {
                    await api(`/clubs/${c.id}/submit`, { method: 'POST' })
                    state.reload()
                  })
                }
              >
                {t.clubreg.submit}
              </button>
            )}
            {status.notes}
            <form
              className="form"
              onSubmit={(e) => {
                const f = fd(e)
                void profile.run(async () => {
                  await api(`/clubs/${c.id}`, {
                    method: 'PATCH',
                    json: {
                      name: f.get('name'),
                      description: f.get('description'),
                      commentForPlayers: f.get('comment'),
                      tournamentDefaults: {
                        ...c.tournamentDefaults,
                        fee: Number(f.get('fee')) * 100,
                        settings: { ...c.tournamentDefaults.settings, checkinWindowMinutes: Number(f.get('checkin')), avgMatchMinutes: Number(f.get('avg')) },
                      },
                    },
                  })
                  return t.common.saved
                })
              }}
            >
              <Field label={t.clubreg.name}>
                <input name="name" defaultValue={c.name} required />
              </Field>
              <Field label={t.m.description}>
                <textarea name="description" rows={3} defaultValue={c.description} />
              </Field>
              <Field label={t.clubreg.comment}>
                <textarea name="comment" rows={2} defaultValue={c.commentForPlayers} />
              </Field>
              <h3>{t.clubreg.defaults}</h3>
              <Field label={t.clubreg.defaultFee}>
                <input name="fee" type="number" min="0" defaultValue={(c.tournamentDefaults.fee ?? 0) / 100} />
              </Field>
              <Field label={t.clubreg.defaultCheckin}>
                <input name="checkin" type="number" min="0" defaultValue={c.tournamentDefaults.settings?.checkinWindowMinutes ?? 60} />
              </Field>
              <Field label={t.clubreg.defaultAvg}>
                <input name="avg" type="number" min="5" defaultValue={c.tournamentDefaults.settings?.avgMatchMinutes ?? 20} />
              </Field>
              {profile.notes}
              <button className="button" disabled={profile.busy}>
                {t.common.save}
              </button>
            </form>
          </section>
          <div className="stack">
            {c.requisites && (
              <form
                className="panel form"
                onSubmit={(e) => {
                  const f = fd(e)
                  void req.run(async () => {
                    await api(`/clubs/${c.id}/requisites`, { method: 'PUT', json: { legalName: f.get('legalName'), bin: f.get('bin'), iban: f.get('iban'), bank: f.get('bank') } })
                    return t.common.saved
                  })
                }}
              >
                <h2>{t.clubreg.requisites}</h2>
                <Field label={t.clubreg.legalName}>
                  <input name="legalName" defaultValue={c.requisites.legalName} required />
                </Field>
                <Field label={t.clubreg.bin}>
                  <input name="bin" defaultValue={c.requisites.bin} pattern="\d{12}" required />
                </Field>
                <Field label={t.clubreg.iban}>
                  <input name="iban" defaultValue={c.requisites.iban} required />
                </Field>
                <Field label={t.clubreg.bank}>
                  <input name="bank" defaultValue={c.requisites.bank} />
                </Field>
                {req.notes}
                <button className="button" disabled={req.busy}>
                  {t.common.save}
                </button>
              </form>
            )}
            <section className="panel stack">
              <h2>{t.clubreg.halls}</h2>
              {c.halls.map((h) => (
                <p key={h.id}>
                  <b>{h.name}</b> <span className="muted small">· {h.address} · {h.timezone} · {h.tables} {t.common.tables}</span>
                </p>
              ))}
              <form
                className="form form--cols"
                onSubmit={(e) => {
                  const f = fd(e)
                  void hall.run(async () => {
                    await api(`/clubs/${c.id}/halls`, { method: 'POST', json: { name: f.get('name'), address: f.get('address'), timezone: f.get('timezone') } })
                    state.reload()
                  })
                }}
              >
                <Field label={t.clubreg.hallName}>
                  <input name="name" required />
                </Field>
                <Field label={t.clubreg.address}>
                  <input name="address" minLength={3} required />
                </Field>
                <Field label={t.clubreg.timezone}>
                  <select name="timezone" defaultValue="Asia/Almaty">
                    <option>Asia/Almaty</option>
                    <option>Asia/Aqtobe</option>
                    <option>Asia/Aqtau</option>
                    <option>Asia/Oral</option>
                  </select>
                </Field>
                <div className="field--wide">{hall.notes}</div>
                <button className="button field--wide" disabled={hall.busy}>
                  {t.clubreg.addHall}
                </button>
              </form>
            </section>
          </div>
        </div>
      )}
    </Async>
  )
}
