import { useState } from 'react'
import { utcToZoned, zonedToUtc } from '@nomad/shared'
import { api } from '../../api/client.ts'
import type { Desk, DeskBooking, PlayerSearchItem } from '../../api/types.ts'
import { useApi, useRoom } from '../../app/hooks.ts'
import { errorText, t } from '../../i18n/index.ts'
import { formatTenge, formatTime, hhmm, localDate } from '../../i18n/format.ts'
import { Async, Field, Modal } from '../../ui/kit.tsx'
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
    </Modal>
  )
}

export function BookingDesk() {
  const { club } = useClub()
  const hallId = club.halls[0]?.id
  const [date, setDate] = useState(localDate())
  const [cell, setCell] = useState<{ tableId: number; number: number; start: number } | null>(null)
  const [openId, setOpenId] = useState<number | null>(null)
  const state = useApi<Desk>(hallId ? `/halls/${hallId}/bookings?date=${date}` : null)
  useRoom(hallId ? `hall:${hallId}` : null, state.reload)
  const shift = (days: number) => setDate(localDate(new Date(new Date(`${date}T12:00:00+05:00`).getTime() + days * 86400000)))
  const refresh = () => {
    setCell(null)
    setOpenId(null)
    state.reload()
  }

  return (
    <section className="panel">
      <div className="panel__head">
        <h2>{t.m.desk}</h2>
        <div className="row">
          <button className="button button--sm" onClick={() => shift(-1)} aria-label="Предыдущий день">
            ←
          </button>
          <input type="date" style={{ width: 'auto' }} value={date} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label={t.m.date} />
          <button className="button button--sm" onClick={() => shift(1)} aria-label="Следующий день">
            →
          </button>
        </div>
      </div>
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
                      <div className="desk__lane" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
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
                            <button key={b.id} className={`bk bk--${b.status}`} style={place(b.start, b.end)} onClick={() => setOpenId(b.id)}>
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
                <span className="muted">Нажмите на пустую ячейку — {t.m.phoneBooking.toLowerCase()}</span>
              </div>
              {cell && hallId && <PhoneBooking hallId={hallId} tableId={cell.tableId} tableNumber={cell.number} date={desk.date} startMinutes={cell.start} onClose={() => setCell(null)} onDone={refresh} />}
              {opened && <BookingCard b={opened} tableNumber={desk.tables.find((x) => x.id === opened.tableId)?.number ?? 0} onClose={() => setOpenId(null)} onDone={refresh} />}
            </>
          )
        }}
      </Async>
    </section>
  )
}
