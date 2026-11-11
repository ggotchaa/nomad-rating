import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api/client.ts'

export function useApi<T>(path: string | null) {
  const [state, setState] = useState<{ data: T | null; error: unknown; loading: boolean }>({ data: null, error: null, loading: path != null })
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (path == null) return
    let alive = true
    setState((s) => ({ ...s, loading: true, error: null }))
    api<T>(path)
      .then((data) => alive && setState({ data, error: null, loading: false }))
      .catch((error: unknown) => alive && setState({ data: null, error, loading: false }))
    return () => {
      alive = false
    }
  }, [path, tick])
  const reload = useCallback(() => setTick((n) => n + 1), [])
  return { ...state, reload }
}

/** Subscribes to a WebSocket room of the API gateway; reconnects while mounted. */
export function useRoom(room: string | null, onEvent: (type: string) => void) {
  const handler = useRef(onEvent)
  handler.current = onEvent
  useEffect(() => {
    if (!room) return
    let socket: WebSocket | null = null
    let timer: ReturnType<typeof setTimeout> | undefined
    let closed = false
    const connect = () => {
      socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`)
      socket.onopen = () => socket?.send(JSON.stringify({ type: 'subscribe', room }))
      socket.onmessage = (e) => {
        const msg = JSON.parse(String(e.data)) as { type: string; room?: string }
        if (msg.room === room && msg.type !== 'subscribed') handler.current(msg.type)
      }
      socket.onclose = () => {
        if (!closed) timer = setTimeout(connect, 3000)
      }
    }
    connect()
    return () => {
      closed = true
      clearTimeout(timer)
      socket?.close()
    }
  }, [room])
}

export function useStored(key: string, initial: string) {
  const [value, setValue] = useState(() => {
    try {
      return localStorage.getItem(key) ?? initial
    } catch {
      return initial
    }
  })
  const set = useCallback(
    (v: string) => {
      setValue(v)
      try {
        localStorage.setItem(key, v)
      } catch {
        /* private mode */
      }
    },
    [key],
  )
  return [value, set] as const
}
