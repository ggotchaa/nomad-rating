import { useState } from 'react'
import { Link } from 'react-router'
import { t } from '../../i18n/index.ts'
import { QrImage } from '../conduct/Checkin.tsx'

/** Share link + QR code (R-20, T-8); OG preview is served by /api/og/t/:slug for crawlers. */
export function ShareBox({ slug, url, live }: { slug: string; url: string; live: boolean }) {
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
      {live && (
        <Link className="button button--primary button--block" to={`/t/${slug}/live`}>
          {t.live.open}
        </Link>
      )}
    </aside>
  )
}
