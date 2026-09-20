import { CircleCheckIcon, InfoIcon, Loader2Icon, OctagonXIcon, TriangleAlertIcon } from 'lucide-react'
import type { CSSProperties } from 'react'
import { Toaster as Sonner, type ToasterProps } from 'sonner'
import { useTheme } from '@/lib/theme-context'

// Diverges from the stock shadcn file in one way: it reads our own ThemeProvider instead of
// next-themes, which this app does not use.
function Toaster({ ...props }: ToasterProps) {
  const { resolved } = useTheme()

  return (
    <Sonner
      theme={resolved}
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          '--normal-bg': 'var(--color-surface-raised)',
          '--normal-text': 'var(--color-fg)',
          '--normal-border': 'var(--color-border)',
          '--border-radius': 'var(--radius-lg)',
        } as CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
