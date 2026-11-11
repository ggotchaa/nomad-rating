import { useMemo, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router'
import { api } from '../../api/client.ts'
import type { Availability, AvailabilityTable, BookingResult, ClubDetail } from '../../api/types.ts'
import { useSession } from '../../app/auth.tsx'
import { useApi, useRoom } from '../../app/hooks.ts'
import { errorText, t } from '../../i18n/index.ts'
import { formatDate, formatTenge, formatTime, localDate } from '../../i18n/format.ts'
import { Async } from '../../ui/kit.tsx'
import { HallPlan } from './HallPlan.tsx'
import type { TableState } from './HallPlan.tsx'

const dayList = (count: number) =>
  Array.from({ length: count }, (_, i) => {
    const d = new Date(Date.now() + i * 86400000)
    return { date: localDate(d), weekday: new Intl.DateTimeFormat('ru-RU', { timeZone: 'Asia/Almaty', weekday: 'short' }).format(d), day: new Intl.DateTimeFormat('ru-RU', { timeZone: 'Asia/Almaty', day: 'numeric' }).format(d) }
  })

const tableState = (tb: AvailabilityTable): TableState => {
  if (!tb.bookable || tb.status !== 'active') return 'off'
  const free = tb.slots.filter((s) => s.free).length
  return free === 0 ? 'busy' : free === tb.slots.length ? 'free' : 'partly'
}

function Picker({ hallId }: { hallId: number }) {
  const { me } = useSession()
  const location = useLocation()
  const [date, setDate] = useState(localDate())
  const [tableId, setTableId] = useState<number | null>(null)
  const [start, setStart] = useState<string | null>(null)
  const [minutes, setMinutes] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<BookingResult | null>(null)
  const state = useApi<Availability>(`/halls/${hallId}/availability?date=${date}`)
  useRoom(`hall:${hallId}`, state.reload)
  const a = state.data
  const days = useMemo(() => dayList(Math.min(a?.settings.horizonDays ?? 14, 14)), [a?.settings.horizonDays])
  const table = a?.tables.find((x) => x.id === tableId) ?? null

  const pick = (id: number) => {
    setTableId(id)
    setStart(null)
    setError(null)
  }
  const startIndex = table && start ? table.slots.findIndex((s) => s.start === start) : -1
  const durations: number[] = []
  if (a && table && startIndex >= 0) {
    let run = 0
    for (let i = startIndex; i < table.slots.length && table.slots[i]!.free; i++) run += a.settings.slotMinutes
    for (let m = a.settings.minMinutes; m <= Math.min(a.settings.maxMinutes, run); m += a.settings.slotMinutes) durations.push(m)
  }
  const chosen = durations.includes(minutes) ? minutes : (durations[0] ?? 0)
  const price = a && table && startIndex >= 0 ? table.slots.slice(startIndex, startIndex + chosen / a.settings.slotMinutes).reduce((sum, s) => sum + s.price, 0) : 0

  const submit = async () => {
    if (!table || !start || !chosen) return
    setBusy(true)
    setError(null)
    try {
      setDone(await api<BookingResult>('/bookings', { method: 'POST', json: { hallId, tableId: table.id, start, minutes: chosen } }))
      state.reload()
    } catch (e) {
      setError(errorText(e))
      setStart(null)
      state.reload()
    } finally {
      setBusy(false)
    }
  }

  if (done)
    return (
      <section className="panel">
        <span className="chip chip--ok">{t.b.done}</span>
        <h2>
          {t.me.table} {done.tableNumber} · {formatDate(done.start)}, {formatTime(done.start)}–{formatTime(done.end)}
        </h2>
        <p className="muted">
          {formatTenge(done.price)} · {t.b.doneText}
        </p>
        <div className="row">
          <Link className="button button--primary" to="/me">
            {t.b.toCabinet}
          </Link>
          <button
            className="button"
            onClick={() => {
              setDone(null)
              setStart(null)
            }}
          >
            {t.c.book}
          </button>
        </div>
      </section>
    )

  return (
    <>
      <div className="days" role="group" aria-label={t.b.pickDate}>
        {days.map((d) => (
          <button
            key={d.date}
            aria-pressed={d.date === date}
            onClick={() => {
              setDate(d.date)
              setStart(null)
            }}
          >
            {d.weekday}
            <b>{d.day}</b>
          </button>
        ))}
      </div>
      <Async state={state} skeleton={2}>
        {(av) =>
          !av.open ? (
            <p className="empty">{t.b.closedDay}</p>
          ) : (
            <div className="grid grid--2">
              <section className="panel">
                <div className="panel__head">
                  <h2>{t.c.hallPlan}</h2>
                  <div className="legend">
                    <span>
                      <i style={{ borderColor: 'var(--ok)', background: 'rgba(61,255,168,.2)' }} />
                      {t.b.legend.free}
                    </span>
                    <span>
                      <i style={{ borderColor: 'var(--holo)', background: 'rgba(94,242,255,.16)' }} />
                      {t.b.legend.partly}
                    </span>
                    <span>
                      <i style={{ borderColor: 'var(--rubber)', background: 'rgba(255,61,98,.16)' }} />
                      {t.b.legend.busy}
                    </span>
                    <span>
                      <i style={{ borderColor: 'var(--text-3)' }} />
                      {t.b.legend.off}
                    </span>
                  </div>
                </div>
                <HallPlan plan={av.plan} tables={av.tables} mode="booking" state={(id) => tableState(av.tables.find((x) => x.id === id)!)} selected={tableId} onSelect={pick} />
                <div className="row">
                  {av.tables
                    .filter((x) => tableState(x) !== 'off')
                    .map((x) => (
                      <button key={x.id} className={`button button--sm${x.id === tableId ? ' button--primary' : ''}`} disabled={tableState(x) === 'busy'} onClick={() => pick(x.id)}>
                        {x.number}
                      </button>
                    ))}
                </div>
              </section>
              <section className="panel">
                {!table ? (
                  <p className="muted">{t.b.pickTable}</p>
                ) : (
                  <>
                    <h2>{table.label}</h2>
                    <div className="stack">
                      <h3>{t.b.start}</h3>
                      <div className="slots">
                        {table.slots.map((s) => (
                          <button key={s.start} disabled={!s.free} className={s.start === start ? 'is-sel' : ''} title={s.free ? formatTenge(s.price) : t.b.reason[s.reason ?? 'booked']} onClick={() => setStart(s.start)}>
                            {formatTime(s.start)}
                          </button>
                        ))}
                      </div>
                    </div>
                    {start && durations.length > 0 && (
                      <>
                        <div className="stack">
                          <h3>{t.b.duration}</h3>
                          <div className="row">
                            {durations.map((m) => (
                              <button key={m} className={`button button--sm${m === chosen ? ' button--primary' : ''}`} onClick={() => setMinutes(m)}>
                                {t.b.hours(m)}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className="total">
                          <span className="muted">
                            {t.b.price} · {t.b.payAtClub.toLowerCase()}
                          </span>
                          <b>{formatTenge(price)}</b>
                        </div>
                        {me.player ? (
                          <button className="button button--primary button--block" disabled={busy} onClick={() => void submit()}>
                            {t.b.confirm}
                          </button>
                        ) : (
                          <Link className="button button--primary button--block" to="/login" state={{ from: location.pathname }}>
                            {t.b.loginFirst}
                          </Link>
                        )}
                      </>
                    )}
                    {start && durations.length === 0 && <p className="note">{t.errors['booking.invalid']}</p>}
                  </>
                )}
                {error && <p className="note note--error">{error}</p>}
              </section>
            </div>
          )
        }
      </Async>
    </>
  )
}

export function Booking() {
  const { slug } = useParams()
  const club = useApi<ClubDetail>(`/clubs/${slug}`)
  return (
    <main className="page">
      <Async state={club} skeleton={2}>
        {(c) => (
          <>
            <header className="pagehead">
              <Link className="crumb" to={`/club/${c.slug}`}>
                ← {c.name}
              </Link>
              <h1>{t.b.title}</h1>
              <p>{c.halls[0]?.address}</p>
            </header>
            {c.halls[0] ? <Picker hallId={c.halls[0].id} /> : <p className="empty">—</p>}
          </>
        )}
      </Async>
    </main>
  )
}
