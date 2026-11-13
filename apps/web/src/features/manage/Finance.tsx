import { useState } from 'react'
import { useApi } from '../../app/hooks.ts'
import { t } from '../../i18n/index.ts'
import { formatDateTime, formatTenge, localDate } from '../../i18n/format.ts'

import { Async, Field } from '../../ui/kit.tsx'
import { useClub } from './ManageLayout.tsx'

type Source = 'tournament_entry' | 'booking' | 'season'
type Sum = { gross: number; commission: number; net: number; count: number }
type FinanceRow = Sum & { id: number; date: string; source: Source; title: string | null; payer: string | null; amount: number; status: keyof typeof t.finance.statuses; method: keyof typeof t.finance.methods }
type FinanceData = { from: string; to: string; bySource: (Sum & { source: Source })[]; totals: Sum; rows: FinanceRow[]; total: number }

const monthStart = () => `${localDate().slice(0, 8)}01`

export function Finance() {
  const { club } = useClub()
  const [filters, setFilters] = useState({ from: monthStart(), to: localDate(), source: '' })
  const [offset, setOffset] = useState(0)
  const qs = new URLSearchParams(Object.entries(filters).filter(([, v]) => v)).toString()
  const state = useApi<FinanceData>(`/clubs/${club.id}/finance?limit=50&offset=${offset}&${qs}`)
  const set = (patch: Partial<typeof filters>) => {
    setFilters({ ...filters, ...patch })
    setOffset(0)
  }
  return (
    <section className="panel stack">
      <h2>{t.finance.title}</h2>
      <p className="note">{t.finance.atClub}</p>
      <div className="row">
        <Field label={t.finance.from}>
          <input type="date" value={filters.from} onChange={(e) => set({ from: e.target.value })} />
        </Field>
        <Field label={t.finance.to}>
          <input type="date" value={filters.to} onChange={(e) => set({ to: e.target.value })} />
        </Field>
        <Field label={t.finance.source}>
          <select value={filters.source} onChange={(e) => set({ source: e.target.value })}>
            <option value="">{t.finance.allSources}</option>
            {(Object.keys(t.finance.sources) as Source[]).map((s) => (
              <option key={s} value={s}>
                {t.finance.sources[s]}
              </option>
            ))}
          </select>
        </Field>
        <a className="button button--sm" href={`/api/clubs/${club.id}/finance/export?${qs}`} download>
          {t.finance.export}
        </a>
      </div>
      <Async state={state}>
        {(d) => (
          <>
            <div className="tablewrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>{t.finance.source}</th>
                    <th>{t.finance.count}</th>
                    <th>{t.finance.gross}</th>
                    <th>{t.finance.commission}</th>
                    <th>{t.finance.net}</th>
                  </tr>
                </thead>
                <tbody>
                  {[...d.bySource.map((s) => [t.finance.sources[s.source], s] as const), [t.finance.total, d.totals] as const].map(([label, s]) => (
                    <tr key={label}>
                      <td>{label === t.finance.total ? <b>{label}</b> : label}</td>
                      <td className="mono">{s.count}</td>
                      <td className="mono">{formatTenge(s.gross)}</td>
                      <td className="mono">{formatTenge(s.commission)}</td>
                      <td className="mono">{formatTenge(s.net)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="note small">{t.finance.totalsNote}</p>
            {d.rows.length === 0 ? (
              <p className="note">{t.finance.empty}</p>
            ) : (
              <div className="tablewrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>{t.finance.date}</th>
                      <th>{t.finance.purpose}</th>
                      <th>{t.finance.payer}</th>
                      <th>{t.finance.gross}</th>
                      <th>{t.finance.commission}</th>
                      <th>{t.finance.status}</th>
                      <th>{t.finance.method}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.rows.map((r) => (
                      <tr key={r.id}>
                        <td className="mono small">{formatDateTime(r.date)}</td>
                        <td>
                          {t.finance.sources[r.source]}
                          {r.title && <div className="small">{r.title}</div>}
                        </td>
                        <td>{r.payer ?? '—'}</td>
                        <td className="mono">{formatTenge(r.amount)}</td>
                        <td className="mono">{formatTenge(r.commission)}</td>
                        <td>{t.finance.statuses[r.status]}</td>
                        <td>{t.finance.methods[r.method]}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {d.total > 50 && (
              <div className="row">
                <button className="button button--sm" onClick={() => setOffset(Math.max(0, offset - 50))} disabled={offset === 0}>
                  {t.common.back}
                </button>
                <span className="note small">
                  {offset + 1}–{offset + d.rows.length} / {d.total}
                </span>
                <button className="button button--sm" onClick={() => setOffset(offset + 50)} disabled={offset + 50 >= d.total}>
                  {t.finance.more}
                </button>
              </div>
            )}
          </>
        )}
      </Async>
    </section>
  )
}
