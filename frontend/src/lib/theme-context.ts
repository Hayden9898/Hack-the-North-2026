import { createContext, useContext } from 'react'

export type ThemePreference = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

export type ThemeContextValue = {
  /** What the user chose. */
  theme: ThemePreference
  /** What is actually on screen after resolving `system`. */
  resolved: ResolvedTheme
  setTheme: (t: ThemePreference) => void
}

export const ThemeContext = createContext<ThemeContextValue | null>(null)

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>')
  return ctx
}

export const THEME_STORAGE_KEY = 'logorder.theme'
