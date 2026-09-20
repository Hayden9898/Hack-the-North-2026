import { cn } from "@/lib/cn"

/**
 * A placeholder for data that has not arrived. Never a placeholder for data that does not
 * exist — use <EmptyState> or <ErrorState> for that.
 *
 * bg-chip sits one step off the paper, so the pulse stays subtle. The global
 * prefers-reduced-motion rule in styles/base.css stops the animation for users who ask.
 */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden
      className={cn("animate-pulse rounded-sm bg-chip", className)}
      {...props}
    />
  )
}

export { Skeleton }
