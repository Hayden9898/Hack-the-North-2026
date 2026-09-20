import { RULES, UNKNOWNS } from './data'
import { Reveal, RuleTag, Section, Stamp } from './parts'

/**
 * The section most products would not ship. It is the strongest thing on the page precisely
 * because it is a list of what the system cannot tell you, written by the system.
 */
export function Limits() {
  return (
    <Section id="limits" className="py-20 sm:py-24">
      <div className="grid gap-x-12 gap-y-10 lg:grid-cols-12">
        <div className="lg:col-span-5">
          <Stamp>On the record</Stamp>
          <h2 className="mt-7 font-serif text-[clamp(1.875rem,3.6vw,2.75rem)] leading-[1.05] tracking-[-0.02em]">
            What this cannot tell you.
          </h2>
          <p className="mt-5 max-w-[46ch] text-body text-fg-muted">
            Each incident carries its own unknowns, and they travel with the verdict wherever it is
            shown. A tool that only reports what it found is easy to build. Reporting what it could
            not determine is the part that makes the rest worth trusting.
          </p>
          <p className="mt-4 max-w-[46ch] text-body text-fg-muted">
            "High risk" here means <span className="text-fg">urgently investigate</span>. It is a
            priority signal about recorded activity — never a conclusion about a person.
          </p>
        </div>

        <ul className="lg:col-span-7">
          {UNKNOWNS.map(([code, meaning], i) => (
            <Reveal key={code} delay={i * 0.04}>
              <li className="grid gap-1 border-border border-t py-4 sm:grid-cols-[19rem_1fr] sm:gap-6">
                <span className="font-mono text-mono text-fg-subtle">{code}</span>
                <span className="text-body text-fg-muted">{meaning}</span>
              </li>
            </Reveal>
          ))}
        </ul>
      </div>
    </Section>
  )
}

export function Method() {
  return (
    <Section id="method" className="py-20 sm:py-24">
      <Stamp>Method</Stamp>

      <div className="mt-7 grid gap-x-12 gap-y-10 lg:grid-cols-12">
        <div className="lg:col-span-5">
          <h2 className="font-serif text-[clamp(1.875rem,3.6vw,2.75rem)] leading-[1.05] tracking-[-0.02em]">
            Five rules, then a validator.
          </h2>
          <p className="mt-5 max-w-[46ch] text-body text-fg-muted">
            Detection is deterministic: the same lines in the same order always produce the same
            verdicts. A constrained language step may select which facts to surface and propose
            qualified hypotheses, but a validator checks every claim against the recorded facts
            before it reaches the screen.
          </p>
          <p className="mt-4 max-w-[46ch] text-body text-fg-muted">
            It cannot invent a fact, and it cannot downgrade a detector verdict. A rejected proposal
            is shown as rejected rather than quietly dropped.
          </p>
        </div>

        <dl className="lg:col-span-7">
          {RULES.map(([id, text], i) => (
            <Reveal key={id} delay={i * 0.04}>
              <div className="grid gap-2 border-border border-t py-4 sm:grid-cols-[4rem_1fr] sm:gap-6">
                <dt>
                  <RuleTag>{id}</RuleTag>
                </dt>
                <dd className="max-w-[58ch] text-body text-fg-muted">{text}</dd>
              </div>
            </Reveal>
          ))}
        </dl>
      </div>
    </Section>
  )
}
