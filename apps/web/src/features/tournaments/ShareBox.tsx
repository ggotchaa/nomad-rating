import { useState } from 'react'
import { Link, Navigate, useParams } from 'react-router'
import { useApi } from '../../app/hooks.ts'
import { Async } from '../../ui/kit.tsx'
import { t } from '../../i18n/index.ts'
import { QrImage } from '../conduct/Checkin.tsx'

/** Share link + QR code + messengers (R-20, T-8); OG preview is served by /api/og/{t,s}/… for crawlers. */
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
      <h2>{t.live.share}</h2>
      <QrImage text={url} size={160} />
      <button className="button button--block" onClick={() => void share()}>
        {copied ? t.live.linkCopied : t.live.copyLink}
      </button>
      <div className="row">
        <a className="button button--sm" href={`https://t.me/share/url?${new URLSearchParams({ url, ...(text && { text }) })}`} target="_blank" rel="noopener noreferrer">
          Telegram
        </a>
        <a className="button button--sm" href={`https://wa.me/?${new URLSearchParams({ text: text ? `${text} ${url}` : url })}`} target="_blank" rel="noopener noreferrer">
          WhatsApp
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

/** /s/:code short link → the tournament or league page. */
export function ShortLink() {
  const state = useApi<{ path: string }>(`/s/${useParams().code}`)
  return (
    <main className="page">
      <Async state={state}>{(r) => <Navigate to={r.path} replace />}</Async>
    </main>
  )
}
