import { Check } from 'lucide-react'
import { CodeBlock } from '@/components/ui/code-block'
import { EXHIBIT } from './data'
import { Reveal, Section, Stamp } from './parts'

/**
 * The most persuasive artifact in the product, so it is the largest thing on the page.
 *
 * Two byte-exact log lines seven months apart, the counted gap between them, and the query
 * that produces the count. A judge should be able to check the claim themselves from what is
 * on screen.
 */
export function ExhibitA() {
  const { count, denial, grant, query, proof, factId, provenanceHashShort } = EXHIBIT

  return (
    <Section id="exhibit" className="py-20 sm:py-24">
      <Stamp>Exhibit A · fact {factId}</Stamp>

      <div className="mt-7 grid gap-x-12 gap-y-10 lg:grid-cols-12">
        <div className="lg:col-span-5">
          <h2 className="font-serif text-[clamp(1.875rem,3.6vw,2.75rem)] leading-[1.05] tracking-[-0.02em]">
            The same request,
            <br />
            refused {count} times.
          </h2>
          <p className="mt-5 max-w-[46ch] text-body text-fg-muted">
            One account. One file. One source address. For seven months the server answered{' '}
            <span className="font-mono text-fg">403</span>. Then it answered{' '}
            <span className="font-mono text-fg">200</span> and sent 8.46 MB.
          </p>
          <p className="mt-4 max-w-[46ch] text-body text-fg-muted">
            That is a measured change in observed behaviour — not a finding of wrongdoing. An
            approved access grant looks exactly the same from the log. Which is why the count is
            shown with the query that produced it, rather than as a conclusion.
          </p>
        </div>

        <div className="lg:col-span-7">
          <Reveal>
            <CodeBlock
              label={`before · line ${denial.line} · ${denial.when}`}
              code={denial.raw}
              className="border-border"
            />
          </Reveal>

          <div className="flex items-stretch gap-5 py-5 pl-6">
            <div aria-hidden className="w-px shrink-0 bg-border" />
            <div className="flex items-baseline gap-4">
              <span className="font-mono text-[2.5rem] text-high-risk leading-none tabular-nums">
                {count}
              </span>
              <span className="max-w-[28ch] text-body text-fg-muted">
                prior <span className="font-mono">403</span> responses for this exact
                account and resource, counted under the same cutoff.
              </span>
            </div>
          </div>

          <Reveal delay={0.08}>
            <CodeBlock
              label={`after · line ${grant.line} · ${grant.when}`}
              code={grant.raw}
              className="border-high-risk/40"
            />
          </Reveal>

          <Reveal delay={0.12}>
            <div className="mt-6 rounded-lg border border-border bg-surface p-5">
              <div className="flex flex-wrap items-center gap-2">
                <Check className="size-3.5 text-normal" />
                <span className="font-mono text-caption text-fg uppercase">Recomputed on request</span>
                <span className="font-mono text-caption text-fg-subtle">
                  recorded {proof.recorded} · recomputed {proof.recomputed} ·{' '}
                  {proof.matches ? 'match' : 'MISMATCH'}
                </span>
              </div>
              <p className="mt-3 text-body text-fg-muted">
                The console re-runs this query against the original lines under the same cutoff and
                compares the result to what was recorded. The {count} denials are pageable one by one.
              </p>
              <dl className="mt-4 grid gap-x-6 gap-y-1.5 font-mono text-mono sm:grid-cols-[auto_1fr]">
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
          </Reveal>
        </div>
      </div>
    </Section>
  )
}
