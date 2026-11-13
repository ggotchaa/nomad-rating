import { useState } from 'react'
import { api } from '../../api/client.ts'
import type { FormatOption } from '../../api/types.ts'
import { useSession } from '../../app/auth.tsx'
import { useApi } from '../../app/hooks.ts'
import { t } from '../../i18n/index.ts'
import { locale } from '../../i18n/locale.ts'
import { Async, Field } from '../../ui/kit.tsx'
import { useAction } from '../account/AccountFlows.tsx'
import { useClub } from './ManageLayout.tsx'

type ClubManage = {
  id: number
  name: string
  description: string
  cityId: number
  logoUrl: string | null
  coverUrl: string | null
  telegramUrl: string | null
  instagramUrl: string | null
  contactEmail: string | null
  contactTelegram: string | null
  status: string
  statusReason: string | null
  commentForPlayers: string
  tournamentDefaults: ClubDefaults
  requisites: Record<string, string> | null
  role: 'organizer' | 'helper'
  halls: { id: number; name: string; address: string; timezone: string; isDefault: boolean; tables: number }[]
}

export type ClubDefaults = {
  fee?: number
  refundRules?: { hoursBefore: number; percent: number }[]
  template?: string
  maxParticipants?: number
  settings?: { checkinWindowMinutes?: number; avgMatchMinutes?: number; scoreEntry?: 'staff' | 'players'; sameDayRegistration?: boolean }
}

const STATUS_TONE: Record<string, string> = { active: 'chip--ok', review: 'chip--warn', rejected: 'chip--bad', blocked: 'chip--bad', draft: '' }
const fd = (e: React.FormEvent<HTMLFormElement>) => {
  e.preventDefault()
  return new FormData(e.currentTarget)
}
const opt = (v: FormDataEntryValue | null) => String(v ?? '').trim() || null

function ImageUpload({ clubId, kind, url }: { clubId: number; kind: 'logo' | 'cover'; url: string | null }) {
  const [current, setCurrent] = useState(url)
  const upload = useAction()
  return (
    <Field label={kind === 'logo' ? t.clubreg.logo : t.clubreg.cover}>
      {current && <img src={current} alt="" height={kind === 'logo' ? 80 : 120} style={{ objectFit: 'cover', borderRadius: 12, maxWidth: '100%' }} />}
      <input
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void upload.run(async () => setCurrent((await api<{ url: string }>(`/clubs/${clubId}/media/${kind}`, { method: 'POST', body: file, headers: { 'Content-Type': file.type } })).url))
        }}
      />
      {upload.notes}
    </Field>
  )
}

function RefundRules({ value, onChange }: { value: { hoursBefore: number; percent: number }[]; onChange: (v: { hoursBefore: number; percent: number }[]) => void }) {
  return (
    <fieldset>
      <legend>{t.clubreg.defaultRefund}</legend>
      {value.map((rule, i) => (
        <div className="row" key={i}>
          <input type="number" min={0} aria-label={t.ctor.refundHours} value={rule.hoursBefore} onChange={(e) => onChange(value.map((x, k) => (k === i ? { ...x, hoursBefore: Number(e.target.value) } : x)))} />
          <input type="number" min={0} max={100} aria-label={t.ctor.refundPercent} value={rule.percent} onChange={(e) => onChange(value.map((x, k) => (k === i ? { ...x, percent: Number(e.target.value) } : x)))} />
          <span className="small muted">{t.ctor.refundRule(rule.hoursBefore, rule.percent)}</span>
          <button type="button" className="button button--sm" onClick={() => onChange(value.filter((_, k) => k !== i))}>
            {t.ctor.remove}
          </button>
        </div>
      ))}
      <button type="button" className="button button--sm" onClick={() => onChange([...value, { hoursBefore: 0, percent: 0 }])}>
        +
      </button>
    </fieldset>
  )
}

export function ClubSettings() {
  const { club } = useClub()
  const state = useApi<ClubManage>(`/clubs/${club.id}/manage`)
  const formats = useApi<FormatOption[]>('/formats')
  const clubTemplates = useApi<{ id: number; name: string }[]>(`/clubs/${club.id}/format-templates`)
  const { cities } = useSession()
  const [refund, setRefund] = useState<{ hoursBefore: number; percent: number }[] | null>(null)
  const status = useAction()
  const profile = useAction()
  const req = useAction()
  const hall = useAction()
  return (
    <Async state={state}>
      {(c) => {
        const d = c.tournamentDefaults
        const rules = refund ?? d.refundRules ?? [{ hoursBefore: 24, percent: 100 }]
        return (
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
                      cityId: Number(f.get('cityId')),
                      telegramUrl: opt(f.get('telegramUrl')),
                      instagramUrl: opt(f.get('instagramUrl')),
                      contactTelegram: opt(f.get('contactTelegram')),
                      contactEmail: opt(f.get('contactEmail')),
                      commentForPlayers: f.get('comment'),
                      tournamentDefaults: {
                        ...d,
                        fee: Number(f.get('fee')) * 100,
                        refundRules: rules,
                        template: String(f.get('template')),
                        maxParticipants: Number(f.get('max')),
                        settings: {
                          ...d.settings,
                          checkinWindowMinutes: Number(f.get('checkin')),
                          avgMatchMinutes: Number(f.get('avg')),
                          scoreEntry: f.get('scoreEntry') === 'players' ? 'players' : 'staff',
                          sameDayRegistration: f.get('sameDay') === 'on',
                        },
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
              <Field label={t.common.city}>
                <select name="cityId" defaultValue={c.cityId}>
                  {cities.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name[locale]}
                      {x.regionName ? ` · ${x.regionName[locale]}` : ''}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t.clubreg.telegramChannel}>
                <input name="telegramUrl" defaultValue={c.telegramUrl ?? ''} placeholder="https://t.me/…" maxLength={200} />
              </Field>
              <Field label={t.clubreg.instagram}>
                <input name="instagramUrl" defaultValue={c.instagramUrl ?? ''} placeholder="https://instagram.com/…" maxLength={200} />
              </Field>
              <h3>{t.clubreg.contacts}</h3>
              <Field label={t.clubreg.contactTelegram}>
                <input name="contactTelegram" defaultValue={c.contactTelegram ?? ''} placeholder="@club" maxLength={100} />
              </Field>
              <Field label={t.clubreg.contactEmail}>
                <input name="contactEmail" type="email" defaultValue={c.contactEmail ?? ''} />
              </Field>
              <Field label={t.clubreg.comment}>
                <textarea name="comment" rows={2} defaultValue={c.commentForPlayers} />
              </Field>
              <h3>{t.clubreg.defaults}</h3>
              <Field label={t.clubreg.defaultFee}>
                <input name="fee" type="number" min="0" defaultValue={(d.fee ?? 0) / 100} />
              </Field>
              <RefundRules value={rules} onChange={setRefund} />
              <Field label={t.clubreg.defaultTemplate}>
                {formats.data && clubTemplates.data ? (
                  <select name="template" defaultValue={d.template ?? 'gs1'}>
                    {formats.data.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name}
                      </option>
                    ))}
                    {clubTemplates.data.length > 0 && (
                      <optgroup label={t.ctor.clubTemplates}>
                        {clubTemplates.data.map((x) => (
                          <option key={x.id} value={`club:${x.id}`}>
                            {x.name}
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                ) : (
                  <input name="template" type="hidden" value={d.template ?? 'gs1'} />
                )}
              </Field>
              <Field label={t.clubreg.defaultMax}>
                <input name="max" type="number" min="4" max="256" defaultValue={d.maxParticipants ?? 16} />
              </Field>
              <Field label={t.clubreg.defaultCheckin}>
                <input name="checkin" type="number" min="10" max="240" defaultValue={d.settings?.checkinWindowMinutes ?? 60} />
              </Field>
              <Field label={t.clubreg.defaultAvg}>
                <input name="avg" type="number" min="5" max="90" defaultValue={d.settings?.avgMatchMinutes ?? 20} />
              </Field>
              <Field label={t.clubreg.defaultScoreEntry}>
                <select name="scoreEntry" defaultValue={d.settings?.scoreEntry ?? 'staff'}>
                  <option value="staff">{t.clubreg.scoreStaff}</option>
                  <option value="players">{t.clubreg.scorePlayers}</option>
                </select>
              </Field>
              <label className="check">
                <input name="sameDay" type="checkbox" defaultChecked={d.settings?.sameDayRegistration ?? false} /> {t.clubreg.defaultSameDay}
              </label>
              {profile.notes}
              <button className="button" disabled={profile.busy}>
                {t.common.save}
              </button>
            </form>
          </section>
          <div className="stack">
            <section className="panel form">
              <ImageUpload clubId={c.id} kind="logo" url={c.logoUrl} />
              <ImageUpload clubId={c.id} kind="cover" url={c.coverUrl} />
            </section>
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
        )
      }}
    </Async>
  )
}
