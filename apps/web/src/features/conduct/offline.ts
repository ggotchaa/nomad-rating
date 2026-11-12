// Score entry offline queue: results that failed with a network error are kept in localStorage
// and replayed when the connection is back. Server conflicts (409) are not retried.

import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '../../api/client.ts'

type Pending = { path: string; body: unknown; at: number }
const KEY = 'nomad.score-queue'

const read = (): Pending[] => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]') as Pending[]
  } catch {
    return []
  }
}
const write = (items: Pending[]) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(items))
  } catch {
    /* storage unavailable */
  }
}

export const isNetworkError = (e: unknown) => !(e instanceof ApiError) || e.code === 'network.error'

export function useScoreQueue(onSynced: () => void) {
  const [pending, setPending] = useState(read)

  const flush = useCallback(async () => {
    const items = read()
    if (!items.length) return
    const left: Pending[] = []
    for (const item of items) {
      try {
        await api(item.path, { method: 'POST', json: item.body })
      } catch (e) {
        if (isNetworkError(e)) left.push(item)
      }
    }
    write(left)
    setPending(left)
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
    const items = [...read().filter((i) => i.path !== path), { path, body, at: Date.now() }]
    write(items)
    setPending(items)
  }, [])

  return { pending: pending.length, enqueue }
}
