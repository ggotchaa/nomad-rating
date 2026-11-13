import { useEffect, useState } from 'react'
import { locale } from '../../i18n/locale.ts'
import { Link } from 'react-router'
import type { RatingRow } from '../../api/types.ts'
import { useSession } from '../../app/auth.tsx'
import { useApi } from '../../app/hooks.ts'
import { t } from '../../i18n/index.ts'
import { Async, Delta, Seg } from '../../ui/kit.tsx'
import { CalibratingMark, RecalcBanner } from '../rating/widgets.tsx'

const PAGE = 50

export function RatingList() {
  const { me, cities } = useSession()
  const [city, setCity] = useState('')
  const [gender, setGender] = useState<'' | 'm' | 'f'>('')
  const [q, setQ] = useState('')
  const [term, setTerm] = useState('')
  const [inactive, setInactive] = useState(false)
  const [ageMin, setAgeMin] = useState('')
  const [ageMax, setAgeMax] = useState('')
  const [calibrating, setCalibrating] = useState(false)
  const [offset, setOffset] = useState(0)
  const [kind, setKind] = useState<'singles' | 'doubles'>('singles')

  useEffect(() => {
    const id = setTimeout(() => {
      setTerm(q.trim())
      setOffset(0)
    }, 300)
    return () => clearTimeout(id)
  }, [q])

  const query = new URLSearchParams({ limit: String(PAGE), offset: String(offset) })
  if (kind === 'doubles') query.set('kind', kind)
  if (city) query.set('city', city)
  if (gender) query.set('gender', gender)
  if (term) query.set('q', term)
  if (inactive) query.set('inactive', 'true')
  if (/^\d+$/.test(ageMin)) query.set('ageMin', ageMin)
  if (/^\d+$/.test(ageMax)) query.set('ageMax', ageMax)
  if (calibrating) query.set('calibrating', 'true')
  const list = useApi<{ total: number; items: RatingRow[] }>(`/players?${query}`)
  const reset = <T,>(set: (v: T) => void) => (v: T) => {
    set(v)
    setOffset(0)
  }

  return (
    <main className="page">
      <header className="pagehead">
        <h1>{t.r.title}</h1>
        <p>{t.r.lead}</p>
        <div className="filters">
          <select aria-label={t.common.city} value={city} onChange={(e) => reset(setCity)(e.target.value)}>
            <option value="">{t.common.anyCity}</option>
            {cities.map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.name[locale]}
              </option>
            ))}
          </select>
          <Seg label={t.doubles.kind} value={kind} onChange={reset(setKind)} options={[['singles', t.doubles.singles], ['doubles', t.doubles.doubles]]} />
          <Seg
            label={t.r.gender}
            value={gender}
            onChange={reset(setGender)}
            options={[
              ['', t.common.all],
              ['m', t.r.men],
              ['f', t.r.women],
            ]}
          />
          <label className="check">
            {t.r.ageFrom}
            <input type="number" min={5} max={99} inputMode="numeric" style={{ width: 64 }} value={ageMin} onChange={(e) => reset(setAgeMin)(e.target.value)} />
            {t.r.ageTo}
            <input type="number" min={5} max={99} inputMode="numeric" style={{ width: 64 }} value={ageMax} onChange={(e) => reset(setAgeMax)(e.target.value)} />
          </label>
          <input type="search" placeholder={t.r.searchName} aria-label={t.r.searchName} value={q} onChange={(e) => setQ(e.target.value)} />
          <label className="check">
            <input type="checkbox" checked={inactive} onChange={(e) => reset(setInactive)(e.target.checked)} />
            {t.r.showInactive}
          </label>
          <label className="check">
            <input type="checkbox" checked={calibrating} onChange={(e) => reset(setCalibrating)(e.target.checked)} />
            {t.rating2.showCalibrating}
          </label>
        </div>
      </header>
      <RecalcBanner />
      <section className="panel">
        <Async state={list} skeleton={3}>
          {(data) => (
            <>
              <p className="small muted">{t.r.total(data.total)}</p>
              <div className="tablewrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>{t.t.player}</th>
                      <th>{t.common.city}</th>
                      <th className="num">{t.t.rating}</th>
                      <th className="num">{t.r.d30}</th>
                      <th className="num">{t.r.matches}</th>
                      <th className="num">{t.r.wins}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((p) => (
                      <tr key={p.id} className={p.id === me.player?.id ? 'is-me' : ''}>
                        <td className="rank">{p.rank ?? '—'}</td>
                        <td>
                          <Link to={`/players/${p.id}`}>{p.name}</Link> <span className="muted small">{p.birthYear}</span>
                        </td>
                        <td className="muted">{p.city}</td>
                        <td className="num">
                          {p.calibrating ? <CalibratingMark /> : <b>{p.rating}</b>}
                          {p.provisional && !p.calibrating && <span className="chip chip--warn" style={{ marginLeft: 6 }}>{t.t.calibrating}</span>}
                        </td>
                        <td className="num">
                          <Delta value={p.change30d} />
                        </td>
                        <td className="num">{p.matches}</td>
                        <td className="num">{p.winRate == null ? '—' : `${p.winRate}%`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {data.items.length === 0 && <p className="empty">{t.r.empty}</p>}
              {data.total > PAGE && (
                <div className="row row--between">
                  <button className="button button--sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>
                    ←
                  </button>
                  <span className="small muted mono">
                    {offset + 1}–{Math.min(offset + PAGE, data.total)} / {data.total}
                  </span>
                  <button className="button button--sm" disabled={offset + PAGE >= data.total} onClick={() => setOffset(offset + PAGE)}>
                    →
                  </button>
                </div>
              )}
            </>
          )}
        </Async>
      </section>
    </main>
  )
}
