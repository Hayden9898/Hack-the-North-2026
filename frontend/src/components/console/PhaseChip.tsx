import type { Phase } from '../../api'
import { cn } from '@/lib/cn'

/**
 * Replay phase — warmup vs the visible window.
 *
 * This is not cosmetic. Warmup is history being replayed to rebuild state; those events are
 * not live model-evaluated decisions, and a run really does classify during it (a real run
 * here produced 6,264 normal and 136 suspicious warmup events). Rendering the two phases in
 * the same neutral outline chip meant the distinction was carried by reading the word.
 *
 * Warmup therefore gets the same diagonal-hatch treatment the design system reserves for
 * processing states, so the difference survives greyscale and colour blindness. The visible
 * window gets a solid chip. The difference is structural, not a hue.
 */
export function PhaseChip({ phase, className }: { phase: Phase | string | null | undefined; className?: string }) {
  const warmup = phase === 'warmup'
  return (
    <span
      data-phase={warmup ? 'warmup' : 'visible'}
      title={
        warmup
          ? 'Historical warmup: replayed to rebuild state. Not a live model-evaluated decision.'
          : 'Visible window: evaluated live under this run’s cutoff.'
      }
      className={cn(
        'inline-flex w-fit shrink-0 items-center whitespace-nowrap rounded-sm border px-1.5 py-0.5 text-[0.6875rem] font-medium uppercase',
        warmup ? 'state-hatch border-pending/50 text-pending' : 'border-border bg-surface-raised text-fg-muted',
        className,
      )}
    >
      {warmup ? 'historical warmup' : 'visible window'}
    </span>
  )
}
