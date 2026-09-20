import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { type Tone, TONE_BG, TONE_TEXT } from './tone'

export interface StatTrend {
  /** Pre-formatted and signed, e.g. '+12%' or '-3 days'. Never computed here. */
  value: string
  direction: 'up' | 'down' | 'flat'
  /** What the movement is measured against, e.g. 'vs. prior 30 days'. */
  against?: string
  /**
   * Whether this movement is good news. Direction alone cannot say — more denials is bad,
   * more coverage is good — so the caller decides and the default stays in ink.
   */
  intent?: 'good' | 'bad' | 'neutral'
}

export interface StatTileProps {
  /** Short, uppercase in render. Say what the figure is. */
  label: string
  /** The headline figure. Accepts a node so a <CountUp> can be dropped in. */
  value: ReactNode
  /** Units, rendered beside the value. Always supply one unless the figure is a bare count. */
  unit?: string
  /** One muted line of provenance or caveat under the figure. */
  hint?: ReactNode
  /** Identity colour — paints the left rail, and the figure itself when that is legible. */
  tone?: Tone
  trend?: StatTrend
  /** Slot under the figure, sized for a <Sparkline>. */
  children?: ReactNode
  className?: string
}

/**
 * Tones whose text step is contrast-checked against every surface, so the headline figure may
 * wear them. The chart index is tuned for *marks* — chart-3 amber lands near 2.9:1 on white,
 * which is fine for a 3px rail and wrong for a number — so those tiles keep an ink figure and
 * take their identity from the rail instead. This is the "where appropriate" in the rule that
 * a series colour only ever reaches a number when that number is the tile's whole point.
 */
const INK_TONES = new Set<Tone>(['normal', 'suspicious', 'high-risk', 'accent'])

const TREND_ICON = { up: ArrowUpRight, down: ArrowDownRight, flat: Minus }

const TREND_INTENT: Record<NonNullable<StatTrend['intent']>, string> = {
  good: 'text-normal',
  bad: 'text-high-risk',
  neutral: 'text-fg-muted',
}

/**
 * One figure, stated like an exhibit: what it is, what it says, what it is measured in, and
 * where the number comes from.
 *
 * The rail is the whole trick. A 3px band of the entity's colour down the left edge gives the
 * tile an identity that repeats wherever that entity appears elsewhere on the page, without
 * tinting a card or colouring a word — so a grid of these reads as an index rather than as a
 * row of pastel boxes.
 */
export function StatTile({
  label,
  value,
  unit,
  hint,
  tone = 'neutral',
  trend,
  children,
  className,
}: StatTileProps) {
  const TrendIcon = trend ? TREND_ICON[trend.direction] : null

  return (
    <div
      className={cn(
        'group relative flex h-full flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-sm',
        'transition-shadow duration-200 ease-out-quint hover:shadow-md',
        className,
      )}
    >
      <span aria-hidden className={cn('absolute inset-y-0 left-0 w-[3px] rounded-l-lg', TONE_BG[tone])} />

      <div className="flex flex-1 flex-col gap-2.5 py-4 pr-4 pl-5">
        <div className="flex items-start justify-between gap-3">
          <span className="font-mono text-caption text-fg-subtle uppercase tracking-[0.08em]">{label}</span>
          {trend && TrendIcon ? (
            <span
              title={trend.against}
              className={cn(
                'inline-flex shrink-0 items-center gap-1 rounded-sm border border-border bg-chip px-1.5 py-0.5',
                'font-mono text-[0.6875rem] tabular-nums',
                TREND_INTENT[trend.intent ?? 'neutral'],
              )}
            >
              <TrendIcon aria-hidden className="size-3" strokeWidth={2.25} />
              {trend.value}
            </span>
          ) : null}
        </div>

        <div className="flex flex-wrap items-baseline gap-x-1.5">
          <span
            className={cn(
              'font-mono text-[2rem] leading-none tabular-nums',
              INK_TONES.has(tone) ? TONE_TEXT[tone] : 'text-fg',
            )}
          >
            {value}
          </span>
          {unit ? (
            <span className="font-mono text-caption text-fg-subtle uppercase tracking-[0.08em]">{unit}</span>
          ) : null}
        </div>

        {children ? <div className="pt-0.5">{children}</div> : null}

        {hint || trend?.against ? (
          // mt-auto pins the provenance to the bottom, so a row of tiles keeps one baseline
          // even when one of them carries a sparkline and the others do not.
          <div className="mt-auto flex flex-col gap-0.5 pt-1">
            {trend?.against ? (
              <p className="font-mono text-[0.6875rem] text-fg-subtle tabular-nums">{trend.against}</p>
            ) : null}
            {hint ? <p className="text-caption font-normal text-fg-muted tracking-normal">{hint}</p> : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}
