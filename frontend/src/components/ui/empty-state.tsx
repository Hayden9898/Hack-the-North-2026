import type { ComponentType, ReactNode } from 'react'
import { cn } from '@/lib/cn'

/**
 * "There is genuinely nothing here" — never used to paper over an error or a still-loading
 * fetch. An empty state is a factual claim about the data; use <ErrorState> or <Skeleton>
 * for the other two cases.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
  compact = false,
}: {
  icon?: ComponentType<{ className?: string }>
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  className?: string
  compact?: boolean
}) {
  return (
    <div
      data-slot="empty-state"
      className={cn(
        'flex flex-col items-start gap-2 rounded-lg border border-dashed border-border bg-surface/40',
        compact ? 'px-4 py-5' : 'px-6 py-10',
        className,
      )}
    >
      {Icon ? <Icon className="size-5 text-fg-subtle" /> : null}
      <p className="font-medium text-fg text-heading">{title}</p>
      {description ? <p className="max-w-[60ch] text-body text-fg-muted">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  )
}
