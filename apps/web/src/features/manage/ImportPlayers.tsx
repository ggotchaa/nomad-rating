import { useState } from 'react'
import { api } from '../../api/client.ts'
import { useApi } from '../../app/hooks.ts'
import { t } from '../../i18n/index.ts'
import { Async, Field } from '../../ui/kit.tsx'
import { useAction } from '../account/AccountFlows.tsx'
import { useClub } from './ManageLayout.tsx'

type Dup = { id: number; name: string; birthYear: number; city: string | null }
type PreviewRow = { row: number; data: Record<string, unknown> | null; errors: string[]; duplicates: Dup[] }
type Created = { id: number; name: string; claimCode: string }

const errorName = (code: string) => t.imp.errorNames[code] ?? t.errors[code.split(':')[0]!] ?? code

export function ImportPlayers() {
  const { club } = useClub()
  const [rows, setRows] = useState<PreviewRow[] | null>(null)
  const [skip, setSkip] = useState<Set<number>>(new Set())
  const [created, setCreated] = useState<Created[] | null>(null)
  const preview = useAction()
  const confirm = useAction()
  const codes = useApi<Created[]>(`/clubs/${club.id}/players/claim-codes`)
  const accepted = rows?.filter((r) => r.data && !skip.has(r.row)) ?? []

  return (
    <div className="stack">
      <section className="panel form">
        <h2>{t.imp.title}</h2>
        <p className="small muted">{t.imp.lead}</p>
        <Field label={t.imp.file}>
          <input
            type="file"
            accept=".xlsx,.csv,text/csv"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (!file) return
              setCreated(null)
              void preview.run(async () => {
                const type = file.name.endsWith('.xlsx') ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'text/csv'
                const r = await api<{ rows: PreviewRow[] }>(`/clubs/${club.id}/players/import/preview`, { method: 'POST', body: file, headers: { 'Content-Type': type } })
                setRows(r.rows)
                // Rows with possible duplicates are skipped unless the organiser ticks them.
                setSkip(new Set(r.rows.filter((x) => x.duplicates.length).map((x) => x.row)))
              })
            }}
          />
        </Field>
        {preview.notes}
      </section>
      {rows && (
        <section className="panel stack">
          <div className="tablewrap">
            <table className="table">
              <thead>
                <tr>
                  <th />
                  <th>{t.imp.row}</th>
                  <th>{t.a.lastName}</th>
                  <th>{t.a.firstName}</th>
                  <th>{t.a.birthYear}</th>
                  <th>{t.imp.errors}</th>
                  <th>{t.imp.duplicates}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.row}>
                    <td>
                      {r.data && (
                        <input
                          type="checkbox"
                          aria-label={`${t.imp.row} ${r.row}`}
                          checked={!skip.has(r.row)}
                          onChange={(e) => {
                            const next = new Set(skip)
                            if (e.target.checked) next.delete(r.row)
                            else next.add(r.row)
                            setSkip(next)
                          }}
                        />
                      )}
                    </td>
                    <td className="mono">{r.row}</td>
                    <td>{String(r.data?.lastName ?? '')}</td>
                    <td>{String(r.data?.firstName ?? '')}</td>
                    <td>{String(r.data?.birthYear ?? '')}</td>
                    <td>{r.errors.length ? <span className="chip chip--bad">{r.errors.map(errorName).join(', ')}</span> : <span className="chip chip--ok">{t.imp.ok}</span>}</td>
                    <td className="small">{r.duplicates.map((d) => `${d.name} (${d.birthYear}, ${d.city ?? '—'})`).join('; ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {confirm.notes}
          <button
            className="button button--primary"
            disabled={confirm.busy || accepted.length === 0}
            onClick={() =>
              void confirm.run(async () => {
                const r = await api<{ created: Created[] }>(`/clubs/${club.id}/players/import/confirm`, { method: 'POST', json: { players: accepted.map((x) => x.data) } })
                setCreated(r.created)
                setRows(null)
                codes.reload()
                return t.imp.done(r.created.length)
              })
            }
          >
            {t.imp.confirm(accepted.length)}
          </button>
        </section>
      )}
      {created && <p className="note note--ok">{t.imp.done(created.length)}</p>}
      <section className="panel stack">
        <h2>{t.imp.codes}</h2>
        <Async state={codes}>
          {(list) => (
            <div className="tablewrap">
              <table className="table">
                <tbody>
                  {list.map((p) => (
                    <tr key={p.id}>
                      <td>{p.name}</td>
                      <td className="mono">{p.claimCode}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Async>
      </section>
    </div>
  )
}
