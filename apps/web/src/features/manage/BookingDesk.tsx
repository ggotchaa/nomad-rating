import { useState } from 'react'
import type { DragEvent } from 'react'
import { utcToZoned, zonedToUtc } from '@nomad/shared'
import { api } from '../../api/client.ts'
import type { Desk, DeskBooking, PlayerSearchItem } from '../../api/types.ts'
import { useApi, useRoom } from '../../app/hooks.ts'
import { errorText, t } from '../../i18n/index.ts'
import { formatDate, formatTenge, formatTime, hhmm, localDate } from '../../i18n/format.ts'
import { Async, Field, Modal, Seg } from '../../ui/kit.tsx'
import { PlayerSearch, useClub } from './ManageLayout.tsx'

const HIDDEN = ['cancelled_by_player', 'cancelled_by_club', 'moved', 'expired']
const weekday = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay() || 7

function PhoneBooking({ hallId, tableId, tableNumber, date, startMinutes, onClose, onDone }: { hallId: number; tableId: number; tableNumber: number; date: string; startMinutes: number; onClose: () => void; onDone: () => void }) {
  const [minutes, setMinutes] = useState(60)
  const [player, setPlayer] = useState<PlayerSearchItem | null>(null)
  const [guest, setGuest] = useState('')
  const [contact, setContact] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      await api(`/halls/${hallId}/bookings`, {
        method: 'POST',
        json: { tableId, start: zonedToUtc(date, startMinutes, 'Asia/Almaty').toISOString(), minutes, ...(player ? { playerId: player.id } : { guestName: guest, guestContact: contact || undefined }) },
      })
      onDone()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal title={t.m.phoneBooking} onClose={onClose}>
      <p className="muted">
        {t.me.table} {tableNumber} · {date} · {hhmm(startMinutes)}
      </p>
      <div className="row">
        {[60, 90, 120, 180].map((m) => (
          <button key={m} className={`button button--sm${m === minutes ? ' button--primary' : ''}`} onClick={() => setMinutes(m)}>
            {t.b.hours(m)}
          </button>
        ))}
      </div>
      {player ? (
        <p className="note row row--between">
          <span>
            {player.name} · {player.rating ?? t.t.calibrating}
          </span>
          <button className="button button--sm" onClick={() => setPlayer(null)}>
            ×
          </button>
        </p>
      ) : (
        <>
          <div className="form form--cols">
            <Field label={t.m.guest}>
              <input value={guest} onChange={(e) => setGuest(e.target.value)} />
            </Field>
            <Field label={t.m.contact}>
              <input value={contact} onChange={(e) => setContact(e.target.value)} inputMode="tel" />
            </Field>
          </div>
          <span className="small muted">{t.m.orPlayer}</span>
          <PlayerSearch onPick={setPlayer} />
        </>
      )}
      {error && <p className="note note--error">{error}</p>}
      <button className="button button--primary" disabled={busy || (!player && guest.trim().length < 2)} onClick={() => void submit()}>
        {t.b.confirm}
      </button>
    </Modal>
  )
}

type MoveOption = { tableId: number; tableNumber: number; start: string; end: string }

/** Move options of a booking (free tables at the same time, then later slots) and cancellation with a notice. */
function Resolve({ bookingId, onDone }: { bookingId: number; onDone: () => void }) {
  const [options, setOptions] = useState<MoveOption[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const run = async (fn: () => Promise<unknown>) => {
    setError(null)
    try {
      await fn()
      onDone()
    } catch (e) {
      setError(errorText(e))
    }
  }
  return (
    <div className="stack">
      <div className="row">
        <button className="button button--sm" onClick={() => void api<MoveOption[]>(`/bookings/${bookingId}/options`).then(setOptions, (e: unknown) => setError(errorText(e)))}>
          {t.desk2.move}…
        </button>
        <button className="button button--sm button--danger" onClick={() => void run(() => api(`/bookings/${bookingId}/status`, { method: 'POST', json: { status: 'cancelled_by_club', reason: t.desk2.conflicts } }))}>
          {t.desk2.cancel}
        </button>
      </div>
      {options && (options.length === 0 ? <p className="muted small">{t.desk2.noOptions}</p> : (
        <div className="row">
          {options.map((o) => (
            <button key={`${o.tableId}${o.start}`} className="button button--sm button--primary" onClick={() => void run(() => api(`/bookings/${bookingId}/move`, { method: 'POST', json: { tableId: o.tableId, start: o.start } }))}>
              {t.me.table} {o.tableNumber} · {formatTime(o.start)}
            </button>
          ))}
        </div>
      ))}
      {error && <p className="note note--error">{error}</p>}
    </div>
  )
}

type Conflict = { id: number; tableId: number; start: string; end: string; who: string | null; playerId: number | null; block: { kind: string; note: string } }

/** Bookings overlapped by a tournament or a closed hall (B-7, 3.4): move or cancel each. */
function Conflicts({ hallId, tables, version, onDone }: { hallId: number; tables: { id: number; number: number }[]; version: number; onDone: () => void }) {
  const state = useApi<Conflict[]>(`/halls/${hallId}/conflicts?v=${version}`)
  if (!state.data?.length) return null
  return (
    <section className="panel panel--warn">
      <h2>{t.desk2.conflicts}</h2>
      <p className="small muted">{t.desk2.conflictsHint}</p>
      {state.data.map((c) => (
        <div key={c.id} className="stack">
          <b>
            {formatDate(c.start)} {formatTime(c.start)}–{formatTime(c.end)} · {t.me.table} {tables.find((x) => x.id === c.tableId)?.number} · {c.who ?? `#${c.playerId}`}
          </b>
          <span className="small muted">
            {t.m.block[c.block.kind] ?? c.block.kind} · {c.block.note}
          </span>
          <Resolve
            bookingId={c.id}
            onDone={() => {
              state.reload()
              onDone()
            }}
          />
        </div>
      ))}
    </section>
  )
}

function CloseHall({ hallId, tables, date, onClose, onDone }: { hallId: number; tables: { id: number; number: number }[]; date: string; onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState({ start: `${date}T00:00`, end: `${date}T23:59`, tableIds: [] as number[], note: '' })
  const [error, setError] = useState<string | null>(null)
  const submit = async () => {
    setError(null)
    try {
      const at = (v: string) => zonedToUtc(v.slice(0, 10), Number(v.slice(11, 13)) * 60 + Number(v.slice(14, 16)), 'Asia/Almaty').toISOString()
      await api(`/halls/${hallId}/blocks`, { method: 'POST', json: { kind: 'closed', tableIds: form.tableIds, start: at(form.start), end: at(form.end), note: form.note } })
      onDone()
    } catch (e) {
      setError(errorText(e))
    }
  }
  return (
    <Modal title={t.desk2.closeTitle} onClose={onClose}>
      <div className="form form--cols">
        <Field label={t.desk2.start}>
          <input type="datetime-local" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} />
        </Field>
        <Field label={t.desk2.end}>
          <input type="datetime-local" value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} />
        </Field>
      </div>
      <Field label={t.desk2.reason}>
        <input value={form.note} maxLength={300} onChange={(e) => setForm({ ...form, note: e.target.value })} />
      </Field>
      <div className="row">
        <button type="button" className={`button button--sm${form.tableIds.length === 0 ? ' button--primary' : ''}`} onClick={() => setForm({ ...form, tableIds: [] })}>
          {t.bset.allTables}
        </button>
        {tables.map((x) => (
          <button key={x.id} type="button" className={`button button--sm${form.tableIds.includes(x.id) ? ' button--primary' : ''}`} onClick={() => setForm({ ...form, tableIds: form.tableIds.includes(x.id) ? form.tableIds.filter((v) => v !== x.id) : [...form.tableIds, x.id] })}>
            {x.number}
          </button>
        ))}
      </div>
      {error && <p className="note note--error">{error}</p>}
      <button className="button button--primary" onClick={() => void submit()}>
        {t.desk2.closeHall}
      </button>
    </Modal>
  )
}

function Week({ hallId, date, onDay }: { hallId: number; date: string; onDay: (date: string) => void }) {
  const state = useApi<Desk>(`/halls/${hallId}/bookings?date=${date}&days=7`)
  useRoom(`hall:${hallId}`, state.reload)
  const days = Array.from({ length: 7 }, (_, i) => localDate(new Date(new Date(`${date}T12:00:00+05:00`).getTime() + i * 86400000)))
  return (
    <Async state={state}>
      {(desk) => (
        <div className="tablewrap">
          <table className="table desk-week">
            <thead>
              <tr>
                <th>{t.me.table}</th>
                {days.map((d) => (
                  <th key={d}>
                    <button className="button button--sm" onClick={() => onDay(d)}>
                      {t.bset.weekdays[weekday(d) - 1]} {d.slice(8)}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {desk.tables.map((tb) => (
                <tr key={tb.id}>
                  <td className="rank">{tb.number}</td>
                  {days.map((d) => {
                    const list = desk.bookings.filter((b) => b.tableId === tb.id && !HIDDEN.includes(b.status) && localDate(new Date(b.start)) === d)
                    const blocked = desk.blocks.some((b) => (b.tableIds.length === 0 || b.tableIds.includes(tb.id)) && localDate(new Date(b.start)) <= d && localDate(new Date(b.end)) >= d)
                    return (
                      <td key={d} className={blocked ? 'is-blocked' : undefined} title={list.map((b) => `${formatTime(b.start)}–${formatTime(b.end)} ${b.who.name ?? b.who.guest ?? ''}`).join('\n')}>
                        {list.length ? t.desk2.bookings(list.length) : ''}
                        {blocked && ' ▦'}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Async>
  )
}

function BookingCard({ b, tableNumber, onClose, onDone }: { b: DeskBooking; tableNumber: number; onClose: () => void; onDone: () => void }) {
  const [error, setError] = useState<string | null>(null)
  const set = async (status: string) => {
    setError(null)
    try {
      await api(`/bookings/${b.id}/status`, { method: 'POST', json: { status } })
      onDone()
    } catch (e) {
      setError(errorText(e))
    }
  }
  return (
    <Modal title={b.who.name ?? b.who.guest ?? '—'} onClose={onClose}>
      <div className="facts">
        <div className="fact">
          <span>{t.me.table}</span>
          <b>{tableNumber}</b>
        </div>
        <div className="fact">
          <span>{t.m.time}</span>
          <b>
            {formatTime(b.start)}–{formatTime(b.end)}
          </b>
        </div>
        <div className="fact">
          <span>{t.b.price}</span>
          <b>{formatTenge(b.price)}</b>
        </div>
        <div className="fact">
          <span>Источник</span>
          <b>{t.m.source[b.source] ?? b.source}</b>
        </div>
      </div>
      {b.who.contact && <p className="muted">{b.who.contact}</p>}
      <span className="chip">{t.b.status[b.status] ?? b.status}</span>
      {error && <p className="note note--error">{error}</p>}
      {b.status === 'confirmed' && (
        <div className="row">
          <button className="button button--primary button--sm" onClick={() => void set('arrived')}>
            {t.m.arrived}
          </button>
          <button className="button button--sm" onClick={() => void set('no_show')}>
            {t.m.noShow}
          </button>
          <button className="button button--danger button--sm" onClick={() => void set('cancelled_by_club')}>
            {t.m.cancelByClub}
          </button>
        </div>
      )}
      {['held', 'confirmed', 'arrived'].includes(b.status) && <Resolve bookingId={b.id} onDone={onDone} />}
    </Modal>
  )
}

export function BookingDesk() {
  const { club } = useClub()
  const hallId = club.halls[0]?.id
  const [date, setDate] = useState(localDate())
  const [cell, setCell] = useState<{ tableId: number; number: number; start: number } | null>(null)
  const [openId, setOpenId] = useState<number | null>(null)
  const [mode, setMode] = useState<'day' | 'week'>('day')
  const [closing, setClosing] = useState(false)
  const [version, setVersion] = useState(0)
  const [moveError, setMoveError] = useState<string | null>(null)
  const state = useApi<Desk>(hallId ? `/halls/${hallId}/bookings?date=${date}` : null)
  useRoom(hallId ? `hall:${hallId}` : null, state.reload)
  const shift = (days: number) => setDate(localDate(new Date(new Date(`${date}T12:00:00+05:00`).getTime() + days * 86400000)))
  const refresh = () => {
    setCell(null)
    setOpenId(null)
    setClosing(false)
    setVersion((v) => v + 1)
    state.reload()
  }
  // Drag to move (B-11): the drop point on a lane gives the table and the start, snapped to 30 minutes.
  const onDrop = async (e: DragEvent<HTMLDivElement>, tableId: number, open: number, span: number, tz: string, d: string) => {
    e.preventDefault()
    const id = Number(e.dataTransfer.getData('text/booking'))
    const offset = Number(e.dataTransfer.getData('text/offset') || 0)
    if (!id) return
    const rect = e.currentTarget.getBoundingClientRect()
    const minutes = Math.round((open + ((e.clientX - rect.left - offset) / rect.width) * span) / 30) * 30
    setMoveError(null)
    try {
      await api(`/bookings/${id}/move`, { method: 'POST', json: { tableId, start: zonedToUtc(d, Math.max(open, minutes), tz).toISOString() } })
      refresh()
    } catch (err) {
      setMoveError(errorText(err))
    }
  }

  return (
    <section className="panel">
      <div className="panel__head">
        <h2>{t.m.desk}</h2>
        <div className="row">
          <Seg
            label={t.m.desk}
            value={mode}
            options={[
              ['day', t.desk2.day],
              ['week', t.desk2.week],
            ]}
            onChange={setMode}
          />
          <button className="button button--sm" onClick={() => setClosing(true)}>
            {t.desk2.closeHall}
          </button>
          <button className="button button--sm" onClick={() => shift(-1)} aria-label="Предыдущий день">
            ←
          </button>
          <input type="date" style={{ width: 'auto' }} value={date} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label={t.m.date} />
          <button className="button button--sm" onClick={() => shift(1)} aria-label="Следующий день">
            →
          </button>
        </div>
      </div>
      {hallId && state.data && <Conflicts hallId={hallId} tables={state.data.tables} version={version} onDone={state.reload} />}
      {closing && hallId && state.data && <CloseHall hallId={hallId} tables={state.data.tables} date={date} onClose={() => setClosing(false)} onDone={refresh} />}
      {moveError && <p className="note note--error">{moveError}</p>}
      {mode === 'week' && hallId ? (
        <Week
          hallId={hallId}
          date={date}
          onDay={(d) => {
            setDate(d)
            setMode('day')
          }}
        />
      ) : (
      <Async state={state}>
        {(desk) => {
          const hours = desk.openingHours[String(weekday(desk.date))]
          if (!hours) return <p className="empty">{t.b.closedDay}</p>
          const span = hours.close - hours.open
          const cols = Math.ceil(span / 60)
          const place = (startIso: string, endIso: string) => {
            const s = utcToZoned(new Date(startIso), desk.timezone)
            const e = utcToZoned(new Date(endIso), desk.timezone)
            const from = Math.max(hours.open, s.date < desk.date ? 0 : s.minutes)
            const to = Math.min(hours.close, e.date > desk.date ? 1440 : e.minutes)
            return { left: `${((from - hours.open) / span) * 100}%`, width: `${(Math.max(0, to - from) / span) * 100}%` }
          }
          const opened = desk.bookings.find((b) => b.id === openId)
          return (
            <>
              <div className="desk">
                <div className="desk__grid">
                  <div className="desk__hours">
                    <span />
                    <div className="desk__scale" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
                      {Array.from({ length: cols }, (_, i) => (
                        <span key={i}>{hhmm(hours.open + i * 60)}</span>
                      ))}
                    </div>
                  </div>
                  {desk.tables.map((tb) => (
                    <div className="desk__row" key={tb.id}>
                      <div className="desk__label">
                        {t.me.table} {tb.number}
                      </div>
                      <div className="desk__lane" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }} onDragOver={(e) => e.preventDefault()} onDrop={(e) => void onDrop(e, tb.id, hours.open, span, desk.timezone, desk.date)}>
                        {Array.from({ length: cols }, (_, i) => (
                          <button key={i} className="cell" aria-label={`${t.me.table} ${tb.number}, ${hhmm(hours.open + i * 60)}`} onClick={() => setCell({ tableId: tb.id, number: tb.number, start: hours.open + i * 60 })} />
                        ))}
                        {desk.blocks
                          .filter((b) => b.tableIds.length === 0 || b.tableIds.includes(tb.id))
                          .map((b) => (
                            <div key={`b${b.id}`} className="bk bk--block" style={place(b.start, b.end)} title={b.note}>
                              <b>{t.m.block[b.kind] ?? b.kind}</b>
                              {b.note}
                            </div>
                          ))}
                        {desk.bookings
                          .filter((b) => b.tableId === tb.id && !HIDDEN.includes(b.status))
                          .map((b) => (
                            <button
                              key={b.id}
                              className={`bk bk--${b.status}`}
                              style={place(b.start, b.end)}
                              draggable={['held', 'confirmed'].includes(b.status)}
                              onDragStart={(e) => {
                                e.dataTransfer.setData('text/booking', String(b.id))
                                e.dataTransfer.setData('text/offset', String(e.clientX - e.currentTarget.getBoundingClientRect().left))
                              }}
                              onClick={() => setOpenId(b.id)}
                            >
                              <b>{b.who.name ?? b.who.guest}</b>
                              {formatTime(b.start)}–{formatTime(b.end)}
                            </button>
                          ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="legend">
                <span>
                  <i style={{ borderColor: 'var(--holo)', background: 'rgba(94,242,255,.18)' }} />
                  {t.b.status.confirmed}
                </span>
                <span>
                  <i style={{ borderColor: 'var(--ok)', background: 'rgba(61,255,168,.16)' }} />
                  {t.m.arrived}
                </span>
                <span>
                  <i style={{ borderColor: 'var(--rubber)', background: 'rgba(255,61,98,.16)' }} />
                  {t.m.noShow}
                </span>
                <span>
                  <i style={{ borderColor: 'var(--holo-2)', borderStyle: 'dashed' }} />
                  {t.m.block.tournament} / {t.m.block.training}
                </span>
                <span className="muted">Нажмите на пустую ячейку — {t.m.phoneBooking.toLowerCase()}. {t.desk2.dragHint}</span>
              </div>
              {cell && hallId && <PhoneBooking hallId={hallId} tableId={cell.tableId} tableNumber={cell.number} date={desk.date} startMinutes={cell.start} onClose={() => setCell(null)} onDone={refresh} />}
              {opened && <BookingCard b={opened} tableNumber={desk.tables.find((x) => x.id === opened.tableId)?.number ?? 0} onClose={() => setOpenId(null)} onDone={refresh} />}
            </>
          )
        }}
      </Async>
      )}
    </section>
  )
}
