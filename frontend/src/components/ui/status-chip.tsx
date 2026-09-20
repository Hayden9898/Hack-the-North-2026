import { Ban, CircleX, Clock, History, OctagonAlert, ShieldCheck, TriangleAlert } from 'lucide-react'
import type { ComponentType } from 'react'
import { cn } from '@/lib/cn'

/** The three threat classes. Mirrors `ThreatClass` in src/api.ts. */
export type Verdict = 'normal' | 'suspicious' | 'high_risk'

/**
 * Record processing states. Architecture invariant #6: these are NOT a fourth threat class
 * and must never read as a clean verdict.
 */
export type ProcessingState = 'pending' | 'late' | 'blocked' | 'failed'

type Meta = { label: string; icon: ComponentType<{ className?: string }>; title: string }

const VERDICT: Record<Verdict, Meta> = {
  normal: {
    label: 'normal',
    icon: ShieldCheck,
    title: 'No rule matched this event.',
  },
  suspicious: {
    label: 'suspicious',
    icon: TriangleAlert,
    title: 'A detection rule matched. Review when convenient.',
  },
  high_risk: {
    label: 'high risk',
    icon: OctagonAlert,
    title: 'Urgently investigate. This is a priority signal, not a finding of wrongdoing.',
  },
}

const PROCESSING: Record<ProcessingState, Meta & { tone: string }> = {
  pending: {
    label: 'pending',
    icon: Clock,
    tone: 'text-pending',
    title: 'Not yet scored. This is a processing state, not a verdict.',
  },
  late: {
    label: 'late',
    icon: History,
    tone: 'text-late',
    title: 'Arrived after its window closed. This is a processing state, not a verdict.',
  },
  blocked: {
    label: 'blocked',
    icon: Ban,
    tone: 'text-blocked',
    title: 'Processing is blocked. This is a processing state, not a verdict.',
  },
  failed: {
    label: 'failed',
    icon: CircleX,
    tone: 'text-blocked',
    title: 'Processing failed. This is a processing state, not a verdict.',
  },
}

const VERDICT_TONE: Record<Verdict, string> = {
  normal: 'text-normal bg-normal-wash border-normal/30',
  suspicious: 'text-suspicious bg-suspicious-wash border-suspicious/30',
  high_risk: 'text-high-risk bg-high-risk-wash border-high-risk/35',
}

type Size = 'sm' | 'md'

const SIZE: Record<Size, string> = {
  sm: 'gap-1 px-1.5 py-0.5 text-[0.6875rem] [&>svg]:size-3',
  md: 'gap-1.5 px-2 py-1 text-caption [&>svg]:size-3.5',
}

type Props = { size?: Size; className?: string; showIcon?: boolean } & (
  | { verdict: Verdict; state?: never }
  | { state: ProcessingState; verdict?: never }
)

/**
 * The only sanctioned way to render a verdict or a processing state.
 *
 *   <StatusChip verdict="high_risk" />
 *   <StatusChip state="late" />
 *
 * Never hand-pick a verdict colour in a page component — the semantics live here.
 *
 * Verdicts render as a tinted FILL. Processing states render as an OUTLINE with a diagonal
 * hatch and no fill. That difference is structural, so the two can never be confused — not
 * in greyscale, not by a colour-blind user, and not at a glance from across a demo table.
 */
export function StatusChip({ verdict, state, size = 'md', showIcon = true, className }: Props) {
  const isVerdict = verdict !== undefined
  const meta = isVerdict ? VERDICT[verdict] : PROCESSING[state]
  const Icon = meta.icon

  return (
    <span
      data-slot="status-chip"
      data-kind={isVerdict ? 'verdict' : 'processing'}
      data-value={isVerdict ? verdict : state}
      title={meta.title}
      className={cn(
        'inline-flex w-fit shrink-0 items-center whitespace-nowrap rounded-sm border font-medium',
        SIZE[size],
        isVerdict
          ? VERDICT_TONE[verdict]
          : cn('state-hatch border-current/45 bg-transparent uppercase tracking-wide', PROCESSING[state].tone),
        className,
      )}
    >
      {showIcon ? <Icon className="shrink-0" /> : null}
      {meta.label}
    </span>
  )
}

/**
 * Turns the API's `(threat_class, processing_status)` pair into the right chip input.
 *
 * An event that has not been fully processed has no trustworthy verdict, so processing
 * state wins over threat class — this is what stops a half-processed record from
 * rendering green.
 */
export function resolveStatus(
  threatClass: Verdict | null | undefined,
  processingStatus?: string | null,
): { verdict: Verdict } | { state: ProcessingState } {
  if (processingStatus && processingStatus !== 'processed') {
    if (processingStatus === 'late' || processingStatus === 'blocked' || processingStatus === 'failed') {
      return { state: processingStatus }
    }
    return { state: 'pending' }
  }
  if (!threatClass) return { state: 'pending' }
  return { verdict: threatClass }
}
