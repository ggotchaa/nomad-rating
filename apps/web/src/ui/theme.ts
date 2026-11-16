export type Theme = 'light' | 'dark'

export const THEMES: Theme[] = ['light', 'dark']
const KEY = 'nomad.theme'
/** Light is what the product ships with; dark is the original «hologram court» look. */
export const DEFAULT_THEME: Theme = 'light'

export const isTheme = (v: unknown): v is Theme => v === 'light' || v === 'dark'

export function readTheme(): Theme {
  try {
    const stored = localStorage.getItem(KEY)
    if (isTheme(stored)) return stored
  } catch {
    // storage unavailable
  }
  return DEFAULT_THEME
}

/** index.html sets the attribute before first paint; this keeps it in sync afterwards. */
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#03050b' : '#ffffff')
  try {
    localStorage.setItem(KEY, theme)
  } catch {
    // storage unavailable
  }
}
