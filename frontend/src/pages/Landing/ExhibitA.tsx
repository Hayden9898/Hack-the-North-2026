import { ArrowUpRight, Check } from 'lucide-react'
import { Link } from 'react-router-dom'
import { CodeBlock } from '@/components/ui/code-block'
import { EXHIBIT, RUN } from './data'
import { Section, Stamp } from './parts'
import { CountUp } from './interactive'

/**
 * The climax, and the one section that breaks the page's own template.
 *
 * Every other section opens with a record stamp and an Instrument Serif headline. This one
 * opens with the evidence — an exhibit should lead with the exhibit — and the count itself
 * acts as the headline, with the sentence demoted to a mono caption beside it. Without one
 * deliberate violation the page reads as a grid applied consistently rather than as an
 * authored document, which is the uniform-card failure wearing better clothes.
 *
 * Neither log strip is tinted with a verdict colour. An approved access grant produces
 * exactly the AFTER line, so colouring it as a verdict would assert the thing the section
 * explicitly refuses to assert. The brass rule marks the relationship instead.
 */
export function ExhibitA() {
  const { count, denial, grant, query, proof, factId, provenanceHashShort, incidentId } = EXHIBIT

  return (
    <Section id="exhibit" className="py-16 sm:py-20">
      <Stamp>Exhibit A · fact {factId}</Stamp>

      <div className="mt-8">
        <CodeBlock
          label={`before · line ${denial.line} · ${denial.when}`}
          code={denial.raw}
          emphasize={['403 245']}
        />

        <div className="flex items-stretch gap-6 sm:gap-10">
          <div aria-hidden className="ml-6 w-px shrink-0 bg-accent sm:ml-12" />
          <div className="flex flex-wrap items-center gap-x-8 gap-y-3 py-8">
            <span className="font-mono font-medium text-[clamp(4rem,11vw,8rem)] text-fg leading-[0.8] tracking-[-0.055em] tabular-nums">
              <CountUp to={count} />
            </span>
            <div className="min-w-0">
              <p className="font-mono text-caption text-fg-subtle uppercase">
                The same request, refused {count} times
              </p>
              <p className="mt-2 max-w-[34ch] text-body text-fg-muted">
                prior <span className="font-mono text-fg">403</span> responses for this exact account
                and resource, counted under the same cutoff.
              </p>
            </div>
          </div>
        </div>

        <CodeBlock
          label={`after · line ${grant.line} · ${grant.when}`}
          code={grant.raw}
          emphasize={['200 8459200']}
        />
      </div>

      <div className="mt-10 grid gap-x-12 gap-y-8 lg:grid-cols-12">
        <div className="min-w-0 lg:col-span-5">
          <p className="max-w-[48ch] text-body text-fg-muted">
            One account. One file. One source address. For seven months the server answered{' '}
            <span className="font-mono text-fg">403</span>. Then it answered{' '}
            <span className="font-mono text-fg">200</span> and sent 8.46 MB.
          </p>
          <p className="mt-4 max-w-[48ch] text-body text-fg-muted">
            That is a measured change in observed behaviour. An approved access grant looks exactly
            the same from the log, so the count is shown with the query that produced it, rather than
            as a conclusion.
          </p>
        </div>

        <div className="min-w-0 rounded-doc border border-border bg-surface p-5 shadow-md sm:p-6 lg:col-span-7">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Check className="size-3.5 text-normal" />
            <span className="font-mono text-caption text-fg uppercase">Recomputed on request</span>
            <span className="font-mono text-caption text-fg-subtle">
              recorded {proof.recorded} · recomputed {proof.recomputed} ·{' '}
              <span className="text-normal">{proof.matches ? 'match' : 'MISMATCH'}</span>
            </span>
          </div>
          <p className="mt-3 max-w-[62ch] text-body text-fg-muted">
            The console re-runs this query against the original lines under the same cutoff and
            compares the result to what was recorded.
          </p>
          <Link
            to={`/app/runs/${RUN.id}/incidents/${incidentId}`}
            className="mt-3 inline-flex items-center gap-1.5 rounded-sm font-mono text-caption text-accent uppercase transition-opacity duration-150 hover:opacity-80"
          >
            Page all {count} denials <ArrowUpRight className="size-3" />
          </Link>
          <dl className="mt-4 grid gap-x-6 gap-y-1.5 font-mono text-mono sm:grid-cols-[7rem_1fr]">
            {[
              ['query', `${query.id} v${query.version}`],
              ['account', query.params.account],
              ['path', query.params.path],
              ['status', String(query.params.status)],
              ['cutoff_seq', `${query.params.before_seq} — denials counted before this line`],
              ['provenance', provenanceHashShort],
            ].map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-fg-subtle">{k}</dt>
                <dd className="min-w-0 text-fg-muted [overflow-wrap:anywhere]">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </Section>
  )
}
