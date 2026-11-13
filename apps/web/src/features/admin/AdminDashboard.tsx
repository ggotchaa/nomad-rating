import { useState } from 'react'
import { Link } from 'react-router'
import { useApi } from '../../app/hooks.ts'
import { formatTenge, localDate } from '../../i18n/format.ts'
import { t } from '../../i18n/index.ts'
import { Async, Field } from '../../ui/kit.tsx'

type Money = { expected: number; collected: number; commission: number }
type Dashboard = {
  from: string
  to: string
  tournaments: Record<string, number>
  activePlayers: number
  bookings: Record<string, number>
  money: Money & { bySource: (Money & { source: keyof typeof t.finance.sources })[] }
  queues: { clubs: number; merges: number; rttf: number; disputes: number }
}

const daysAgo = (n: number) => localDate(new Date(Date.now() - n * 86400_000))
const total = (r: Record<string, number>) => Object.values(r).reduce((s, x) => s + x, 0)

export function AdminDashboard() {
  const [period, setPeriod] = useState({ from: daysAgo(29), to: localDate() })
  const state = useApi<Dashboard>(`/admin/dashboard?from=${period.from}&to=${period.to}`)
  return (
    <div className="stack">
      <div className="row">
        <Field label={t.finance.from}>
          <input type="date" value={period.from} onChange={(e) => e.target.value && setPeriod({ ...period, from: e.target.value })} />
        </Field>
        <Field label={t.finance.to}>
          <input type="date" value={period.to} onChange={(e) => e.target.value && setPeriod({ ...period, to: e.target.value })} />
        </Field>
      </div>
      <Async state={state}>
        {(d) => (
          <div className="grid grid--half">
            <section className="panel stack">
              <h2>{t.admin.activity}</h2>
              <p className="row row--between">
                {t.admin.tournaments} <b>{total(d.tournaments)}</b>
              </p>
              <p className="small muted">{Object.entries(d.tournaments).map(([s, n]) => `${t.t.status[s] ?? s}: ${n}`).join(' · ') || '—'}</p>
              <p className="row row--between">
                {t.admin.activePlayers} <b>{d.activePlayers}</b>
              </p>
              <p className="row row--between">
                {t.admin.bookings} <b>{total(d.bookings)}</b>
              </p>
              <p className="small muted">{Object.entries(d.bookings).map(([s, n]) => `${s}: ${n}`).join(' · ') || '—'}</p>
            </section>
            <section className="panel stack">
              <h2>{t.admin.money}</h2>
              <p className="row row--between">
                {t.admin.expected} <b>{formatTenge(d.money.expected)}</b>
              </p>
              <p className="row row--between">
                {t.finance.collected} <b>{formatTenge(d.money.collected)}</b>
              </p>
              <p className="row row--between">
                {t.admin.commissionAccrued} <b>{formatTenge(d.money.commission)}</b>
              </p>
              {d.money.bySource.map((s) => (
                <p key={s.source} className="small muted">
                  {t.finance.sources[s.source] ?? s.source}: {formatTenge(s.expected)} / {formatTenge(s.collected)} · {formatTenge(s.commission)}
                </p>
              ))}
              <p className="small muted">{t.finance.atClub}</p>
            </section>
            <section className="panel stack">
              <h2>{t.admin.queues}</h2>
              {(
                [
                  ['clubs', t.admin.clubs],
                  ['merges', t.admin.merges],
                  ['rttf', t.admin.rttf],
                  ['disputes', t.admin2.disputes],
                ] as const
              ).map(([k, label]) => (
                <p key={k} className="row row--between">
                  <Link to={k}>{label}</Link> <b>{d.queues[k]}</b>
                </p>
              ))}
            </section>
          </div>
        )}
      </Async>
    </div>
  )
}
