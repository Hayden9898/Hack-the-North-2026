import { ArrowRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { StatusChip } from '@/components/ui/status-chip'
import { CodeBlock } from '@/components/ui/code-block'
import { DATASET, EXHIBIT, RUN } from './data'
import { Section, Stamp } from './parts'

/**
 * Asymmetric on purpose: the argument occupies seven columns and the record five, so the
 * page opens with a clear primary read instead of a centred hero.
 */
export function OpeningStatement() {
  return (
    <Section className="pt-14 pb-16 sm:pt-20 sm:pb-20">
      <div className="grid gap-x-12 gap-y-12 lg:grid-cols-12">
        <div className="min-w-0 lg:col-span-7">
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

          <ProofCapsule />

          <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
            <Button asChild size="lg" className="w-full sm:w-auto">
              <Link to="/app">
                Open the console
                <ArrowRight className="size-4" />
              </Link>
            </Button>
            <Button asChild variant="outline" size="lg" className="w-full sm:w-auto">
              <a href="#exhibit">See the 77-denial proof</a>
            </Button>
          </div>
        </div>

        <div className="min-w-0 lg:col-span-5">
          <Record />
        </div>
      </div>
    </Section>
  )
}

function ProofCapsule() {
  const { count, proof, grant } = EXHIBIT
  return (
    <a
      href="#exhibit"
      className="mt-8 block rounded-doc border border-border bg-surface p-4 transition-colors duration-150 hover:border-border-strong"
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-mono text-caption text-fg-subtle uppercase">Worked example</span>
        <span className="font-mono text-caption text-fg-subtle">
          recorded {proof.recorded} · recomputed {proof.recomputed} ·{' '}
          <span className="text-normal">{proof.matches ? 'match' : 'MISMATCH'}</span>
        </span>
      </div>
      <p className="mt-2 text-body text-fg-muted">
        <span className="font-mono text-fg">403</span> for seven months, then{' '}
        <span className="font-mono text-fg">200</span> — after{' '}
        <span className="font-mono text-fg">{count}</span> counted denials of the same request.
      </p>
      <CodeBlock
        className="mt-3 border-0 bg-transparent"
        code={grant.raw}
        emphasize={['200 8459200']}
        copyable={false}
        wrap="always"
      />
    </a>
  )
}

function Record() {
  // admitted_seq on the run equals the dataset line count: everything was replayed.
  // The rows are ordered so the arithmetic closes: warmup + scored = lines replayed.
  const scored = RUN.visibleNormal + RUN.visibleSuspicious + RUN.visibleHighRisk
  const rows: [string, string, string?][] = [
    ['lines replayed', DATASET.lines.toLocaleString()],
    ['rejected', `${DATASET.rejects}`],
    ['warmup — history, not scored', RUN.warmupNormal.toLocaleString()],
    ['scored in the March window', scored.toLocaleString()],
    ['scoring mode', `${RUN.modelHealth} — no model in this run`],
  ]
  return (
    <div className="rounded-doc border border-border bg-surface">
      <div className="flex items-center justify-between border-border border-b px-5 py-3">
        <span className="font-mono text-caption text-fg-subtle uppercase">Run record</span>
        <span className="font-mono text-caption text-fg-subtle">{RUN.state}</span>
      </div>

      <dl className="divide-y divide-border">
        {rows.map(([k, v]) => (
          <div
            key={k}
            className="flex flex-col gap-0.5 px-5 py-2.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4"
          >
            <dt className="text-body text-fg-muted">{k}</dt>
            <dd className="min-w-0 font-mono text-body text-fg tabular-nums [overflow-wrap:anywhere] sm:text-right">
              {v}
            </dd>
          </div>
        ))}
      </dl>

      <div className="border-border border-t px-5 py-4">
        <p className="font-mono text-caption text-fg-subtle uppercase">
          Verdicts · {scored.toLocaleString()} scored
        </p>
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
