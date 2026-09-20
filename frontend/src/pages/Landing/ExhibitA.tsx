import { Check } from 'lucide-react'
import { CodeBlock } from '@/components/ui/code-block'
import { EXHIBIT } from './data'
import { Section, Stamp } from './parts'

/**
 * The most persuasive artifact in the product, so it is the only section that breaks the
 * page's two-column template: the heading runs larger, and the evidence spans the full
 * container instead of sitting in a right-hand column. Importance is expressed structurally,
 * not just by order — this must not read as a peer of the R1-R5 reference table.
 *
 * Running the log lines full width also lets them sit on one line at desktop, so the reader
 * sees the whole request without scrolling.
 */
export function ExhibitA() {
  const { count, denial, grant, query, proof, factId, provenanceHashShort } = EXHIBIT

  return (
    <Section id="exhibit" className="py-16 sm:py-20">
      <Stamp>Exhibit A · fact {factId}</Stamp>

      <div className="mt-7 grid gap-x-12 gap-y-6 lg:grid-cols-12">
        <h2 className="font-serif text-[clamp(2.25rem,4.6vw,3.5rem)] leading-[1.02] tracking-[-0.025em] lg:col-span-6">
          The same request,
          <br />
          refused {count} times.
        </h2>
        <div className="lg:col-span-6 lg:pt-3">
          <p className="max-w-[52ch] text-body text-fg-muted">
            One account. One file. One source address. For seven months the server answered{' '}
            <span className="font-mono text-fg">403</span>. Then it answered{' '}
            <span className="font-mono text-fg">200</span> and sent 8.46 MB.
          </p>
          <p className="mt-4 max-w-[52ch] text-body text-fg-muted">
            That is a measured change in observed behaviour. It is not a finding of wrongdoing: an
            approved access grant looks exactly the same from the log. So the count is shown with the
            query that produced it, rather than as a conclusion.
          </p>
        </div>
      </div>

      {/* Full-bleed evidence. The two lines are the argument; nothing shares their row. */}
      <div className="mt-12">
        <CodeBlock label={`before · line ${denial.line} · ${denial.when}`} code={denial.raw} />

        <div className="flex items-center gap-6 py-6 pl-6 sm:gap-8 sm:pl-10">
          <div aria-hidden className="h-16 w-px shrink-0 bg-border-strong sm:h-20" />
          <span className="font-mono text-[clamp(3.25rem,8vw,5.5rem)] text-fg leading-[0.85] tracking-[-0.05em] tabular-nums">
            {count}
          </span>
          <span className="max-w-[30ch] text-body text-fg-muted">
            prior <span className="font-mono text-fg">403</span> responses for this exact account and
            resource, counted under the same cutoff.
          </span>
        </div>

        <CodeBlock
          label={`after · line ${grant.line} · ${grant.when}`}
          code={grant.raw}
          className="border-high-risk/40"
        />
      </div>

      <div className="mt-8 grid gap-x-12 gap-y-6 rounded-lg border border-border bg-surface p-5 sm:p-6 lg:grid-cols-12">
        <div className="lg:col-span-5">
          <div className="flex flex-wrap items-center gap-2">
            <Check className="size-3.5 text-normal" />
            <span className="font-mono text-caption text-fg uppercase">Recomputed on request</span>
          </div>
          <p className="mt-3 max-w-[46ch] text-body text-fg-muted">
            The console re-runs this query against the original lines under the same cutoff and
            compares the result to what was recorded. The {count} denials are pageable one by one.
          </p>
          <p className="mt-3 font-mono text-mono text-fg-subtle">
            recorded {proof.recorded} · recomputed {proof.recomputed} ·{' '}
            <span className="text-normal">{proof.matches ? 'match' : 'MISMATCH'}</span>
          </p>
        </div>

        <dl className="grid gap-x-6 gap-y-1.5 font-mono text-mono sm:grid-cols-[7rem_1fr] lg:col-span-7">
          {[
            ['query', `${query.id} v${query.version}`],
            ['account', query.params.account],
            ['path', query.params.path],
            ['status', String(query.params.status)],
            ['before_seq', String(query.params.before_seq)],
            ['provenance', provenanceHashShort],
          ].map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-fg-subtle">{k}</dt>
              <dd className="break-all text-fg-muted">{v}</dd>
            </div>
          ))}
        </dl>
      </div>
    </Section>
  )
}
