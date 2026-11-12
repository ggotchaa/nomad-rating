import { useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { api } from '../../api/client.ts'
import type { BookingSettings, ClubDetail, Hall, HallPlanData, HallTable, OpeningHours } from '../../api/types.ts'
import { useApi } from '../../app/hooks.ts'
import { errorText, t } from '../../i18n/index.ts'
import { hhmm, parseHhmm } from '../../i18n/format.ts'
import { Async, Field } from '../../ui/kit.tsx'
import { PlanEditor } from '../booking/PlanEditor.tsx'
import { BlocksSection, TariffsEditor } from './BookingRules.tsx'
import { useClub } from './ManageLayout.tsx'

function Section({ title, save, children }: { title: string; save: () => Promise<unknown>; children: ReactNode }) {
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setStatus(null)
    try {
      await save()
      setStatus({ ok: true, text: t.common.saved })
    } catch (err) {
      setStatus({ ok: false, text: errorText(err) })
    } finally {
      setBusy(false)
    }
  }
  return (
    <form className="panel" onSubmit={(e) => void onSubmit(e)}>
      <h2>{title}</h2>
      {children}
      {status && <p className={`note ${status.ok ? 'note--ok' : 'note--error'}`}>{status.text}</p>}
      <div>
        <button className="button button--primary button--sm" disabled={busy}>
          {t.common.save}
        </button>
      </div>
    </form>
  )
}

function Editor({ club, hall: initial, reload }: { club: ClubDetail; hall: Hall; reload: () => void }) {
  const [name, setName] = useState(club.name)
  const [description, setDescription] = useState(club.description)
  const [hall, setHall] = useState({ address: initial.address, howToFind: initial.howToFind, commentForPlayers: initial.commentForPlayers })
  const [hours, setHours] = useState<OpeningHours>(initial.openingHours)
  const [tables, setTables] = useState<HallTable[]>(initial.tables)
  const [booking, setBooking] = useState<BookingSettings>(initial.booking)
  const [plan, setPlan] = useState<HallPlanData>(initial.plan)
  const setTable = (id: number, patch: Partial<HallTable>) => setTables((list) => list.map((x) => (x.id === id ? { ...x, ...patch } : x)))
  const num = (key: keyof BookingSettings, scale = 1) => ({
    type: 'number' as const,
    min: 0,
    value: (booking[key] as number) / scale,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setBooking({ ...booking, [key]: Math.round(Number(e.target.value) * scale) }),
  })

  return (
    <div className="grid grid--half">
      <div className="stack">
        <Section title={t.m.clubProfile} save={() => api(`/clubs/${club.id}`, { method: 'PATCH', json: { name, description } }).then(reload)}>
          <div className="form">
            <Field label={t.m.name}>
              <input value={name} onChange={(e) => setName(e.target.value)} required minLength={2} />
            </Field>
            <Field label={t.m.description}>
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} />
            </Field>
          </div>
        </Section>
        <Section title={`${t.m.hall} · ${initial.name}`} save={() => api(`/halls/${initial.id}`, { method: 'PATCH', json: { ...hall, openingHours: hours } })}>
          <div className="form">
            <Field label={t.c.address}>
              <input value={hall.address} onChange={(e) => setHall({ ...hall, address: e.target.value })} />
            </Field>
            <Field label={t.c.howToFind}>
              <textarea value={hall.howToFind} onChange={(e) => setHall({ ...hall, howToFind: e.target.value })} />
            </Field>
            <Field label={t.c.comment}>
              <textarea value={hall.commentForPlayers} onChange={(e) => setHall({ ...hall, commentForPlayers: e.target.value })} />
            </Field>
          </div>
          <h3>{t.m.openingHours}</h3>
          <div className="stack">
            {[1, 2, 3, 4, 5, 6, 7].map((d) => {
              const h = hours[String(d)]
              return (
                <div className="hours" key={d}>
                  <span className="muted">{t.c.days[d]}</span>
                  <input type="time" aria-label={`${t.c.days[d]} открытие`} disabled={!h} value={hhmm(h?.open ?? 540)} onChange={(e) => setHours({ ...hours, [d]: { open: parseHhmm(e.target.value), close: h?.close ?? 1320 } })} />
                  <input type="time" aria-label={`${t.c.days[d]} закрытие`} disabled={!h} value={hhmm(h?.close ?? 1320)} onChange={(e) => setHours({ ...hours, [d]: { open: h?.open ?? 540, close: parseHhmm(e.target.value) } })} />
                  <label className="check">
                    <input type="checkbox" checked={Boolean(h)} onChange={(e) => setHours({ ...hours, [d]: e.target.checked ? { open: 540, close: 1320 } : null })} />
                  </label>
                </div>
              )
            })}
          </div>
        </Section>
      </div>
      <div className="stack">
        <Section
          title={t.m.tablesTitle}
          save={async () => {
            await api(`/halls/${initial.id}`, { method: 'PATCH', json: { plan } })
            const saved = await api<Hall>(`/halls/${initial.id}/tables`, {
              method: 'PUT',
              json: { tables: tables.map((x) => ({ id: x.id > 0 ? x.id : undefined, number: x.number, label: x.label === `Стол ${x.number}` ? null : x.label, x: x.x, y: x.y, rotation: x.rotation, bookable: x.bookable, pricePerHour: x.pricePerHour, model: x.model, status: x.status })) },
            })
            setTables(saved.tables)
          }}
        >
          <PlanEditor
            plan={plan}
            tables={tables}
            onChange={(nextTables, nextPlan) => {
              setTables(nextTables)
              setPlan(nextPlan)
            }}
          />
          <div className="tablewrap">
            <table className="table">
              <thead>
                <tr>
                  <th>№</th>
                  <th>{t.m.name}</th>
                  <th>{t.m.bookable}</th>
                  <th>{t.m.priceHour}</th>
                </tr>
              </thead>
              <tbody>
                {tables.map((x) => (
                  <tr key={x.id}>
                    <td className="rank">{x.number}</td>
                    <td>
                      <input aria-label={`${t.m.name} ${x.number}`} value={x.label} onChange={(e) => setTable(x.id, { label: e.target.value })} />
                    </td>
                    <td>
                      <input type="checkbox" aria-label={`${t.m.bookable} ${x.number}`} checked={x.bookable} onChange={(e) => setTable(x.id, { bookable: e.target.checked })} />
                    </td>
                    <td>
                      <input type="number" min={0} step={100} aria-label={`${t.m.priceHour} ${x.number}`} placeholder={String(booking.defaultPricePerHour / 100)} value={x.pricePerHour == null ? '' : x.pricePerHour / 100} onChange={(e) => setTable(x.id, { pricePerHour: e.target.value === '' ? null : Math.round(Number(e.target.value) * 100) })} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
        <Section title={t.m.bookingSettings} save={() => api(`/halls/${initial.id}/booking-settings`, { method: 'PUT', json: booking })}>
          <div className="form form--cols">
            <Field label={t.m.slot}>
              <select value={booking.slotMinutes} onChange={(e) => setBooking({ ...booking, slotMinutes: Number(e.target.value) as 30 | 60 })}>
                <option value={30}>30</option>
                <option value={60}>60</option>
              </select>
            </Field>
            <Field label={t.m.defaultPrice}>
              <input {...num('defaultPricePerHour', 100)} step={100} />
            </Field>
            <Field label={t.m.minDur}>
              <input {...num('minMinutes')} step={30} />
            </Field>
            <Field label={t.m.maxDur}>
              <input {...num('maxMinutes')} step={30} />
            </Field>
            <Field label={t.m.horizon}>
              <input {...num('horizonDays')} />
            </Field>
            <Field label={t.m.freeCancel}>
              <input {...num('freeCancelHours')} />
            </Field>
          </div>
          <TariffsEditor tariffs={booking.tariffs} onChange={(tariffs) => setBooking({ ...booking, tariffs })} />
        </Section>
        <BlocksSection hallId={initial.id} tables={tables} />
      </div>
    </div>
  )
}

export function HallSettings() {
  const { club } = useClub()
  const state = useApi<ClubDetail>(`/clubs/${club.slug}`)
  return <Async state={state}>{(c) => (c.halls[0] ? <Editor key={c.id} club={c} hall={c.halls[0]} reload={state.reload} /> : <p className="empty">—</p>)}</Async>
}
