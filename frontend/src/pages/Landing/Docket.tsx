import { ArrowUpRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import { cn } from '@/lib/cn'
import { StatusChip } from '@/components/ui/status-chip'
import { INCIDENTS, RUN } from './data'
import { Reveal, RuleTag, Section, Stamp } from './parts'

/**
 * A numbered docket rather than a card grid. High-risk entries get the larger type and the
 * full-width row; the suspicious one is deliberately quieter. Importance drives size — a
 * uniform three-card grid would flatten exactly the distinction the product exists to make.
 */
export function Docket() {
  return (
    <Section id="docket" className="py-16 sm:py-20">
      <Stamp>March 2026 · {RUN.incidentsTotal} incidents · rules only</Stamp>

      <h2 className="mt-7 max-w-[22ch] font-serif text-[clamp(1.875rem,3.6vw,2.75rem)] leading-[1.05] tracking-[-0.02em]">
        Three things in eight months looked wrong.
      </h2>
      <p className="mt-5 max-w-[58ch] text-body text-fg-muted">
        Everything below is the detector's own wording, including the parts where it declines to
        conclude anything. The qualifier is not a disclaimer bolted on afterwards — it is part of
        the record.
      </p>

      <ol className="mt-10 flex flex-col">
        {INCIDENTS.map((inc, i) => {
          const major = inc.verdict === 'high_risk'
          return (
            <Reveal key={inc.docket} delay={i * 0.06}>
              <li
                className={cn(
                  'grid grid-cols-1 gap-x-8 gap-y-4 border-border border-t py-8 sm:grid-cols-[auto_1fr]',
                  i === INCIDENTS.length - 1 && 'border-b',
                )}
              >
                <div className="flex items-center gap-4 sm:w-24 sm:flex-col sm:items-start sm:gap-3">
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
                      <RuleTag key={r}>{r}</RuleTag>
                    ))}
                    <span className="font-mono text-caption text-fg-subtle">{inc.key}</span>
                  </div>

                  <h3
                    className={cn(
                      'mt-3 max-w-[54ch] text-pretty',
                      major
                        ? 'font-medium text-[1.3125rem] text-fg leading-[1.3] tracking-[-0.015em]'
                        : 'font-medium text-heading text-fg-muted',
                    )}
                  >
                    {inc.headline}
                  </h3>

                  <p className="mt-3 max-w-[64ch] border-border-strong border-l-2 pl-4 text-body text-fg-muted italic">
                    {inc.qualifier}
                  </p>

                  <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 font-mono text-caption text-fg-subtle">
                    <span>{inc.when}</span>
                    <span>seq {inc.span}</span>
                    <Link
                      to="/app"
                      className="inline-flex items-center gap-1 text-accent transition-opacity duration-150 hover:opacity-80"
                    >
                      open in console <ArrowUpRight className="size-3" />
                    </Link>
                  </div>
                </div>
              </li>
            </Reveal>
          )
        })}
      </ol>
    </Section>
  )
}
