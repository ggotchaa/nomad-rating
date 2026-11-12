import { useEffect, useState } from 'react'
import { Link, useLocation, useParams, useSearchParams } from 'react-router'
import QRCode from 'qrcode'
import { api } from '../../api/client.ts'
import type { TournamentDetail } from '../../api/types.ts'
import { useSession } from '../../app/auth.tsx'
import { useApi } from '../../app/hooks.ts'
import { errorText, t } from '../../i18n/index.ts'
import { Async } from '../../ui/kit.tsx'

export function QrImage({ text, size = 320 }: { text: string; size?: number }) {
  const [src, setSrc] = useState('')
  useEffect(() => {
    let alive = true
    void QRCode.toDataURL(text, { width: size, margin: 1, color: { dark: '#03050b', light: '#ffffff' } }).then((url) => alive && setSrc(url))
    return () => {
      alive = false
    }
  }, [text, size])
  return src ? <img className="qr" src={src} width={size} height={size} alt="QR" /> : <div className="qr" style={{ width: size, height: size }} />
}

/** Staff «Показать QR»: fullscreen code that rotates every 30 seconds (R-22). */
export function CheckinQrScreen() {
  const { id } = useParams()
  const [qr, setQr] = useState<{ token: string; url: string; refreshInMs: number; open: boolean } | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    let alive = true
    const load = () =>
      api<{ token: string; url: string; refreshInMs: number; open: boolean }>(`/tournaments/${id}/checkin/qr`)
        .then((r) => {
          if (!alive) return
          setQr(r)
          timer = setTimeout(load, r.refreshInMs + 200)
        })
        .catch((e: unknown) => alive && setError(errorText(e)))
    void load()
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [id])
  return (
    <div className="qrscreen" onClick={() => void document.documentElement.requestFullscreen?.().catch(() => {})}>
      <h1>{t.checkin.title}</h1>
      {error && <p className="note note--error">{error}</p>}
      {qr && (
        <>
          {!qr.open && <p className="note note--error">{t.checkin.closed}</p>}
          <QrImage text={qr.url} size={Math.min(560, window.innerWidth - 48)} />
          <p className="muted">{t.checkin.hint}</p>
        </>
      )}
      <Link className="button" to={`/manage/tournaments/${id}/conduct`} onClick={(e) => e.stopPropagation()}>
        ← {t.conduct.title}
      </Link>
    </div>
  )
}

/** Player «Я в зале» page opened from the scanned QR. */
export function CheckinPage() {
  const { slug } = useParams()
  const [params] = useSearchParams()
  const location = useLocation()
  const { me } = useSession()
  const state = useApi<TournamentDetail>(`/tournaments/${slug}`)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const token = params.get('k')
  return (
    <main className="page">
      <Async state={state}>
        {(d) => (
          <section className="panel" style={{ maxWidth: 520, margin: '0 auto' }}>
            <h1>{t.checkin.title}</h1>
            <p>
              <Link to={`/t/${d.slug}`}>{d.title}</Link>
            </p>
            {!token ? (
              <p className="note">{t.checkin.noCode}</p>
            ) : !me.user ? (
              <Link className="button button--primary button--block" to="/login" state={{ from: location.pathname + location.search }}>
                {t.checkin.login}
              </Link>
            ) : done || d.myEntry?.status === 'checked_in' ? (
              <p className="note note--ok">{t.checkin.done}</p>
            ) : (
              <button
                className="button button--primary button--block button--huge"
                onClick={() =>
                  void api(`/tournaments/${d.id}/checkin`, { method: 'POST', json: { token } })
                    .then(() => setDone(true))
                    .catch((e: unknown) => setError(errorText(e)))
                }
              >
                {t.checkin.imHere}
              </button>
            )}
            {error && <p className="note note--error">{error}</p>}
          </section>
        )}
      </Async>
    </main>
  )
}
