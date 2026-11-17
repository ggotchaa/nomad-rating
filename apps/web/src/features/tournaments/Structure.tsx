import type { CSSProperties } from 'react'
import { Link } from 'react-router'
import type { EntryRef, GroupView, MatchView, StageView, StandingRow, StructureFormat } from '../../api/types.ts'
import { t } from '../../i18n/index.ts'
import { CalibTag } from '../rating/widgets.tsx'

type Points = { win: number; loss: number; walkover: number }
const DEFAULT_POINTS: Points = { win: 2, loss: 1, walkover: 0 }

const done = (m: MatchView) => m.winnerEntryId != null
const played = (m: MatchView) => done(m) && m.resultType !== 'bye'
const pad = (n: number) => String(n).padStart(2, '0')

function when(m: MatchView): string {
  if (!m.scheduledAt) return ''
  const d = new Date(m.scheduledAt)
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const meta = (m: MatchView, number = false) =>
  [number ? `№ ${m.bracketNumber ?? m.number}` : '', when(m), m.table != null ? `${t.t.table} ${m.table}` : '']
    .filter(Boolean)
    .join(' | ')

const gamesOf = (m: MatchView, flip = false) =>
  (m.games ?? []).map((g) => (flip ? `${g.away}:${g.home}` : `${g.home}:${g.away}`)).join(', ')

function sourceLabel(source: unknown): string {
  const s = source as { kind?: string; match?: number; seed?: number } | null
  if (s?.kind === 'winner') return t.misc.winnerOf(s.match ?? 0)
  if (s?.kind === 'loser') return `−${s.match}`
  if (s?.kind === 'seed') return t.misc.seed(s.seed ?? 0)
  return '—'
}

/** Head-to-head numbers among the tied players: the calculation behind the tie-break (spec 4.6). */
function TieBreak({ row, rows, matches }: { row: StandingRow; rows: StandingRow[]; matches: MatchView[] }) {
  if (!row.decidedBy || !row.tiedIds?.length) return null
  const ids = [Number(row.id), ...row.tiedIds]
  const h2h = matches.filter(
    (m) => played(m) && ids.includes(m.home?.entryId ?? -1) && ids.includes(m.away?.entryId ?? -1),
  )
  const calc = ids.map((id) => {
    const c = { id, wins: 0, setsW: 0, setsL: 0, ptsW: 0, ptsL: 0 }
    for (const m of h2h) {
      const home = m.home?.entryId === id
      if (!home && m.away?.entryId !== id) continue
      if (m.winnerEntryId === id) c.wins++
      c.setsW += (home ? m.setsHome : m.setsAway) ?? 0
      c.setsL += (home ? m.setsAway : m.setsHome) ?? 0
      for (const g of m.games ?? []) {
        c.ptsW += home ? g.home : g.away
        c.ptsL += home ? g.away : g.home
      }
    }
    return c
  })
  const name = (id: number) => rows.find((r) => Number(r.id) === id)?.player?.name ?? '—'
  const ratio = (w: number, l: number) => (l ? (w / l).toFixed(3) : w ? '∞' : '—')
  return (
    <details className="small muted">
      <summary>
        {row.place}. {row.player?.name} — {t.t.decidedBy[row.decidedBy] ?? row.decidedBy}
      </summary>
      <p>{t.t.tiedWith(row.tiedWith.join(', '))}</p>
      <div className="tablewrap">
        <table className="table">
          <thead>
            <tr>
              <th>{t.t.player}</th>
              <th className="num">{t.t.w}</th>
              <th className="num">{t.t.sets}</th>
              <th className="num">{t.t.rallyPoints}</th>
            </tr>
          </thead>
          <tbody>
            {calc.map((c) => (
              <tr key={c.id}>
                <td>{name(c.id)}</td>
                <td className="num">{c.wins}</td>
                <td className="num">
                  {c.setsW}:{c.setsL} ({ratio(c.setsW, c.setsL)})
                </td>
                <td className="num">
                  {c.ptsW}:{c.ptsL} ({ratio(c.ptsW, c.ptsL)})
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  )
}

/** Group as a «players × players» table: the diagonal is hatched, a cell is the row player's match with the column player. */
function GroupMatrix({
  g,
  title,
  points,
  advancing,
  me,
}: {
  g: GroupView
  title: string
  points: Points
  advancing: Set<number>
  me?: number
}) {
  const players = g.members.filter((p): p is EntryRef => p != null)
  const rows = new Map((g.standings?.rows ?? []).map((r) => [Number(r.id), r]))
  const total = g.matches.filter((m) => m.status !== 'annulled').length
  const finished = g.matches.filter((m) => done(m)).length
  const between = (a: number, b: number) =>
    g.matches.find(
      (m) => (m.home?.entryId === a && m.away?.entryId === b) || (m.home?.entryId === b && m.away?.entryId === a),
    )
  const earned = (id: number) =>
    g.matches.reduce((sum, m) => {
      if (!played(m) || (m.home?.entryId !== id && m.away?.entryId !== id)) return sum
      if (m.winnerEntryId === id) return sum + points.win
      return sum + (m.resultType === 'walkover' ? points.walkover : points.loss)
    }, 0)

  const cell = (row: EntryRef, col: EntryRef) => {
    if (row.entryId === col.entryId) return <td key={col.entryId} className="gm__self" aria-hidden="true" />
    const m = between(row.entryId, col.entryId)
    if (!m) return <td key={col.entryId} />
    const home = m.home?.entryId === row.entryId
    if (m.status === 'playing') {
      return (
        <td key={col.entryId} className="gm__cell is-live">
          <span className="gm__live">LIVE</span>
          {m.table != null && (
            <small>
              {t.t.table} {m.table}
            </small>
          )}
        </td>
      )
    }
    if (played(m)) {
      const own = home ? m.setsHome : m.setsAway
      const other = home ? m.setsAway : m.setsHome
      const won = m.winnerEntryId === row.entryId
      const pts = won ? points.win : m.resultType === 'walkover' ? points.walkover : points.loss
      return (
        <td key={col.entryId} className="gm__cell" title={gamesOf(m, !home) || undefined}>
          <b>{pts}</b>
          <small>{own != null && other != null ? `${own}:${other}` : t.t.walkoverShort}</small>
        </td>
      )
    }
    if (m.status === 'annulled')
      return (
        <td key={col.entryId} className="gm__cell">
          —
        </td>
      )
    return (
      <td key={col.entryId} className="gm__cell">
        <small className="gm__when">{meta(m)}</small>
      </td>
    )
  }

  return (
    <section className="panel gm">
      <div className="gm__head">
        <h3>{title}</h3>
        {total > 0 && <span>{finished >= total ? t.t.groupDone : t.t.groupPlayed(finished, total)}</span>}
      </div>
      <div className="scrollx">
        <table className="gm__table">
          <thead>
            <tr>
              <th className="gm__no">№</th>
              <th className="gm__name">{t.t.player}</th>
              {players.map((p, i) => (
                <th key={p.entryId} className="gm__col">
                  {i + 1}
                </th>
              ))}
              <th className="gm__sum">{t.t.pts}</th>
              <th className="gm__sum">{t.t.place}</th>
            </tr>
          </thead>
          <tbody>
            {players.map((p, i) => {
              const r = rows.get(p.entryId)
              const any = g.matches.some(
                (m) => played(m) && (m.home?.entryId === p.entryId || m.away?.entryId === p.entryId),
              )
              const cls = [advancing.has(p.entryId) ? 'is-adv' : '', p.playerId === me ? 'is-me' : ''].join(' ').trim()
              return (
                <tr key={p.entryId} className={cls || undefined}>
                  <td className="gm__no">{i + 1}</td>
                  <th scope="row" className="gm__name">
                    <Link to={`/players/${p.playerId}`}>{p.name}</Link>
                    <CalibTag e={p} />
                  </th>
                  {players.map((c) => cell(p, c))}
                  <td className="gm__sum">{r ? r.points : any ? earned(p.entryId) : ''}</td>
                  <td className="gm__sum">{r?.place ?? ''}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {g.matches.some((m) => played(m) && m.resultType === 'normal' && !m.games?.length) && (
        <p className="small muted">{t.t.noGamePoints}</p>
      )}
      {g.standings?.rows.some((r) => r.decidedBy && r.tiedIds?.length) && (
        <div className="stack">
          {g.standings.rows.map((r) => (
            <TieBreak key={r.id} row={r} rows={g.standings!.rows} matches={g.matches} />
          ))}
        </div>
      )}
    </section>
  )
}

type Node = { match: MatchView; children: Node[]; leaves: number }

/** Trees of a bracket: a match's «winner of» sources are its branches; roots are matches nobody advances from. */
function bracketTrees(matches: MatchView[]): Node[] {
  const byNumber = new Map(matches.map((m) => [m.bracketNumber ?? m.number, m]))
  const feeders = (m: MatchView) =>
    [m.homeSource, m.awaySource]
      .map((s) => s as { kind?: string; match?: number } | null)
      .map((s) => (s?.kind === 'winner' ? byNumber.get(s.match ?? -1) : undefined))
      .filter((x): x is MatchView => x != null)
  const fed = new Set(matches.flatMap((m) => feeders(m).map((f) => f.id)))
  const build = (m: MatchView, seen: Set<number>): Node => {
    const children = feeders(m)
      .filter((f) => !seen.has(f.id))
      .map((f) => build(f, new Set([...seen, f.id])))
    return { match: m, children, leaves: children.reduce((sum, c) => sum + c.leaves, 0) || 1 }
  }
  return matches
    .filter((m) => !fed.has(m.id))
    .sort((a, b) => (a.placeFrom ?? 999) - (b.placeFrom ?? 999) || (a.bracketNumber ?? 0) - (b.bracketNumber ?? 0))
    .map((root) => build(root, new Set([root.id])))
}

function treeCells(tree: Node) {
  const cells: { node: Node; depth: number; row: number }[] = []
  let height = 0
  const walk = (node: Node, depth: number, row: number) => {
    height = Math.max(height, depth + 1)
    let next = row
    for (const child of node.children) {
      walk(child, depth + 1, next)
      next += child.leaves
    }
    cells.push({ node, depth, row })
  }
  walk(tree, 0, 0)
  return { height, cells: cells.map((c) => ({ ...c, column: height - 1 - c.depth })) }
}

const decides = (m: MatchView) => m.placeFrom != null && m.placeTo === m.placeFrom + 1
const forPlace = (m: MatchView) => t.t.forPlace(m.placeFrom ?? 0, m.placeTo ?? 0)
const maxPlace = (n: Node): number => Math.max(n.match.placeTo ?? 0, ...n.children.map(maxPlace))

function Side({ m, side, medals }: { m: MatchView; side: 'home' | 'away'; medals: boolean }) {
  const entry = side === 'home' ? m.home : m.away
  const isDone = done(m)
  const win = isDone && entry != null && m.winnerEntryId === entry.entryId
  const lost = isDone && !win
  const score = played(m) ? (side === 'home' ? m.setsHome : m.setsAway) : null
  const place = medals && isDone && entry && decides(m) ? (win ? m.placeFrom! : m.placeTo!) : null
  return (
    <div className={`brk__side${win ? ' is-win' : ''}${lost ? ' is-lost' : ''}${entry ? '' : ' is-tbd'}`}>
      <span className="brk__name">
        {entry ? entry.name : isDone ? '—' : sourceLabel(side === 'home' ? m.homeSource : m.awaySource)}
        <CalibTag e={entry} />
      </span>
      <b>{score ?? ''}</b>
      {place != null && (
        <i className={`brk__place${place <= 3 ? ` m${place}` : ''}`} title={t.t.placeN(place)}>
          {place}
        </i>
      )}
    </div>
  )
}

function Box({ m, titled, medals }: { m: MatchView; titled: boolean; medals: boolean }) {
  return (
    <div className={`brk__box${m.status === 'playing' ? ' is-live' : ''}`} title={gamesOf(m) || undefined}>
      {titled && medals && decides(m) && <span className="brk__title">{forPlace(m)}</span>}
      <div className="brk__card">
        <Side m={m} side="home" medals={medals} />
        <Side m={m} side="away" medals={medals} />
      </div>
      <span className="brk__meta">
        {m.status === 'playing' && <span className="gm__live">LIVE</span>}
        {meta(m, true)}
      </span>
    </div>
  )
}

function Tree({ tree, main, medals }: { tree: Node; main: boolean; medals: boolean }) {
  const { height, cells } = treeCells(tree)
  const label = (column: number) => {
    const depth = height - 1 - column
    if (!main && depth === 0 && medals && decides(tree.match)) return forPlace(tree.match)
    if (main) {
      const l = cells.find((c) => c.column === column)?.node.match.label ?? ''
      return t.misc.rounds[l] ?? l
    }
    return depth === 0 ? (t.misc.rounds.final ?? '') : (t.misc.rounds[`1/${2 ** depth}`] ?? '')
  }
  return (
    <div className="scrollx">
      <div className="brk__tree" style={{ '--cols': height, '--rows': tree.leaves } as CSSProperties}>
        {(main || height > 1) &&
          Array.from({ length: height }, (_, c) => (
            <h4 key={c} className="brk__round" style={{ gridColumn: c + 1 }}>
              {label(c)}
            </h4>
          ))}
        {cells.map(({ node, row, column }) => {
          const first = node.children[0]
          const last = node.children[node.children.length - 1]
          const lines =
            first && last && node.children.length > 1
              ? {
                  '--from': `${(first.leaves / 2 / node.leaves) * 100}%`,
                  '--to': `${((node.leaves - last.leaves / 2) / node.leaves) * 100}%`,
                }
              : {}
          const join = node.children.length > 1 ? ' joins' : node.children.length ? ' continues' : ''
          return (
            <div
              key={node.match.id}
              className={`brk__cell${join}${main || height > 1 ? '' : ' is-solo'}`}
              style={{ gridColumn: column + 1, gridRow: `${row + 2} / span ${node.leaves}`, ...lines } as CSSProperties}
            >
              <Box m={node.match} titled={column === height - 1 && (main || height === 1)} medals={medals} />
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** `medals`: places are the tournament's own only in the first bracket stage; later ones (consolation) number from 1 again. */
function Bracket({ s, medals }: { s: Extract<StageView, { matches: MatchView[] }>; medals: boolean }) {
  const [main, ...rest] = bracketTrees(s.matches)
  if (!main) return null
  return (
    <section className="panel brk">
      <h3 className="brk__head">
        {s.name}
        {medals && s.kind === 'all_places' && <small>{t.t.placesRange(1, maxPlace(main))}</small>}
      </h3>
      <Tree tree={main} main medals={medals} />
      {rest.length > 0 && (
        <div className="brk__extra">
          {rest.map((tree) => (
            <div key={tree.match.id} className="brk__sub">
              {medals && tree.leaves > 1 && <h4>{t.t.placesRange(tree.match.placeFrom ?? 0, maxPlace(tree))}</h4>}
              <Tree tree={tree} main={false} medals={medals} />
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

/** Entries of a group stage that go on to the next stage: those already drawn there, else the «places» rule. */
function advancingFrom(s: StageView, stages: StageView[], format?: StructureFormat): Set<number> {
  const out = new Set<number>()
  const rule = format?.transitions?.find((x) => x.from === s.key)
  const target = stages.find((x) => x.key === (rule?.to ?? stages[stages.indexOf(s) + 1]?.key))
  if (target) {
    const matches = 'groups' in target ? target.groups.flatMap((g) => g.matches) : target.matches
    for (const m of matches) for (const e of [m.home, m.away]) if (e) out.add(e.entryId)
    if ('groups' in target) for (const g of target.groups) for (const e of g.members) if (e) out.add(e.entryId)
  }
  if (!out.size && rule?.rule.by === 'places' && 'groups' in s) {
    for (const g of s.groups)
      for (const r of g.standings?.rows ?? []) if (rule.rule.places?.includes(r.place)) out.add(Number(r.id))
  }
  return out
}

export function Structure({ stages, me, format }: { stages: StageView[]; me?: number; format?: StructureFormat }) {
  return (
    <>
      {stages.map((s) => (
        <StageBlock key={s.key} s={s} stages={stages} format={format} me={me} heading />
      ))}
    </>
  )
}

/** One stage of the tournament: group tables or a bracket. */
export function StageBlock({
  s,
  stages = [s],
  format,
  me,
  heading = false,
}: {
  s: StageView
  stages?: StageView[]
  format?: StructureFormat
  me?: number
  heading?: boolean
}) {
  if ('groups' in s) {
    const advancing = advancingFrom(s, stages, format)
    const points = format?.groupPoints ?? DEFAULT_POINTS
    return (
      <div className="stage">
        {heading && <h2>{s.name}</h2>}
        {s.groups.map((g) => (
          <GroupMatrix
            key={g.code}
            g={g}
            title={s.groups.length > 1 ? `${t.t.group} ${g.code}` : s.name}
            points={points}
            advancing={advancing}
            me={me}
          />
        ))}
      </div>
    )
  }
  return (
    <div className="stage">
      <div className="stage__head">
        {heading ? <h2>{s.name}</h2> : <span />}
        {s.matches.length > 0 && (
          <button type="button" className="button button--sm noprint" onClick={() => window.print()}>
            {t.t.print}
          </button>
        )}
      </div>
      {s.matches.length ? (
        <Bracket s={s} medals={stages.find((x) => !('groups' in x)) === s} />
      ) : (
        <p className="empty">{t.t.bracketLater}</p>
      )}
    </div>
  )
}
