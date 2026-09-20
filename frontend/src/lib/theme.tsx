import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react'
import { type ResolvedTheme, ThemeContext, THEME_STORAGE_KEY, type ThemePreference } from './theme-context'

function readStored(): ThemePreference {
  try {
    const v = localStorage.getItem(THEME_STORAGE_KEY)
    if (v === 'light' || v === 'dark' || v === 'system') return v
  } catch {
    /* private mode / storage disabled — fall through to the default */
  }
  return 'light'
}

function systemTheme(): ResolvedTheme {
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

/**
 * Applies the resolved theme as a `dark` class on <html>, matching the
 * `@custom-variant dark` selector in styles/theme.css.
 *
 * Default is LIGHT. The page is built on embeddable's warm paper palette (#fafaf7 / #242635
 * ink) and the colour index only reads correctly against it — landing on dark would show the
 * selected second theme rather than the designed one. Dark remains fully supported via the
 * toggle. Switching to 'system' is a one-word change here if that is preferred.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemePreference>(readStored)
  const [systemResolved, setSystemResolved] = useState<ResolvedTheme>(systemTheme)

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: light)')
    const onChange = () => setSystemResolved(mq.matches ? 'light' : 'dark')
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const resolved: ResolvedTheme = theme === 'system' ? systemResolved : theme

  useEffect(() => {
    const root = document.documentElement
    root.classList.toggle('dark', resolved === 'dark')
    root.style.colorScheme = resolved
  }, [resolved])

  const setTheme = useCallback((t: ThemePreference) => {
    setThemeState(t)
    try {
      localStorage.setItem(THEME_STORAGE_KEY, t)
    } catch {
      /* non-fatal: the theme still applies for this session */
    }
  }, [])

  const value = useMemo(() => ({ theme, resolved, setTheme }), [theme, resolved, setTheme])
  return <ThemeContext value={value}>{children}</ThemeContext>
}
