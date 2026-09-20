import { CircleCheckIcon, InfoIcon, Loader2Icon, OctagonXIcon, TriangleAlertIcon } from 'lucide-react'
import type { CSSProperties } from 'react'
import { Toaster as Sonner, type ToasterProps } from 'sonner'
import { cn } from '@/lib/cn'
import { useTheme } from '@/lib/theme-context'

// Diverges from the stock shadcn file in one way: it reads our own ThemeProvider instead of
// next-themes, which this app does not use.
// className/style/icons are merged rather than spread over: `{...props}` last would let a
// caller passing any one of them silently drop the theme token block or the icon set.
function Toaster({ className, style, icons, ...props }: ToasterProps) {
  const { resolved } = useTheme()

  return (
    <Sonner
      theme={resolved}
      className={cn('toaster group', className)}
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
        ...icons,
      }}
      style={
        {
          '--normal-bg': 'var(--color-surface-raised)',
          '--normal-text': 'var(--color-fg)',
          '--normal-border': 'var(--color-border)',
          '--border-radius': 'var(--radius-lg)',
          ...style,
        } as CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
