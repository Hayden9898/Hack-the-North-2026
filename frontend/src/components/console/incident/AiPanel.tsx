import { Bot, ShieldX, Sparkles } from 'lucide-react'
import type { Explanation, ExplanationJob, Fact, Packet } from '../../../api'
import { hypothesisText } from '../../../format'
import { cn } from '@/lib/cn'

/**
 * The AI surface, kept structurally separate from the fact rail.
 *
 * Product invariant: a constrained AI step may *select* recorded facts and qualified
 * hypotheses, but it cannot invent a fact and cannot move a verdict. So this panel never
 * borrows the fact rail's styling, is always labelled as suggestion, and in the rejected case
 * shows what the validator refused rather than hiding it.
 */
export function AiPanel({
  explanation,
  job,
  packet,
  onShowEvidence,
}: {
  explanation: Explanation | null
  job: ExplanationJob | null
  packet: Packet | null
  onShowEvidence: (f: Fact) => void
}) {
  const state = explanation?.state ?? null

  return (
    <section aria-labelledby="ai-panel" className="rounded-lg border border-border bg-surface">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <h3 id="ai-panel" className="flex items-center gap-2 text-heading text-fg">
          <Bot className="size-4 text-fg-muted" aria-hidden />
          AI assistance
        </h3>
        <AiStateChip state={state} />
      </header>

      <div className="px-4 py-4">
        {state === 'rejected' && explanation ? (
          <RejectedBody explanation={explanation} />
        ) : state === 'validated' && explanation?.validated ? (
          <ValidatedBody explanation={explanation} packet={packet} onShowEvidence={onShowEvidence} />
        ) : (
          <FallbackBody explanation={explanation} job={job} />
        )}
      </div>
    </section>
  )
}

function AiStateChip({ state }: { state: string | null }) {
  const map: Record<string, { label: string; tone: string }> = {
    validated: { label: 'suggestions validated', tone: 'text-normal border-normal/35 bg-normal-wash' },
    fallback: { label: 'no AI review', tone: 'text-fg-muted border-border' },
    rejected: { label: 'proposal rejected', tone: 'text-blocked border-blocked/50' },
  }
  const m = map[state ?? ''] ?? { label: 'no AI review', tone: 'text-fg-muted border-border' }
  return (
    <span className={cn('inline-flex w-fit items-center gap-1.5 rounded-sm border px-2 py-1 text-caption font-medium', m.tone)}>
      {state === 'rejected' ? <ShieldX className="size-3.5 shrink-0" aria-hidden /> : null}
      {m.label}
    </span>
  )
}

/** The honest degraded state — and the real one on this machine (no provider key configured). */
function FallbackBody({ explanation, job }: { explanation: Explanation | null; job: ExplanationJob | null }) {
  const reason = explanation?.validated?.ai_review_reason
  return (
    <div className="space-y-3">
      <p className="max-w-[64ch] text-body text-fg-muted">
        No AI narrative is shown for this incident. Everything above is the deterministic detector
        output, which does not depend on a model.
      </p>
      {reason ? (
        <p className="font-mono text-mono text-fg-muted">{reason}</p>
      ) : null}
      {job && job.state !== 'done' ? (
        <p className="text-caption text-fg-muted">
          Explanation job: {job.state}
          {job.attempts ? ` · ${job.attempts} attempt${job.attempts === 1 ? '' : 's'}` : ''}
          {job.last_error ? ` · ${job.last_error}` : ''}
        </p>
      ) : null}
    </div>
  )
}

/**
 * Rejected. This is the best demonstration in the product that the guardrail is real, so it
 * says plainly what was refused and why, and that the verdict did not move.
 */
function RejectedBody({ explanation }: { explanation: Explanation }) {
  const grouped = groupRejections(explanation.rejection_reasons)
  return (
    <div className="space-y-4">
      <div className="flex gap-3 rounded-lg border border-blocked/45 bg-surface-raised px-4 py-3">
        <ShieldX className="mt-0.5 size-4 shrink-0 text-blocked" aria-hidden />
        <div className="space-y-1">
          <p className="text-body font-medium text-fg">The validator refused this AI proposal.</p>
          <p className="max-w-[62ch] text-body text-fg-muted">
            Nothing from it reached the evidence above, and the detector verdict is unchanged — an
            AI step in this product can select recorded facts, never invent them and never move a
            classification.
          </p>
        </div>
      </div>

      <div>
        <h4 className="mb-2 text-caption text-fg-muted">What it tried, and why it was refused</h4>
        <ul className="grid gap-2">
          {grouped.map((g) => (
            <li key={g.category} className="rounded-md border border-border bg-surface-raised px-3 py-2.5">
              <p className="text-body text-fg">{g.category}</p>
              <ul className="mt-1.5 grid gap-1">
                {g.raw.map((r) => (
                  <li key={r} className="font-mono text-mono break-all text-fg-muted">
                    {r}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </div>

      <p className="text-caption text-fg-muted">
        Proposal from <span className="font-mono">{explanation.model_name}</span> · prompt v
        {explanation.prompt_version}
      </p>
    </div>
  )
}

interface RejectionGroup {
  category: string
  raw: string[]
}

/**
 * Validator output is developer-facing
 * (`attempt 0: schema:('summary_fact_ids',):Value error, not a fact id: 'f_fabricated000001'`).
 * Lead with the category a judge can read; keep the raw string underneath, never instead of.
 */
export function groupRejections(reasons: readonly string[]): RejectionGroup[] {
  const byCategory = new Map<string, string[]>()
  for (const r of reasons) {
    const c = categorise(r)
    const list = byCategory.get(c) ?? []
    list.push(r)
    byCategory.set(c, list)
  }
  return [...byCategory.entries()].map(([category, raw]) => ({ category, raw }))
}

function categorise(reason: string): string {
  if (/not a fact id/i.test(reason)) return 'It cited a fact that does not exist in the evidence packet.'
  if (/unknown hypothesis code/i.test(reason)) return 'It proposed a conclusion outside the allowed, qualified vocabulary.'
  if (/packet_hash/i.test(reason)) return 'It altered the hash identifying the evidence packet it was given.'
  if (/playbook/i.test(reason)) return 'It selected a remediation playbook that is not in the catalogue.'
  if (/false_positive/i.test(reason)) return 'It made an unsupported false-positive assessment.'
  return 'The proposal did not satisfy the response schema.'
}

function ValidatedBody({
  explanation,
  packet,
  onShowEvidence,
}: {
  explanation: Explanation
  packet: Packet | null
  onShowEvidence: (f: Fact) => void
}) {
  const v = explanation.validated
  if (!v) return null
  const byId = new Map((packet?.facts ?? []).map((f) => [f.fact_id, f]))
  const forced = new Set(v.forced_inclusions ?? [])

  return (
    <div className="space-y-4">
      <p className="flex items-center gap-2 text-caption text-fg-muted">
        <Sparkles className="size-3.5" aria-hidden />
        Suggested by the model, then checked against the recorded facts. Wording comes from a fixed
        reviewed catalogue.
      </p>

      {v.hypotheses.length > 0 ? (
        <ul className="grid gap-2">
          {v.hypotheses.map((h) => (
            <li key={h.type} className="rounded-md border border-l-2 border-border border-l-accent bg-surface-raised px-3 py-2.5">
              <p className="max-w-[64ch] text-body text-fg">{h.text ?? hypothesisText(String(h.type))}</p>
              {h.supporting_fact_ids.length > 0 ? (
                <FactRefs ids={h.supporting_fact_ids} byId={byId} forced={forced} onShowEvidence={onShowEvidence} label="supported by" />
              ) : null}
              {h.counterevidence_fact_ids.length > 0 ? (
                <FactRefs ids={h.counterevidence_fact_ids} byId={byId} forced={forced} onShowEvidence={onShowEvidence} label="counterevidence" />
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-body text-fg-muted">The model proposed no hypothesis that survived validation.</p>
      )}

      {v.false_positive_assessment.status !== 'not_assessed' ? (
        <p className="text-body text-fg-muted">
          False-positive assessment: <span className="text-fg">{v.false_positive_assessment.status.replaceAll('_', ' ')}</span>
          <span className="text-fg-muted"> — advisory only; it does not suppress or downgrade the detector verdict.</span>
        </p>
      ) : null}
    </div>
  )
}

function FactRefs({
  ids,
  byId,
  forced,
  onShowEvidence,
  label,
}: {
  ids: string[]
  byId: Map<string, Fact>
  forced: Set<string>
  onShowEvidence: (f: Fact) => void
  label: string
}) {
  return (
    <p className="mt-2 flex flex-wrap items-center gap-1.5">
      <span className="text-caption text-fg-muted">{label}:</span>
      {ids.map((id) => {
        const f = byId.get(id)
        return (
          <button
            key={id}
            type="button"
            disabled={!f}
            onClick={() => f && onShowEvidence(f)}
            title={forced.has(id) ? 'Included by the system; the model could not omit this one.' : undefined}
            className={cn(
              'rounded-sm border border-border px-1.5 py-0.5 font-mono text-[0.6875rem]',
              f ? 'cursor-pointer text-fg-muted hover:border-accent hover:text-accent' : 'text-fg-muted',
              forced.has(id) && 'border-dashed',
            )}
          >
            {f ? f.kind.replaceAll('_', ' ') : id}
            {forced.has(id) ? ' (forced)' : ''}
          </button>
        )
      })}
    </p>
  )
}
