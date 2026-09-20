import { RotateCw, TriangleAlert } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { Button } from './button'

/**
 * A failure the user needs to know about. Deliberately styled with the `blocked` processing
 * token rather than the `high_risk` verdict token: a fetch failure is an infrastructure
 * problem, not a threat classification, and must not read as one.
 *
 * Always show what actually failed. This product's credibility rests on never implying it
 * has data it does not have.
 */
export function ErrorState({
  title = 'Could not load this',
  detail,
  onRetry,
  retryLabel = 'Retry',
  className,
  compact = false,
  children,
}: {
  title?: ReactNode
  /** The real error text or status. Show it — do not swallow it. */
  detail?: ReactNode
  onRetry?: () => void
  retryLabel?: string
  className?: string
  compact?: boolean
  children?: ReactNode
}) {
  return (
    <div
      data-slot="error-state"
      role="alert"
      className={cn(
        'state-hatch flex flex-col items-start gap-2 rounded-lg border border-blocked/45 text-blocked',
        compact ? 'px-4 py-4' : 'px-6 py-8',
        className,
      )}
    >
      <div className="flex items-center gap-2">
        <TriangleAlert className="size-4 shrink-0" />
        <p className="font-medium text-fg text-heading">{title}</p>
      </div>
      {detail ? <p className="max-w-[70ch] font-mono text-mono text-fg-muted">{detail}</p> : null}
      {children}
      {onRetry ? (
        <Button type="button" variant="outline" size="sm" onClick={onRetry} className="mt-2">
          <RotateCw className="size-3.5" />
          {retryLabel}
        </Button>
      ) : null}
    </div>
  )
}
