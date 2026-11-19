import { useEffect, useRef, useState } from 'react'
import { api } from '../api/client.ts'
import { errorText, t } from '../i18n/index.ts'
import { ask } from './dialogs.tsx'
import { Modal } from './kit.tsx'

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('')

/** Player photo, or initials when there is none. */
export function Avatar({ name, photoUrl, size = 32, className = '' }: { name: string; photoUrl?: string | null; size?: number; className?: string }) {
  const [broken, setBroken] = useState(false)
  useEffect(() => setBroken(false), [photoUrl])
  const style = { width: size, height: size, fontSize: Math.round(size * 0.38) }
  return photoUrl && !broken ? (
    <img className={`ava ${className}`} src={photoUrl} alt="" width={size} height={size} style={style} loading="lazy" onError={() => setBroken(true)} />
  ) : (
    <span className={`ava ava--initials ${className}`} style={style} aria-hidden="true">
      {initials(name)}
    </span>
  )
}

const TYPES = ['image/jpeg', 'image/png', 'image/webp']
const MAX_BYTES = 5 * 1024 * 1024
const OUT = 512

function Cropper({ file, onCancel, onDone }: { file: File; onCancel: () => void; onDone: (blob: Blob) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [img, setImg] = useState<HTMLImageElement | null>(null)
  const [zoom, setZoom] = useState(1)
  const [pos, setPos] = useState({ x: 0.5, y: 0.5 })

  useEffect(() => {
    const url = URL.createObjectURL(file)
    const i = new Image()
    i.onload = () => setImg(i)
    i.src = url
    return () => URL.revokeObjectURL(url)
  }, [file])

  const draw = (c: HTMLCanvasElement, side: number) => {
    if (!img) return
    const s = Math.min(img.naturalWidth, img.naturalHeight) / zoom
    const sx = (img.naturalWidth - s) * pos.x
    const sy = (img.naturalHeight - s) * pos.y
    c.width = side
    c.height = side
    c.getContext('2d')?.drawImage(img, sx, sy, s, s, 0, 0, side, side)
  }
  useEffect(() => {
    if (canvas.current) draw(canvas.current, 240)
  })

  const save = () => {
    const c = document.createElement('canvas')
    draw(c, OUT)
    c.toBlob((b) => b && onDone(b), file.type === 'image/png' ? 'image/png' : file.type, 0.9)
  }

  return (
    <Modal title={t.cards.cropTitle} onClose={onCancel}>
      <div className="stack">
        <canvas ref={canvas} width={240} height={240} className="ava-crop" />
        <label className="field">
          {t.cards.zoom}
          <input type="range" min={1} max={4} step={0.05} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} />
        </label>
        <label className="field">
          {t.cards.moveX}
          <input type="range" min={0} max={1} step={0.01} value={pos.x} onChange={(e) => setPos({ ...pos, x: Number(e.target.value) })} />
        </label>
        <label className="field">
          {t.cards.moveY}
          <input type="range" min={0} max={1} step={0.01} value={pos.y} onChange={(e) => setPos({ ...pos, y: Number(e.target.value) })} />
        </label>
        <div className="row">
          <button className="button button--primary" disabled={!img} onClick={save}>
            {t.common.save}
          </button>
          <button className="button" onClick={onCancel}>
            {t.common.cancel}
          </button>
        </div>
      </div>
    </Modal>
  )
}

/** Upload (cropped to a square), replace and remove a photo at `endpoint` (POST raw image / DELETE). */
export function PhotoEditor({ name, photoUrl, endpoint, onChange }: { name: string; photoUrl: string | null; endpoint: string; onChange: (url: string | null) => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  const pick = (f: File | undefined) => {
    if (input.current) input.current.value = ''
    if (!f) return
    if (!TYPES.includes(f.type)) return setError(t.cards.badType)
    if (f.size > MAX_BYTES) return setError(t.cards.tooBig)
    setError(null)
    setFile(f)
  }
  const upload = (blob: Blob) => {
    setFile(null)
    void run(async () => onChange((await api<{ photoUrl: string }>(endpoint, { method: 'POST', body: blob, headers: { 'Content-Type': blob.type } })).photoUrl))
  }
  const remove = async () => {
    if (!(await ask.confirm(t.cards.removeConfirm))) return
    void run(async () => {
      await api(endpoint, { method: 'DELETE' })
      onChange(null)
    })
  }

  return (
    <div className="stack">
      <div className="row">
        <Avatar name={name} photoUrl={photoUrl} size={96} />
        <div className="stack">
          <input ref={input} type="file" accept={TYPES.join(',')} hidden aria-label={t.acc.photo} onChange={(e) => pick(e.target.files?.[0])} />
          <button type="button" className="button button--sm" disabled={busy} onClick={() => input.current?.click()}>
            {photoUrl ? t.cards.replace : t.cards.choose}
          </button>
          {photoUrl && (
            <button type="button" className="button button--sm button--danger" disabled={busy} onClick={() => void remove()}>
              {t.cards.remove}
            </button>
          )}
        </div>
      </div>
      <p className="small muted">{t.acc.photoHint}</p>
      {error && <p className="note note--error">{error}</p>}
      {file && <Cropper file={file} onCancel={() => setFile(null)} onDone={upload} />}
    </div>
  )
}
