import { useSession } from '../app/auth.tsx'
import { t } from '../i18n/index.ts'
import { LOCALES, LOCALE_LABEL, isLocale, locale } from '../i18n/locale.ts'

export function LangSelect() {
  const { changeLocale } = useSession()
  return (
    <select aria-label={t.common.language} value={locale} onChange={(e) => isLocale(e.target.value) && void changeLocale(e.target.value)}>
      {LOCALES.map((l) => (
        <option key={l} value={l}>
          {LOCALE_LABEL[l]}
        </option>
      ))}
    </select>
  )
}

export function LangLinks() {
  const { changeLocale } = useSession()
  return (
    <span>
      {LOCALES.map((l, i) => (
        <span key={l}>
          {i > 0 && ' · '}
          <button
            type="button"
            aria-current={l === locale}
            onClick={() => void changeLocale(l)}
            style={{ background: 'none', border: 0, padding: 0, font: 'inherit', color: 'inherit', cursor: 'pointer', fontWeight: l === locale ? 700 : 400, textDecoration: l === locale ? 'underline' : 'none' }}
          >
            {LOCALE_LABEL[l]}
          </button>
        </span>
      ))}
    </span>
  )
}
