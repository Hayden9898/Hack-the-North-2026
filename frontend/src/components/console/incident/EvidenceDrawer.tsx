import { Check, ChevronLeft, ChevronRight, X } from 'lucide-react'
import { useState } from 'react'
import { api, describeError, type Fact, type FactResponse } from '../../../api'
import { fmtNum, fmtTime } from '../../../format'
import { useFetch } from '../../../useFetch'
import { Button } from '@/components/ui/button'
import { CodeBlock } from '@/components/ui/code-block'
import { ErrorState } from '@/components/ui/error-state'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { claimView, formatDelta } from './facts'

const PAGE = 25

/**
 * The evidence proof. This is the most important interaction in the product.
 *
 * A judge clicks "77 prior denials" and this has to answer, without them knowing the schema:
 * what was counted, under which cutoff, does recounting it right now still give 77, and what
 * are the actual log lines. The recomputed-vs-recorded agreement is the whole argument for
 * "reproducible explanation", so it is the hero, not a sub-heading.
 *
 * SECURITY: every value here is log-derived and untrusted (this dataset contains real
 * `script=success` query values). Everything renders through React text interpolation or
 * CodeBlock. No dangerouslySetInnerHTML, ever. Acceptance test S01.
 */
export function EvidenceDrawer({
  runId,
  incidentId,
  version,
  fact,
  onClose,
}: {
  runId: string
  incidentId: string
  version: number
  fact: Fact | null
  onClose: () => void
}) {
  const [offset, setOffset] = useState(0)
  const factId = fact?.fact_id ?? ''

  // Reset paging when the drawer switches facts. Adjusted during render rather than in an
  // effect, so there is no second render pass showing page 3 of the previous fact.
  const [pagedFactId, setPagedFactId] = useState(factId)
  if (factId !== pagedFactId) {
    setPagedFactId(factId)
    setOffset(0)
  }

  const res = useFetch<FactResponse>(
    () => api.getFact(runId, factId, incidentId, version, PAGE, offset),
    [runId, factId, incidentId, version, offset],
    !!fact,
  )

  const view = fact ? claimView(fact) : null
  const proof = res.data?.aggregate_proof ?? null
  const rows = proof?.rows ?? null
  const evidence = res.data?.evidence ?? []
  const total = typeof proof?.recomputed_count === 'number' ? proof.recomputed_count : evidence.length

  return (
    <Sheet open={!!fact} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" showCloseButton={false} className="w-full gap-0 overflow-y-auto p-0 sm:max-w-[46rem]">
        <SheetHeader className="border-b border-border px-6 pt-6 pb-5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <SheetDescription className="text-caption text-fg-muted uppercase">
                Evidence for a recorded fact
              </SheetDescription>
              <SheetTitle className="mt-1 text-heading">{view?.label ?? 'Fact'}</SheetTitle>
            </div>
            <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close evidence">
              <X />
            </Button>
          </div>

          {/* Hero: the figure, then immediately whether recounting it now still agrees. */}
          {view?.figure ? (
            <div className="mt-5 flex flex-wrap items-end gap-x-6 gap-y-3">
              <div className="font-sans text-[3.5rem] leading-[0.9] font-semibold tracking-tight text-fg">
                {view.figure}
              </div>
              {proof && proof.matches_recorded === true ? (
                <ProofSeal recomputed={proof.recomputed_count} recorded={proof.recorded_value} />
              ) : proof && proof.matches_recorded === false ? (
                <ProofMismatch recomputed={proof.recomputed_count} recorded={proof.recorded_value} />
              ) : null}
            </div>
          ) : null}

          {view?.detail ? <p className="mt-3 max-w-[58ch] text-body text-fg-muted">{view.detail}</p> : null}
        </SheetHeader>

        {/* Provenance: what exactly was counted, and under which cutoff. */}
        {fact ? <Provenance fact={fact} /> : null}

        <div className="px-6 py-5">
          {res.loading && !res.data ? (
            <div className="space-y-2">
              {Array.from({ length: 6 }, (_, i) => (
                <Skeleton key={i} className="h-7 w-full" />
              ))}
            </div>
          ) : res.error && !res.data ? (
            <ErrorState
              title="Could not load this evidence"
              detail={describeError(res.error).text}
              onRetry={() => void res.reload()}
            />
          ) : proof?.error ? (
            <p className="rounded-lg border border-late/40 bg-surface px-4 py-3 text-body text-late">
              The aggregate could not be recomputed: {proof.error}
            </p>
          ) : rows && rows.length > 0 ? (
            <>
              <SectionLabel>
                Original log lines — showing {fmtNum(offset + 1)}–{fmtNum(offset + rows.length)} of {fmtNum(total)}
              </SectionLabel>
              <EvidenceRows
                total={total}
                rows={rows.map((r) => ({
                  run_seq: r.run_seq,
                  line_number: r.line_number,
                  event_time: r.event_time,
                  username: r.username,
                  ip_raw: r.ip_raw,
                  method: r.method,
                  path: r.path,
                  status: r.status,
                  raw_line: null,
                }))}
              />
              <Pager offset={offset} count={rows.length} total={total} onChange={setOffset} busy={res.loading} />
            </>
          ) : evidence.length > 0 ? (
            <>
              <SectionLabel>Exact evidence lines ({fmtNum(evidence.length)})</SectionLabel>
              <div className="space-y-3">
                {evidence.slice(0, PAGE).map((e) => (
                  <CodeBlock
                    key={e.event_id}
                    className="[&_pre]:break-all [&_pre]:whitespace-pre-wrap"
                    code={e.raw_line}
                    label={
                      <span className="font-mono normal-case">
                        line {e.line_number ?? '—'} · run_seq {e.run_seq} · {fmtTime(e.event_time)}
                      </span>
                    }
                  />
                ))}
              </div>
            </>
          ) : proof && proof.recomputed_count === 0 ? (
            <p className="max-w-[62ch] text-body text-fg-muted">
              The recount returned <span className="font-medium text-fg">no rows</span>, and that is the finding: the
              query above ran against every row under the cutoff and matched nothing. An empty result here is what
              makes the later response a change rather than routine.
            </p>
          ) : (
            <p className="max-w-[62ch] text-body text-fg-muted">
              This fact records a value rather than a set of events, so there are no separate evidence lines to page
              through.
            </p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <h3 className="mb-3 text-caption text-fg-muted uppercase">{children}</h3>
}

/** The reproducibility claim, stated plainly. */
function ProofSeal({ recomputed, recorded }: { recomputed?: number; recorded?: unknown }) {
  return (
    <div className="flex items-center gap-2.5 rounded-lg border border-normal/35 bg-normal-wash px-3 py-2">
      <Check className="size-4 shrink-0 text-normal" aria-hidden />
      <div className="text-caption leading-snug">
        <div className="font-semibold text-normal normal-case tracking-normal">Recounted now, same answer</div>
        <div className="font-mono text-fg-muted normal-case tracking-normal">
          recomputed {fmtNum(recomputed)} = recorded {String(recorded)}
        </div>
      </div>
    </div>
  )
}

function ProofMismatch({ recomputed, recorded }: { recomputed?: number; recorded?: unknown }) {
  return (
    <div className="flex items-center gap-2.5 rounded-lg border border-high-risk/40 bg-high-risk-wash px-3 py-2">
      <X className="size-4 shrink-0 text-high-risk" aria-hidden />
      <div className="text-caption leading-snug">
        <div className="font-medium text-high-risk normal-case tracking-normal">Recount disagrees with the record</div>
        <div className="font-mono text-fg-muted normal-case tracking-normal">
          recomputed {fmtNum(recomputed)} vs recorded {String(recorded)}
        </div>
      </div>
    </div>
  )
}

/** What was counted, and the cutoff it was counted under. Mono, because it is forensic. */
function Provenance({ fact }: { fact: Fact }) {
  const q = fact.query
  const args = Object.entries(fact.args ?? {})
  return (
    <dl className="grid gap-x-6 gap-y-3 border-b border-border bg-surface px-6 py-4 sm:grid-cols-[auto_1fr]">
      <dt className="text-caption text-fg-muted uppercase">Counted under</dt>
      <dd className="font-mono text-mono text-fg">
        run_seq &le; {fmtNum(fact.cutoff_seq)}
        <span className="text-fg-muted"> — nothing after this point was considered</span>
      </dd>

      {q ? (
        <>
          <dt className="text-caption text-fg-muted uppercase">Query</dt>
          <dd className="font-mono text-mono break-all text-fg">
            {q.id}
            {args.length ? (
              <span className="text-fg-muted">
                ({args.map(([k, v]) => `${k}=${String(v)}`).join(', ')})
              </span>
            ) : null}
          </dd>
        </>
      ) : null}

      <dt className="text-caption text-fg-muted uppercase">Provenance</dt>
      <dd className="font-mono text-mono break-all text-fg-muted">{fact.provenance_hash}</dd>
    </dl>
  )
}

interface Row {
  run_seq: number
  line_number: number | null
  event_time: string
  username: string
  ip_raw: string
  method: string
  path: string
  status: number
  raw_line: string | null
}

/**
 * Columns whose value never varies across the page are not evidence, they are a heading.
 *
 * On the 77-denial fact, `status` is 403 seventy-seven times and `request` is the same path
 * seventy-seven times — so nearly half the table width was spent restating a constant while
 * truncating the very path that proves these are denials of the *right* resource. Invariants
 * are hoisted into one line above the table; only what actually varies gets a column.
 */
function invariantsOf(rows: Row[]): { constant: Record<string, string>; varies: Set<string> } {
  const constant: Record<string, string> = {}
  const varies = new Set<string>()
  const cols: [string, (r: Row) => string][] = [
    ['request', (r) => `${r.method} ${r.path}`],
    ['status', (r) => String(r.status)],
    ['account', (r) => `${r.username}@${r.ip_raw}`],
  ]
  for (const [key, get] of cols) {
    const first = rows.length ? get(rows[0]) : ''
    if (rows.length > 1 && rows.every((r) => get(r) === first)) constant[key] = first
    else varies.add(key)
  }
  return { constant, varies }
}

function EvidenceRows({ rows, total }: { rows: Row[]; total: number }) {
  const { constant, varies } = invariantsOf(rows)
  const constantKeys = Object.keys(constant)

  return (
    <div className="space-y-2">
      {constantKeys.length > 0 ? (
        <p className="rounded-md border border-border bg-surface-raised px-3 py-2 font-mono text-mono text-fg-muted">
          <span className="text-fg-muted">every one of these {fmtNum(total)}: </span>
          <span className="break-all text-fg">
            {constant.account ? `${constant.account} ` : ''}
            {constant.request ?? ''}
            {constant.status ? ` → ${constant.status}` : ''}
          </span>
        </p>
      ) : null}

      <div
        className="overflow-x-auto rounded-lg border border-border"
        tabIndex={0}
        role="region"
        aria-label="Original log lines behind this fact, scrollable"
      >
        <table className="w-full border-collapse font-mono text-mono">
          <caption className="sr-only">Original log lines behind this fact</caption>
          <thead>
            <tr className="border-b border-border bg-surface-raised text-left">
              <Th className="text-right">line</Th>
              <Th>time (UTC)</Th>
              <Th className="text-right">gap</Th>
              {varies.has('account') ? <Th>account@ip</Th> : null}
              {varies.has('request') ? <Th>request</Th> : null}
              {varies.has('status') ? <Th className="text-right">status</Th> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.run_seq} className="border-b border-border/60 last:border-0 hover:bg-hover">
                <Td className="text-right tabular-nums text-fg-muted">{r.line_number ?? r.run_seq}</Td>
                <Td className="whitespace-nowrap tabular-nums">{fmtTime(r.event_time)}</Td>
                {/* Hoisting the invariants freed the width; spend it on something that varies.
                    The cadence of the denials is the shape of the story. */}
                <Td className="text-right tabular-nums text-fg-muted">{gapLabel(rows, i)}</Td>
                {varies.has('account') ? (
                  <Td className="whitespace-nowrap">
                    {r.username}@{r.ip_raw}
                  </Td>
                ) : null}
                {varies.has('request') ? (
                  <Td className="break-all" title={`${r.method} ${r.path}`}>
                    {r.method} {r.path}
                  </Td>
                ) : null}
                {varies.has('status') ? <Td className="text-right tabular-nums">{r.status}</Td> : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/** Time since the previous row on this page; blank for the first. */
function gapLabel(rows: Row[], i: number): string {
  if (i === 0) return '—'
  const prev = Date.parse(rows[i - 1].event_time)
  const cur = Date.parse(rows[i].event_time)
  if (!Number.isFinite(prev) || !Number.isFinite(cur)) return '—'
  return `+${formatDelta((cur - prev) / 1000)}`
}

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return <th className={`px-3 py-2 font-sans text-caption font-medium text-fg-muted uppercase ${className ?? ''}`}>{children}</th>
}

function Td({ children, className, title }: { children: React.ReactNode; className?: string; title?: string }) {
  return (
    <td className={`px-3 py-1.5 text-fg ${className ?? ''}`} title={title}>
      {children}
    </td>
  )
}

function Pager({
  offset,
  count,
  total,
  onChange,
  busy,
}: {
  offset: number
  count: number
  total: number
  onChange: (n: number) => void
  busy: boolean
}) {
  const hasPrev = offset > 0
  const hasNext = offset + count < total
  if (!hasPrev && !hasNext) return null
  return (
    <div className="mt-4 flex items-center justify-between gap-3">
      <span className="text-caption text-fg-muted normal-case tracking-normal">
        Every one of the {fmtNum(total)} is here — page through them.
      </span>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={!hasPrev || busy} onClick={() => onChange(Math.max(0, offset - PAGE))}>
          <ChevronLeft /> Previous
        </Button>
        <Button variant="outline" size="sm" disabled={!hasNext || busy} onClick={() => onChange(offset + PAGE)}>
          Next <ChevronRight />
        </Button>
      </div>
    </div>
  )
}
