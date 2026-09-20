import { ArrowUpRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import { cn } from '@/lib/cn'
import { StatusChip } from '@/components/ui/status-chip'
import { INCIDENTS, RULE_TEXT, RUN } from './data'
import { RuleTag, Section, Stamp } from './parts'
import { SpotlightRow } from './interactive'

/**
 * A numbered docket rather than a card grid. High-risk entries get the larger type; the
 * suspicious one is deliberately quieter. Importance drives size — a uniform three-card grid
 * would flatten exactly the distinction the product exists to make.
 *
 * Three columns, not two: the metadata sits flush against the end of the row rule so the row
 * resolves across the full measure instead of leaving a dead right third under a rule that
 * spans it.
 */
export function Docket() {
  return (
    <Section id="docket" className="py-16 sm:py-20">
      <Stamp>Docket · {RUN.incidentsTotal} incidents · March 2026 · rules only</Stamp>

      <h2 className="mt-7 max-w-[22ch] font-serif text-[clamp(1.875rem,3.6vw,2.75rem)] leading-[1.05] tracking-[-0.02em]">
        Three things in eight months looked wrong.
      </h2>
      <p className="mt-5 max-w-[58ch] text-body text-fg-muted">
        Everything below is the detector's own wording, including the parts where it declines to
        conclude anything. Those qualifiers are part of the record.
      </p>

      <ol className="mt-10 flex flex-col">
        {INCIDENTS.map((inc, i) => {
          const major = inc.verdict === 'high_risk'
          return (
            <SpotlightRow
              key={inc.docket}
              className={cn(
                'grid grid-cols-1 gap-x-8 gap-y-4 border-border border-t py-8',
                'sm:grid-cols-[5rem_minmax(0,1fr)] lg:grid-cols-[5rem_minmax(0,1fr)_13rem]',
                i === INCIDENTS.length - 1 && 'border-b',
              )}
            >
              <div className="flex items-center gap-4 sm:flex-col sm:items-start sm:gap-3">
                <span
                  className={cn(
                    'font-mono tabular-nums',
                    major ? 'text-title text-fg' : 'text-heading text-fg-subtle',
                  )}
                >
                  {inc.docket}
                </span>
                <StatusChip verdict={inc.verdict} size="sm" />
              </div>

              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  {inc.rules.map((r) => (
                    <RuleTag key={r} href={`#${r.toLowerCase()}`} title={`${r} — ${RULE_TEXT[r]}`}>
                      {r}
                    </RuleTag>
                  ))}
                  <span className="font-mono text-caption text-fg-subtle">{inc.key}</span>
                </div>

                <h3
                  className={cn(
                    'mt-3 max-w-[50ch] text-pretty',
                    major
                      ? 'font-medium text-[1.3125rem] text-fg leading-[1.3] tracking-[-0.015em]'
                      : 'font-medium text-heading text-fg-muted',
                  )}
                >
                  {inc.headline}
                </h3>

                <p className="mt-3 max-w-[58ch] border-border-strong border-l-2 pl-4 text-body text-fg-muted italic">
                  {inc.qualifier}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-x-5 gap-y-2 font-mono text-caption text-fg-subtle lg:flex-col lg:items-end lg:gap-2 lg:pt-1">
                <span>{inc.when}</span>
                <span>seq {inc.span}</span>
                <Link
                  to="/app"
                  className="inline-flex items-center gap-1 py-1 text-accent transition-opacity duration-150 hover:opacity-75"
                >
                  open incident {inc.docket} <ArrowUpRight className="size-3" />
                </Link>
              </div>
            </SpotlightRow>
          )
        })}
      </ol>
    </Section>
  )
}
