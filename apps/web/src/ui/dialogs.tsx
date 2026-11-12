// In-app replacements for window.confirm / window.prompt: promise-based, rendered by <DialogHost/>.

import { useEffect, useRef, useState } from 'react'
import { t } from '../i18n/index.ts'

type Request = { kind: 'confirm' | 'prompt'; text: string; initial: string; resolve: (v: string | null) => void }

let push: ((r: Request) => void) | null = null

function open(kind: Request['kind'], text: string, initial = ''): Promise<string | null> {
  return new Promise((resolve) => {
    if (!push) return resolve(null)
    push({ kind, text, initial, resolve })
  })
}

export const ask = {
  confirm: (text: string) => open('confirm', text).then((v) => v != null),
  /** Resolves to the entered text, or null when cancelled. */
  prompt: (text: string, initial = '') => open('prompt', text, initial),
}

export function DialogHost() {
  const [queue, setQueue] = useState<Request[]>([])
  const [value, setValue] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const current = queue[0]

  useEffect(() => {
    push = (r) => setQueue((q) => [...q, r])
    return () => {
      push = null
    }
  }, [])
  useEffect(() => {
    if (!current) return
    setValue(current.initial)
    setTimeout(() => input.current?.focus(), 0)
  }, [current])

  if (!current) return null
  const done = (v: string | null) => {
    current.resolve(v)
    setQueue((q) => q.slice(1))
  }
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label={current.text} onClick={(e) => e.target === e.currentTarget && done(null)} onKeyDown={(e) => e.key === 'Escape' && done(null)}>
      <form
        className="panel stack"
        onSubmit={(e) => {
          e.preventDefault()
          done(current.kind === 'confirm' ? '' : value)
        }}
      >
        <p style={{ whiteSpace: 'pre-line' }}>{current.text}</p>
        {current.kind === 'prompt' && <input ref={input} value={value} onChange={(e) => setValue(e.target.value)} aria-label={current.text} />}
        <div className="row">
          <button type="submit" className="button button--primary" autoFocus={current.kind === 'confirm'}>
            {current.kind === 'confirm' ? t.common.yes : t.common.save}
          </button>
          <button type="button" className="button" onClick={() => done(null)}>
            {t.common.cancel}
          </button>
        </div>
      </form>
    </div>
  )
}
