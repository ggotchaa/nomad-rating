// Score entry offline queue: results that failed with a network error are kept in localStorage
// and replayed when the connection is back. If another helper changed the match meanwhile (409),
// both versions are kept for the organiser to pick.

import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '../../api/client.ts'
import type { Game } from './types.ts'

type Pending = { path: string; body: unknown; at: number }
type Score = { setsHome: number; setsAway: number; games?: Game[] }
export type ScoreConflict = Pending & { server: Score | null }
const KEY = 'nomad.score-queue'
const CONFLICTS = 'nomad.score-conflicts'

const read = <T>(key: string): T[] => {
  try {
    return JSON.parse(localStorage.getItem(key) ?? '[]') as T[]
  } catch {
    return []
  }
}
const write = (key: string, items: unknown[]) => {
  try {
    localStorage.setItem(key, JSON.stringify(items))
  } catch {
    /* storage unavailable */
  }
}

export const isNetworkError = (e: unknown) => !(e instanceof ApiError) || e.code === 'network.error'

export function useScoreQueue(onSynced: () => void) {
  const [pending, setPending] = useState(() => read<Pending>(KEY))
  const [conflicts, setConflicts] = useState(() => read<ScoreConflict>(CONFLICTS))

  const flush = useCallback(async () => {
    const items = read<Pending>(KEY)
    if (!items.length) return
    const left: Pending[] = []
    const clashed: ScoreConflict[] = []
    for (const item of items) {
      try {
        await api(item.path, { method: 'POST', json: item.body })
      } catch (e) {
        if (isNetworkError(e)) left.push(item)
        else if (e instanceof ApiError && e.status === 409) clashed.push({ ...item, server: (e.details as Score | undefined) ?? null })
      }
    }
    write(KEY, left)
    setPending(left)
    if (clashed.length) {
      const all = [...read<ScoreConflict>(CONFLICTS).filter((c) => !clashed.some((x) => x.path === c.path)), ...clashed]
      write(CONFLICTS, all)
      setConflicts(all)
    }
    if (left.length < items.length) onSynced()
  }, [onSynced])

  useEffect(() => {
    void flush()
    const id = setInterval(() => void flush(), 15000)
    window.addEventListener('online', flush)
    return () => {
      clearInterval(id)
      window.removeEventListener('online', flush)
    }
  }, [flush])

  const enqueue = useCallback((path: string, body: unknown) => {
    const items = [...read<Pending>(KEY).filter((i) => i.path !== path), { path, body, at: Date.now() }]
    write(KEY, items)
    setPending(items)
  }, [])

  /** Organiser's choice: `null` keeps the server version, otherwise the local one is applied as a correction. */
  const resolve = useCallback(
    async (c: ScoreConflict, apply: { reason: string } | null) => {
      if (apply) {
        const { version: _v, ...body } = c.body as Record<string, unknown>
        await api(c.path.replace(/\/result$/, '/correct'), { method: 'POST', json: { ...body, reason: apply.reason } })
      }
      const all = read<ScoreConflict>(CONFLICTS).filter((x) => x.path !== c.path)
      write(CONFLICTS, all)
      setConflicts(all)
      onSynced()
    },
    [onSynced],
  )

  return { pending: pending.length, enqueue, conflicts, resolve }
}
