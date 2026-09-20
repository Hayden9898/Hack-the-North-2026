import { ArrowRight, Ban, ChevronRight, Sigma } from 'lucide-react'
import type { Fact } from '../../../api'
import { fmtNum } from '../../../format'
import { cn } from '@/lib/cn'
import { claimView, scopeStatements, type GroupedFacts } from './facts'

/**
 * The argument, ranked.
 *
 * Claim figures are ~32px here, not hero-sized: the >=48px hero belongs to the evidence drawer,
 * so there is exactly one hero per view and opening a claim reads as an escalation rather than
 * a repetition.
 */
export function ProofRail({
  grouped,
  onShowEvidence,
}: {
  grouped: GroupedFacts
  onShowEvidence: (f: Fact) => void
}) {
  const { claims, scope, context, observed } = grouped
  if (claims.length === 0 && !scope && context.length === 0 && observed.length === 0) {
    return <p className="text-body text-fg-muted">No facts were recorded for this version.</p>
  }

  return (
    <div className="space-y-6">
      {claims.length > 0 ? (
        <section aria-labelledby="proof-claims">
          <RailLabel id="proof-claims">What the detector is claiming</RailLabel>
          <ul className="grid gap-3">
            {claims.map((f) => (
              <li key={f.fact_id}>
                <ClaimCard fact={f} onShowEvidence={onShowEvidence} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {scope ? <ScopePanel scope={scope} /> : null}

      {context.length > 0 ? (
        <section aria-labelledby="proof-context">
          <RailLabel id="proof-context">Context it was measured against</RailLabel>
          <ul className="grid gap-2 sm:grid-cols-2">
            {context.map((f) => (
              <li key={f.fact_id}>
                <ContextChip fact={f} onShowEvidence={onShowEvidence} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {observed.length > 0 ? <ObservedEvents facts={observed} onShowEvidence={onShowEvidence} /> : null}
    </div>
  )
}

function RailLabel({ children, id }: { children: React.ReactNode; id?: string }) {
  return (
    <h3 id={id} className="mb-2.5 text-caption text-fg-muted uppercase">
      {children}
    </h3>
  )
}

function ClaimCard({ fact, onShowEvidence }: { fact: Fact; onShowEvidence: (f: Fact) => void }) {
  const v = claimView(fact)
  const hasEvidence = fact.evidence_event_ids.length > 0 || !!fact.query
  const Wrapper = hasEvidence ? 'button' : 'div'

  return (
    <Wrapper
      {...(hasEvidence
        ? {
            type: 'button' as const,
            onClick: () => onShowEvidence(fact),
            'aria-label': `Show the evidence behind ${v.figure ?? ''} ${v.label}`,
          }
        : {})}
      className={cn(
        'group/claim flex w-full items-start gap-4 rounded-lg border border-border bg-surface px-4 py-3.5 text-left',
        hasEvidence &&
          'cursor-pointer transition-colors hover:border-border-strong hover:bg-hover focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none',
      )}
    >
      {v.figure !== null ? (
        <span
          className={cn(
            'min-w-[4.25rem] shrink-0 font-sans text-[2rem] leading-none font-semibold tracking-tight text-fg',
            // Never a verdict token here: this is a counted value, not a classification.
            // Colouring it `suspicious` would make a status colour impersonate data.
            v.emphasisZero && 'text-fg',
          )}
        >
          {v.figure}
        </span>
      ) : null}

      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-heading text-fg">{v.label}</span>
          {v.recomputable ? <ProvableTag /> : null}
        </span>
        {v.detail ? <span className="mt-1 block max-w-[62ch] text-body text-fg-muted">{v.detail}</span> : null}
      </span>

      {hasEvidence ? (
        <span className="mt-1 flex shrink-0 items-center gap-1.5 text-caption text-fg-muted normal-case tracking-normal group-hover/claim:text-accent">
          {fact.evidence_event_ids.length > 0 ? `${fmtNum(fact.evidence_event_ids.length)} lines` : 'proof'}
          <ArrowRight className="size-3.5" aria-hidden />
        </span>
      ) : null}
    </Wrapper>
  )
}

/** Marks a fact the API can recount live against the raw rows — the reproducibility claim. */
function ProvableTag() {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-sm border border-accent/35 px-1.5 py-0.5 text-[0.6875rem] font-medium text-accent"
      title="This value carries a query the API can replay against the raw rows under the same cutoff."
    >
      <Sigma className="size-3" aria-hidden />
      recountable
    </span>
  )
}

/**
 * What the incident explicitly does not assert.
 *
 * Deliberately not styled as a finding and never in a verdict colour: it is the product's
 * honesty surface, and dressing it up as evidence would invert its meaning.
 */
function ScopePanel({ scope }: { scope: Fact }) {
  const statements = scopeStatements(scope)
  if (statements.length === 0) return null
  return (
    <section aria-labelledby="proof-scope" className="rounded-lg border border-dashed border-border-strong bg-surface px-4 py-3.5">
      <h3 id="proof-scope" className="flex items-center gap-2 text-caption text-fg-muted uppercase">
        <Ban className="size-3.5" aria-hidden />
        This incident does not assert
      </h3>
      <ul className="mt-2.5 grid gap-1.5">
        {statements.map((s) => (
          <li key={s} className="flex gap-2 text-body text-fg-muted">
            <span aria-hidden className="select-none text-fg-subtle">
              —
            </span>
            <span>{s}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

function ContextChip({ fact, onShowEvidence }: { fact: Fact; onShowEvidence: (f: Fact) => void }) {
  const v = claimView(fact)
  const clickable = !!fact.query || fact.evidence_event_ids.length > 0
  return (
    <button
      type="button"
      disabled={!clickable}
      onClick={() => clickable && onShowEvidence(fact)}
      className={cn(
        'flex w-full items-baseline justify-between gap-3 rounded-md border border-border bg-surface px-3 py-2 text-left',
        clickable
          ? 'cursor-pointer hover:border-border-strong hover:bg-hover focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none'
          : 'cursor-default',
      )}
    >
      <span className="min-w-0 truncate text-body text-fg-muted">{v.label}</span>
      <span className="max-w-[55%] shrink-0 truncate font-mono text-mono text-fg" title={compact(v.figure, fact)}>
        {compact(v.figure, fact)}
      </span>
    </button>
  )
}

/** Context values are often objects; show the one number that matters rather than a JSON dump. */
function compact(figure: string | null, fact: Fact): string {
  if (figure !== null) return figure
  const v = fact.value
  if (v && typeof v === 'object') {
    const entries = Object.entries(v as Record<string, unknown>).filter(([, x]) => typeof x === 'number')
    if (entries.length) {
      const head = entries.slice(0, 2).map(([k, x]) => `${k.replaceAll('_', ' ')} ${fmtNum(x as number)}`).join(' · ')
      return entries.length > 2 ? `${head} +${entries.length - 2}` : head
    }
    return `${Object.keys(v as object).length} fields`
  }
  return String(v ?? '—')
}

/**
 * The 81 raw observed events, collapsed. Native <details> so it works without JS, keyboard-
 * navigates for free, and respects reduced motion by having no animation to suppress.
 */
function ObservedEvents({ facts, onShowEvidence }: { facts: Fact[]; onShowEvidence: (f: Fact) => void }) {
  return (
    <details className="group/obs rounded-lg border border-border bg-surface">
      <summary className="group/sum flex cursor-pointer list-none items-center gap-3 px-4 py-3 text-body text-fg-muted hover:text-fg focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none">
        <ChevronRight className="size-3.5 shrink-0 transition-transform group-open/sum:rotate-90 motion-reduce:transition-none" aria-hidden />
        <span className="flex-1">
          <span className="font-medium text-fg">{fmtNum(facts.length)} observed events</span> recorded as evidence for
          this incident
        </span>
        <span className="shrink-0 text-caption normal-case tracking-normal group-open/obs:hidden">show</span>
        <span className="hidden shrink-0 text-caption normal-case tracking-normal group-open/obs:inline">hide</span>
      </summary>
      <ul className="max-h-96 overflow-y-auto border-t border-border">
        {facts.map((f) => {
          const v = (f.value ?? {}) as Record<string, unknown>
          return (
            <li key={f.fact_id}>
              <button
                type="button"
                onClick={() => onShowEvidence(f)}
                className="flex w-full items-baseline gap-3 border-b border-border/50 px-4 py-1.5 text-left font-mono text-mono last:border-0 hover:bg-hover focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
              >
                <span className="w-16 shrink-0 text-right tabular-nums text-fg-subtle">{String(v.line_number ?? v.run_seq ?? '')}</span>
                <span className="w-44 shrink-0 truncate text-fg-muted">{String(v.account ?? '')}@{String(v.ip ?? '')}</span>
                <span className="min-w-0 flex-1 truncate text-fg">
                  {String(v.method ?? '')} {String(v.path ?? '')}
                </span>
                <span className="shrink-0 tabular-nums text-fg-muted">{String(v.status ?? '')}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </details>
  )
}
