import { useState } from 'react'
import { t } from '../i18n/index.ts'
import { applyTheme, readTheme } from './theme.ts'
import type { Theme } from './theme.ts'

const SUN = (
  <>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" />
  </>
)
const MOON = <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5Z" />

/** Light / dark switch; the choice is kept per browser and applied before the first paint. */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(readTheme)
  const pick = (next: Theme) => {
    applyTheme(next)
    setTheme(next)
  }
  return (
    <div className="seg seg--icons" role="group" aria-label={t.common.theme}>
      {(
        [
          ['light', t.common.themeLight, SUN],
          ['dark', t.common.themeDark, MOON],
        ] as const
      ).map(([value, label, icon]) => (
        <button
          key={value}
          type="button"
          aria-pressed={theme === value}
          aria-label={label}
          title={label}
          onClick={() => pick(value)}
        >
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            {icon}
          </svg>
        </button>
      ))}
    </div>
  )
}
