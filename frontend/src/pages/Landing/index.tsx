import { ArrowRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import { ThemeToggle } from '@/components/ThemeToggle'
import { Button } from '@/components/ui/button'
import { CodeInline } from '@/components/ui/code-block'
import { StatusChip } from '@/components/ui/status-chip'

/*
 * Phase 0 placeholder. Real, verifiable numbers only — see §1 of the Agent A brief.
 * This gets designed properly in the iterate loop; it exists now so `/` is not a 404
 * while Agent B is unblocked.
 */
export function Landing() {
  return (
    <div className="min-h-dvh bg-bg text-fg">
      <header className="flex items-center justify-between border-border border-b px-6 py-4">
        <span className="font-serif text-title">Log &amp; Order</span>
        <div className="flex items-center gap-3">
          <ThemeToggle />
          <Button asChild size="sm">
            <Link to="/app">
              Open console <ArrowRight className="size-3.5" />
            </Link>
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-[72ch] px-6 py-16">
        <h1 className="font-serif text-display">Every claim resolves to a log line.</h1>
        <p className="mt-6 max-w-[62ch] text-body text-fg-muted">
          Log &amp; Order replays 180,800 HTTP access-log events in causal order, flags them with five
          deterministic rules, and groups the matches into incidents built from typed, provable facts.
          Open any claim and you get the original evidence — not a summary of it.
        </p>

        <dl className="mt-10 grid grid-cols-2 gap-6 sm:grid-cols-4">
          {[
            ['180,800', 'events imported'],
            ['0', 'rejected rows'],
            ['3', 'incidents found'],
            ['77', 'denials before the grant'],
          ].map(([n, label]) => (
            <div key={label}>
              <dt className="font-mono text-title tabular-nums">{n}</dt>
              <dd className="mt-1 text-caption text-fg-subtle uppercase">{label}</dd>
            </div>
          ))}
        </dl>

        <div className="mt-10 flex flex-wrap items-center gap-3 text-body text-fg-muted">
          <StatusChip verdict="high_risk" />
          <span>
            escalated at line <CodeInline>168338</CodeInline>
          </span>
          <StatusChip state="pending" />
          <span>is a processing state, never a verdict</span>
        </div>

        <p className="mt-10 border-border border-t pt-6 text-caption text-fg-subtle">
          Running in rules_only mode — no model artifacts are present on this machine, so every verdict
          shown comes from the deterministic rules. Reported as-is rather than hidden.
        </p>
      </main>
    </div>
  )
}
