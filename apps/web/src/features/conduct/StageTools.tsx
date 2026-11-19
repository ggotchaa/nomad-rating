import { useState } from 'react'
import type { DraftEntry, DraftView, GroupView, StageView } from '../../api/types.ts'
import { t } from '../../i18n/index.ts'
import { ask as dialog } from '../../ui/dialogs.tsx'
import { Field, Modal } from '../../ui/kit.tsx'
import { PlayerSearch } from '../manage/ManageLayout.tsx'
import { NewPlayer } from '../manage/ManagePlayers.tsx'
import { StageWarnings } from '../tournaments/Structure.tsx'

type Run = (path: string, json?: unknown, ok?: string) => Promise<boolean>

/** Groups or bracket of the first stage made before the start (T-8): rebuild, publish, swap, new registrations. */
export function DraftPanel({ base, draft, run }: { base: string; draft: DraftView | null; run: Run }) {
  const [picked, setPicked] = useState<number | null>(null)
  const pick = (id: number) => {
    if (picked == null) return setPicked(id)
    if (picked !== id) void run(`${base}/draft/swap`, { a: picked, b: id })
    setPicked(null)
  }
  const player = (e: DraftEntry | null, i: number) =>
    e ? (
      <li key={e.entryId}>
        <span className="mono muted">{i + 1}</span> {e.name}
        <span className="muted mono small">{e.rating}</span>
        <button
          type="button"
          className={`brk__pick${picked === e.entryId ? ' is-picked' : ''}`}
          title={picked ? t.t.swapHere : t.t.swapPick}
          onClick={() => pick(e.entryId)}
        >
          ⇄
        </button>
      </li>
    ) : (
      <li key={`bye-${i}`} className="muted">
        <span className="mono">{i + 1}</span> {t.t.bye}
      </li>
    )
  return (
    <section className="panel">
      <div className="panel__head">
        <h2>
          {t.conduct.draft}{' '}
          {draft && <span className="chip">{draft.published ? t.conduct.draftPublished : t.conduct.draftHidden}</span>}
        </h2>
        <div className="row">
          <button className="button" onClick={() => void run(`${base}/draft`, {}, t.conduct.draftDone)}>
            {draft ? t.conduct.draftRebuild : t.conduct.draftMake}
          </button>
          {draft && (
            <>
              <button
                className="button"
                onClick={() => void run(`${base}/draft`, { presentOnly: true }, t.conduct.draftDone)}
              >
                {t.conduct.draftDropAbsent}
              </button>
              <button
                className="button button--primary"
                onClick={() => void run(`${base}/draft/publish`, { publish: !draft.published })}
              >
                {draft.published ? t.conduct.draftUnpublish : t.conduct.draftPublish}
              </button>
              <button
                className="button button--danger"
                onClick={async () =>
                  (await dialog.confirm(t.conduct.draftClearConfirm)) && void run(`${base}/draft/clear`)
                }
              >
                {t.conduct.draftClear}
              </button>
            </>
          )}
        </div>
      </div>
      <p className="small muted">{t.conduct.draftHint}</p>
      {draft && (
        <>
          <StageWarnings warnings={draft.warnings} />
          {draft.newEntries.length > 0 && (
            <div className="note note--warn stack">
              <span>{t.conduct.draftNew(draft.newEntries.length)}</span>
              {draft.newEntries.map((e) => (
                <div key={e.entryId} className="row row--between">
                  <span>{e.name}</span>
                  <span className="row">
                    <button
                      className="button button--sm"
                      onClick={() => void run(`${base}/draft/add-free`, { entryId: e.entryId })}
                    >
                      {t.conduct.draftAddFree}
                    </button>
                    <button
                      className="button button--sm"
                      onClick={() => void run(`${base}/draft`, {}, t.conduct.draftDone)}
                    >
                      {t.conduct.draftRebuild}
                    </button>
                  </span>
                </div>
              ))}
            </div>
          )}
          {draft.absent.length > 0 && <p className="note note--warn">{t.conduct.draftAbsent(draft.absent.length)}</p>}
          {draft.groups ? (
            <div className="draft__groups">
              {draft.groups.map((g) => (
                <div key={g.code} className="draft__group">
                  <b>
                    {t.t.group} {g.code}
                  </b>
                  <ol>{g.members.map((e, i) => player(e, i))}</ol>
                </div>
              ))}
            </div>
          ) : (
            <div className="draft__group">
              <ol>{draft.seeds?.map((e, i) => player(e, i))}</ol>
            </div>
          )}
        </>
      )}
    </section>
  )
}

/** Brackets that can open while their groups still play (T-7). */
export function OpenEarly({ base, stages, run }: { base: string; stages: StageView[]; run: Run }) {
  const runningGroups = stages.some((s) => 'groups' in s && s.status === 'running')
  const pending = stages.filter((s) => !('groups' in s) && s.status === 'pending')
  if (!runningGroups || !pending.length) return null
  return (
    <div className="row">
      {pending.map((s) => (
        <button
          key={s.key}
          className="button"
          title={t.conduct.openEarlyHint}
          onClick={async () =>
            (await dialog.confirm(t.conduct.openEarlyConfirm(s.name))) &&
            void run(`${base}/stages/${s.key}/open-early`, undefined, t.conduct.openEarlyDone)
          }
        >
          {t.conduct.openEarly(s.name)}
        </button>
      ))}
    </div>
  )
}

/** Organiser sets the order of a tied group by hand (T-3). */
export async function setGroupOrder(base: string, g: GroupView, run: Run) {
  const rows = g.standings?.rows ?? []
  const list = rows.map((r, i) => `${i + 1} — ${r.player?.name ?? r.id}`).join('\n')
  const answer = await dialog.prompt(`${t.conduct.groupOrderPrompt}\n${list}`, rows.map((_, i) => i + 1).join(' '))
  if (!answer) return
  const order = answer
    .split(/[\s,]+/)
    .map((x) => rows[Number(x) - 1]?.id)
    .filter((x): x is string => x != null)
  if (order.length !== rows.length || new Set(order).size !== rows.length) return
  const reason = (await dialog.prompt(t.conduct.groupOrderReason))?.trim()
  if (reason && reason.length >= 3)
    await run(`${base}/groups/${g.id}/order`, { order: order.map(Number), reason }, t.conduct.groupOrderDone)
}

/** Adds a player during the tournament (T-9): any unfinished stage, a chosen group or bracket slot. */
export function LateEntry({
  base,
  stages,
  run,
  onClose,
}: {
  base: string
  stages: StageView[]
  run: Run
  onClose: () => void
}) {
  const open = stages.filter((s) => s.status === 'running')
  const [player, setPlayer] = useState<{ id: number; name: string } | null>(null)
  const [creating, setCreating] = useState(false)
  const [stageKey, setStageKey] = useState(open[0]?.key ?? '')
  const stage = open.find((s) => s.key === stageKey)
  const [group, setGroup] = useState('')
  const [seed, setSeed] = useState(1)
  const [payment, setPayment] = useState<'on_site' | 'waived'>('on_site')
  const [missed, setMissed] = useState<'play' | 'technical' | 'ignore'>('play')
  const [taken, setTaken] = useState(false)

  const seeds = stage && !('groups' in stage) ? (stage.size ?? 0) : 0
  const submit = async (confirmSwap = false) => {
    if (!player || !stage) return
    const ok = await run(
      `${base}/late-entries`,
      {
        playerId: player.id,
        stageKey,
        payment,
        missed,
        confirmSwap,
        ...('groups' in stage ? { group: group || stage.groups[0]?.code } : { seed }),
      },
      t.conduct.lateDone,
    )
    if (ok) onClose()
    else if (!('groups' in stage)) setTaken(true)
  }

  if (creating)
    return (
      <NewPlayer
        onClose={() => setCreating(false)}
        onCreated={(_, id) => {
          setPlayer({ id, name: t.conduct.lateNewPlayer })
          setCreating(false)
        }}
      />
    )
  return (
    <Modal title={t.conduct.lateTitle} onClose={onClose}>
      <div className="form">
        {!open.length && <p className="note note--warn">{t.conduct.lateNoStage}</p>}
        <Field label={t.t.player}>
          {player ? (
            <div className="row row--between">
              <b>{player.name}</b>
              <button type="button" className="button button--sm" onClick={() => setPlayer(null)}>
                {t.common.cancel}
              </button>
            </div>
          ) : (
            <div className="stack">
              <PlayerSearch onPick={(p) => setPlayer({ id: p.id, name: p.name })} />
              <button type="button" className="button button--sm" onClick={() => setCreating(true)}>
                {t.conduct.lateCreate}
              </button>
            </div>
          )}
        </Field>
        <Field label={t.conduct.lateStage}>
          <select value={stageKey} onChange={(e) => setStageKey(e.target.value)}>
            {open.map((s) => (
              <option key={s.key} value={s.key}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        {stage && 'groups' in stage && (
          <>
            <Field label={t.t.group}>
              <select value={group || stage.groups[0]?.code} onChange={(e) => setGroup(e.target.value)}>
                {stage.groups.map((g) => (
                  <option key={g.code} value={g.code}>
                    {g.code} · {g.members.length}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t.conduct.lateMissed}>
              <select value={missed} onChange={(e) => setMissed(e.target.value as typeof missed)}>
                {(['play', 'technical', 'ignore'] as const).map((m) => (
                  <option key={m} value={m}>
                    {t.conduct.lateMissedMode[m]}
                  </option>
                ))}
              </select>
            </Field>
          </>
        )}
        {stage && !('groups' in stage) && (
          <Field label={t.conduct.lateSlot}>
            <select value={seed} onChange={(e) => (setSeed(Number(e.target.value)), setTaken(false))}>
              {Array.from({ length: seeds }, (_, i) => {
                const m = stage.matches.find((x) =>
                  [x.homeSource, x.awaySource].some(
                    (src) =>
                      (src as { kind?: string; seed?: number } | null)?.kind === 'seed' &&
                      (src as { seed: number }).seed === i + 1,
                  ),
                )
                const side = m && (m.homeSource as { seed?: number } | null)?.seed === i + 1 ? m.home : m?.away
                return (
                  <option key={i} value={i + 1}>
                    {t.misc.seed(i + 1)} · {side?.name ?? t.t.bye}
                  </option>
                )
              })}
            </select>
          </Field>
        )}
        <Field label={t.conduct.latePayment}>
          <select value={payment} onChange={(e) => setPayment(e.target.value as typeof payment)}>
            <option value="on_site">{t.conduct.latePaymentMode.on_site}</option>
            <option value="waived">{t.conduct.latePaymentMode.waived}</option>
          </select>
        </Field>
        {taken && (
          <div className="note note--warn row row--between">
            <span>{t.conduct.lateTaken}</span>
            <button type="button" className="button button--sm" onClick={() => void submit(true)}>
              {t.conduct.lateSwap}
            </button>
          </div>
        )}
        <button
          type="button"
          className="button button--primary"
          disabled={!player || !stage}
          onClick={() => void submit()}
        >
          {t.conduct.lateAdd}
        </button>
      </div>
    </Modal>
  )
}
