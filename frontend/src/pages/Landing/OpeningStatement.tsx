import { ArrowRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { StatusChip } from '@/components/ui/status-chip'
import { DATASET, RUN } from './data'
import { Section, Stamp } from './parts'

/**
 * Asymmetric on purpose: the argument occupies seven columns and the record five, so the
 * page opens with a clear primary read instead of a centred hero.
 */
export function OpeningStatement() {
  return (
    <Section className="pt-16 pb-20 sm:pt-24 sm:pb-28">
      <div className="grid gap-x-12 gap-y-12 lg:grid-cols-12">
        <div className="lg:col-span-7">
          <Stamp>
            {DATASET.sha256Short} · {DATASET.lines.toLocaleString()} lines · {DATASET.from} — {DATASET.to}
          </Stamp>

          <h1 className="mt-7 font-serif text-[clamp(2.75rem,7vw,4.5rem)] leading-[0.95] tracking-[-0.03em]">
            An access log,
            <br />
            cross-examined.
          </h1>

          <p className="mt-7 max-w-[54ch] text-[1.0625rem] text-fg-muted leading-[1.65]">
            Log &amp; Order replays {DATASET.lines.toLocaleString()} HTTP requests in causal order, scores
            each one against five deterministic rules, and groups what matches into incidents built from
            typed facts. Every fact carries the query that produced it — so any claim on screen can be
            recomputed against the original lines, and disagreed with.
          </p>

          <div className="mt-9 flex flex-wrap items-center gap-3">
            <Button asChild size="lg">
              <Link to="/app">
                Open the console
                <ArrowRight className="size-4" />
              </Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <a href="#exhibit">See the 77-denial proof</a>
            </Button>
          </div>
        </div>

        <div className="lg:col-span-5">
          <Record />
        </div>
      </div>
    </Section>
  )
}

function Record() {
  // admitted_seq on the run equals the dataset line count: everything was replayed.
  const rows: [string, string][] = [
    ['lines replayed', DATASET.lines.toLocaleString()],
    ['rejected', `${DATASET.rejects}`],
    ['accounts', `${DATASET.accounts}`],
    ['late / backlogged', `${RUN.lateEvents} / ${RUN.backlog}`],
  ]
  return (
    <div className="rounded-xl border border-border bg-surface">
      <div className="flex items-center justify-between border-border border-b px-5 py-3">
        <span className="font-mono text-caption text-fg-subtle uppercase">Run record</span>
        <span className="font-mono text-caption text-fg-subtle">{RUN.state}</span>
      </div>

      <dl className="divide-y divide-border">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-baseline justify-between gap-4 px-5 py-2.5">
            <dt className="text-body text-fg-muted">{k}</dt>
            <dd className="font-mono text-body text-fg tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>

      <div className="border-border border-t px-5 py-4">
        <p className="font-mono text-caption text-fg-subtle uppercase">Verdicts in the visible window</p>
        <div className="mt-3 flex flex-col gap-2">
          <VerdictRow verdict="high_risk" n={RUN.visibleHighRisk} />
          <VerdictRow verdict="suspicious" n={RUN.visibleSuspicious} />
          <VerdictRow verdict="normal" n={RUN.visibleNormal} />
        </div>
      </div>
    </div>
  )
}

function VerdictRow({ verdict, n }: { verdict: 'normal' | 'suspicious' | 'high_risk'; n: number }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <StatusChip verdict={verdict} size="sm" />
      <span className="font-mono text-body text-fg tabular-nums">{n.toLocaleString()}</span>
    </div>
  )
}
