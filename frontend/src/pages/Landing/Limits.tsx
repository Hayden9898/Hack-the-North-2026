import { RULES, UNKNOWNS } from './data'
import { RuleTag, Section, Stamp } from './parts'

/**
 * The section most products would not ship. It is the strongest thing on the page precisely
 * because it is a list of what the system cannot tell you, written by the system.
 *
 * The unknown codes are row identifiers, so they are set in fg-muted rather than fg-subtle:
 * a key that is dimmer than the sentence it labels inverts the scan order.
 */
export function Limits() {
  return (
    <Section id="limits" className="py-16 sm:py-20">
      <div className="grid gap-x-12 gap-y-10 lg:grid-cols-12">
        <div className="lg:col-span-4">
          <Stamp>Limits · {UNKNOWNS.length} declared unknowns</Stamp>
          <h2 className="mt-7 font-serif text-[clamp(1.875rem,3.6vw,2.75rem)] leading-[1.05] tracking-[-0.02em]">
            What this cannot tell you.
          </h2>
          <p className="mt-5 max-w-[40ch] text-body text-fg-muted">
            Each incident carries its own unknowns, and they travel with the verdict wherever it is
            shown. A tool that only reports what it found is easy to build; reporting what it could
            not determine is the part that makes the rest worth trusting.
          </p>
          <p className="mt-4 max-w-[40ch] text-body text-fg-muted">
            &ldquo;High risk&rdquo; here means <span className="font-mono text-fg">urgently investigate</span>. It
            is a priority signal about recorded activity — never a conclusion about a person.
          </p>
        </div>

        <ul className="lg:col-span-8">
          {UNKNOWNS.map(([code, meaning]) => (
            <li key={code} className="grid gap-1 border-border border-t py-4 sm:grid-cols-[19rem_1fr] sm:gap-6">
              <span className="font-mono text-mono text-fg-muted">{code}</span>
              <span className="text-body text-fg-muted">{meaning}</span>
            </li>
          ))}
        </ul>
      </div>
    </Section>
  )
}

/**
 * Reference matter, deliberately set below the evidence in weight as well as in order: a
 * smaller heading and one wide column, so it does not read as a peer of Exhibit A.
 */
export function Method() {
  return (
    <Section id="method" className="py-16 sm:py-20">
      <Stamp>Method</Stamp>

      <div className="mt-6">
        <h2 className="font-serif text-[1.75rem] leading-[1.1] tracking-[-0.02em]">
          Five rules, then a validator.
        </h2>
        <div className="mt-4">
          <p className="max-w-[62ch] text-body text-fg-muted">
            Detection is deterministic: the same lines in the same order always produce the same
            verdicts. A constrained language step may select which facts to surface and propose
            qualified hypotheses, but a validator checks every claim against the recorded facts
            before it reaches the screen.
          </p>
          <p className="mt-5 max-w-[62ch] border-accent border-l-2 pl-4 text-[1.0625rem] text-fg leading-[1.5]">
            The language step cannot invent a fact, and it cannot downgrade a detector verdict.
            Rejected proposals are displayed as rejected.
          </p>
          <p className="mt-4 max-w-[62ch] text-body text-fg-muted">
            In this run it was switched off entirely — the rules produced every verdict shown above,
            which is what the <span className="font-mono text-fg">deterministic summaries only</span>{' '}
            state below reports.
          </p>
        </div>
      </div>

      <dl className="mt-8">
        {RULES.map(([id, text]) => (
          <div
            key={id}
            id={id.toLowerCase()}
            className="grid scroll-mt-24 gap-2 border-border border-t py-3.5 sm:grid-cols-[2.5rem_1fr] sm:gap-5"
          >
            <dt>
              <RuleTag>{id}</RuleTag>
            </dt>
            <dd className="text-body text-fg-muted">{text}</dd>
          </div>
        ))}
      </dl>
    </Section>
  )
}
