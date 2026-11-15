import { useState } from 'react'
import { Link, Navigate, useParams } from 'react-router'
import { useApi } from '../../app/hooks.ts'
import { Async } from '../../ui/kit.tsx'
import { t } from '../../i18n/index.ts'
import { QrImage } from '../conduct/Checkin.tsx'

const Icon = ({ d }: { d: string }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d={d} />
  </svg>
)
const TELEGRAM = 'M21.9 4.3 2.9 11.6c-1 .4-1 1 .1 1.3l4.8 1.5 1.8 5.6c.2.6.1.9.8.9.5 0 .7-.2 1-.5l2.3-2.3 4.8 3.6c.9.5 1.5.2 1.7-.8l3.2-15c.3-1.2-.5-1.8-1.5-1.6ZM8.6 14l10.3-6.5c.5-.3 1-.1.6.2l-8.8 8-.3 3.6L8.6 14Z'
const WHATSAPP = 'M12 2a10 10 0 0 0-8.6 15L2 22l5.2-1.4A10 10 0 1 0 12 2Zm5.6 14.2c-.2.7-1.4 1.3-2 1.4-.5.1-1.1.1-1.8-.1-.4-.1-1-.3-1.7-.6-3-1.3-4.9-4.3-5-4.5-.2-.2-1.2-1.6-1.2-3s.7-2.1 1-2.4c.2-.3.5-.4.7-.4h.5c.2 0 .4 0 .6.5l.8 2c.1.2.1.4 0 .6l-.3.5-.4.4c-.1.1-.3.3-.1.6.2.3.8 1.4 1.8 2.3 1.3 1.1 2.3 1.5 2.6 1.6.3.1.5.1.6-.1l.9-1c.2-.2.4-.2.6-.1l2 .9c.2.1.4.2.5.3 0 .1 0 .7-.1 1.1Z'

/** Share link + messengers (R-20, T-8); OG preview is served by /api/og/{t,s}/… for crawlers. */
export function ShareBox({ slug, url, live, text }: { slug?: string; url: string; live?: boolean; text?: string }) {
  const [copied, setCopied] = useState(false)
  const share = async () => {
    if (navigator.share) {
      await navigator.share({ url }).catch(() => {})
      return
    }
    await navigator.clipboard?.writeText(url).catch(() => {})
    setCopied(true)
  }
  return (
    <aside className="panel sharebox">
      <h2>{t.t.shareTitle}</h2>
      <button className="button button--block" onClick={() => void share()}>
        {copied ? t.live.linkCopied : t.live.copyLink}
      </button>
      <div className="sharerow">
        <a className="button" href={`https://t.me/share/url?${new URLSearchParams({ url, ...(text && { text }) })}`} target="_blank" rel="noopener noreferrer">
          <Icon d={TELEGRAM} />
          {t.t.shareTelegram}
        </a>
        <a className="button" href={`https://wa.me/?${new URLSearchParams({ text: text ? `${text} ${url}` : url })}`} target="_blank" rel="noopener noreferrer">
          <Icon d={WHATSAPP} />
          {t.t.shareWhatsapp}
        </a>
      </div>
      {live && slug && (
        <Link className="button button--primary button--block" to={`/t/${slug}/live`}>
          {t.live.open}
        </Link>
      )}
    </aside>
  )
}

/** Registration QR — staff only (T-8): the code opens the tournament page with the register button. */
export function RegistrationQr({ url }: { url: string }) {
  return (
    <aside className="panel sharebox">
      <h2>{t.t.qrTitle}</h2>
      <QrImage text={url} size={180} />
      <p className="small muted">{t.t.qrHint}</p>
    </aside>
  )
}

/** /s/:code short link → the tournament or league page. */
export function ShortLink() {
  const state = useApi<{ path: string }>(`/s/${useParams().code}`)
  return (
    <main className="page">
      <Async state={state}>{(r) => <Navigate to={r.path} replace />}</Async>
    </main>
  )
}
