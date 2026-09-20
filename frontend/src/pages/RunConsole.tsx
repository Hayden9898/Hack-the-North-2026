import { ChevronRight, TriangleAlert } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  api,
  describeError,
  type IncidentsPage,
  type ModelHealth,
  type Phase,
  type ProgressUpdate,
  type Run,
  type RunState,
  type RunStateUpdate,
} from '../api'
import { fmtNum, fmtTime, integrationLabel, isFaultRun, modelHealthExplanation, modelHealthLabel, runStateLabel, shortId } from '../format'
import { useFetch, useInterval, useThrottledCallback } from '../useFetch'
import { useRunUpdates } from '../useRunUpdates'
import { EventFeed } from '../components/console/EventFeed'
import { FindingsList } from '../components/console/FindingsList'
import { ConnectionDot, RunProgress, RunTransport } from '../components/console/RunTransport'
import { ActivityPanel } from './ActivityPanel'
import { cn } from '@/lib/cn'
import { ErrorState } from '@/components/ui/error-state'
import { Skeleton } from '@/components/ui/skeleton'

interface LiveCounters {
  processed_seq: number
  admitted_seq: number
  last_event_time: string | null
  phase: Phase
  state: RunState
  model_health: ModelHealth
}

/**
 * Run console.
 *
 * Reordered around the question it exists to answer: what needs my attention. The findings
 * lead; the event feed is the evidence substrate beneath them; the reproducibility metadata
 * (config hash, feature version, dataset, integrations) is a real question — "is this run
 * reproducible?" — so it is a disclosure rather than the first thing on screen.
 */
export function RunConsole() {
  const { runId = '' } = useParams()
  const run = useFetch<Run>(() => api.getRun(runId), [runId])
  const [live, setLive] = useState<LiveCounters | null>(null)
  const [tick, setTick] = useState(0)
  const [incTick, setIncTick] = useState(0)
  const [resyncs, setResyncs] = useState(0)

  const refreshFeeds = useThrottledCallback(() => {
    setTick((t) => t + 1)
    setIncTick((t) => t + 1)
  }, 1_000)
  const refreshRun = useThrottledCallback(() => void run.reload(), 2_000)
  const refreshIncidents = useThrottledCallback(() => setIncTick((t) => t + 1), 1_000)

  const onEvent = useCallback(
    (type: string, data: Record<string, unknown>) => {
      switch (type) {
        case 'progress': {
          const p = data as unknown as ProgressUpdate
          setLive({
            processed_seq: p.processed_seq,
            admitted_seq: p.admitted_seq,
            last_event_time: p.last_event_time,
            phase: p.phase,
            state: p.state,
            model_health: p.model_health,
          })
          refreshFeeds()
          refreshRun()
          break
        }
        case 'run_state': {
          const st = data as unknown as RunStateUpdate
          if (st.state) setLive((l) => (l ? { ...l, state: st.state } : l))
          refreshRun()
          refreshFeeds()
          break
        }
        case 'incident':
        case 'explanation':
        case 'delivery':
        case 'feedback':
          refreshIncidents()
          refreshRun()
          break
        default:
          break
      }
    },
    [refreshFeeds, refreshRun, refreshIncidents],
  )

  const onResync = useCallback(() => {
    setResyncs((n) => n + 1)
    void run.reload()
    setTick((t) => t + 1)
    setIncTick((t) => t + 1)
  }, [run])

  const updates = useRunUpdates(runId, { onEvent, onResync })

  useInterval(
    () => {
      void run.reload()
      setTick((t) => t + 1)
      setIncTick((t) => t + 1)
    },
    updates.polling ? 2_000 : null,
  )

  const r = run.data
  const merged = useMemo(() => {
    if (!r) return null
    if (!live) return r
    return {
      ...r,
      processed_seq: Math.max(r.processed_seq, live.processed_seq),
      admitted_seq: Math.max(r.admitted_seq, live.admitted_seq),
      last_processed_time: live.processed_seq >= r.processed_seq ? live.last_event_time : r.last_processed_time,
      phase: live.processed_seq >= r.processed_seq ? live.phase : r.phase,
      state: live.processed_seq >= r.processed_seq ? live.state : r.state,
      model_health: live.model_health ?? r.model_health,
    }
  }, [r, live])

  if (run.loading && !r) return <ConsoleSkeleton />
  if (run.error && !r) {
    const e = describeError(run.error)
    return (
      <div className="mx-auto max-w-2xl px-6 py-16">
        <ErrorState
          title={e.status === 503 ? 'Database unavailable' : 'Could not load this run'}
          detail={e.text}
          onRetry={() => void run.reload()}
        />
      </div>
    )
  }
  if (!merged) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16">
        <ErrorState title="Run not found" detail="No run with this id exists." />
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-[84rem] space-y-6 px-4 py-6 sm:px-6 lg:px-8">
      <nav aria-label="Breadcrumb" className="flex items-center gap-1.5">
        <Link to="/app" className="text-caption text-fg-muted normal-case tracking-normal hover:text-fg">
          Runs
        </Link>
        <ChevronRight className="size-3 text-fg-subtle" aria-hidden />
        <span className="font-mono text-caption text-fg-subtle normal-case tracking-normal">{shortId(merged.run_id, 16)}</span>
      </nav>

      <RunHeaderBand
        run={merged}
        status={updates.status}
        attempts={updates.attempts}
        lastId={updates.lastId}
        resyncs={resyncs}
        onChanged={(u) => run.set(() => u)}
      />

      {merged.state === 'blocked' ? <BlockedBanner run={merged} /> : null}

      <Findings runId={runId} tick={incTick} cutoff={merged.processed_seq} />

      <ActivityPanel runId={runId} processedSeq={merged.processed_seq} run={merged} />

      <EventFeed runId={runId} tick={tick} cutoff={merged.processed_seq} />

      <RunProvenance run={merged} />
    </div>
  )
}

function RunHeaderBand({
  run,
  status,
  attempts,
  lastId,
  resyncs,
  onChanged,
}: {
  run: Run
  status: string
  attempts: number
  lastId: number | null
  resyncs: number
  onChanged: (r: Run) => void
}) {
  const degraded = run.model_health !== 'active'
  return (
    <header className="rounded-xl border border-border bg-surface px-5 py-5 sm:px-6">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-heading text-fg">{run.name || shortId(run.run_id, 12)}</h1>
        <span className="rounded-sm border border-border px-1.5 py-0.5 text-[0.6875rem] text-fg-muted uppercase">
          {run.mode === 'replay' ? 'historical replay' : 'live'}
        </span>
        <RunStatePill state={run.state} />
        <span className="rounded-sm border border-border px-1.5 py-0.5 text-[0.6875rem] text-fg-muted uppercase">
          {run.phase === 'warmup' ? 'historical warmup' : 'visible window'}
        </span>
        {isFaultRun(run.name) ? (
          <span className="rounded-sm border border-high-risk/45 bg-high-risk-wash px-1.5 py-0.5 text-[0.6875rem] font-medium text-high-risk">
            fault injection
          </span>
        ) : null}
        <span className="ms-auto">
          <ConnectionDot status={status} attempts={attempts} lastId={lastId} resyncs={resyncs} />
        </span>
      </div>

      <div className="mt-4 flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <RunProgress run={run} />
        <RunTransport run={run} onChanged={onChanged} />
      </div>

      {degraded ? (
        <p className="mt-4 flex items-start gap-2 border-t border-border pt-3 text-caption text-pending normal-case tracking-normal">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>
            <span className="font-medium">{modelHealthLabel(run.model_health)}.</span>{' '}
            <span className="text-fg-muted">
              {modelHealthExplanation(run.model_health) ?? 'Rule detections still apply; no model score is available.'}
            </span>
          </span>
        </p>
      ) : null}
    </header>
  )
}

function RunStatePill({ state }: { state: RunState }) {
  // A run state is a processing state, never a verdict — `completed` must not read as "clean".
  const live = state === 'running' || state === 'warming'
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-sm border px-1.5 py-0.5 text-[0.6875rem] font-medium uppercase',
        state === 'blocked' ? 'state-hatch border-blocked/50 text-blocked' : 'border-border text-fg-muted',
      )}
    >
      {live ? <span aria-hidden className="inline-block size-1.5 animate-pulse rounded-full bg-accent motion-reduce:animate-none" /> : null}
      {runStateLabel(state)}
    </span>
  )
}

function BlockedBanner({ run }: { run: Run }) {
  return (
    <div className="state-hatch flex items-start gap-3 rounded-lg border border-blocked/50 px-4 py-3.5">
      <TriangleAlert className="mt-0.5 size-4 shrink-0 text-blocked" aria-hidden />
      <div>
        <p className="text-body font-medium text-fg">
          Run blocked at run_seq {fmtNum(run.blocked_seq)}
        </p>
        <p className="mt-1 max-w-[70ch] text-body text-fg-muted">
          {run.block_reason ?? 'No reason was recorded.'} Evidence up to the cutoff is preserved and remains valid;
          nothing after it has been evaluated. Create a new run to retry.
        </p>
      </div>
    </div>
  )
}

function Findings({ runId, tick, cutoff }: { runId: string; tick: number; cutoff: number }) {
  const inc = useFetch<IncidentsPage>(() => api.listIncidents(runId, { limit: 50, offset: 0 }), [runId])
  const first = useRef(true)
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    void inc.reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick])

  const items = inc.data?.items ?? []
  const high = items.filter((i) => i.current_class === 'high_risk').length

  return (
    <section aria-labelledby="findings">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="findings" className="text-heading text-fg">
          Findings
          {inc.data ? (
            <span className="ms-2 text-caption text-fg-muted normal-case tracking-normal">
              {fmtNum(inc.data.total)} under cutoff #{fmtNum(inc.data.cutoff_seq)}
              {high > 0 ? ` · ${fmtNum(high)} high risk` : ''}
            </span>
          ) : null}
        </h2>
      </div>

      {inc.loading && !inc.data ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-28 w-full rounded-lg" />
          ))}
        </div>
      ) : inc.error && !inc.data ? (
        <ErrorState title="Could not load findings" detail={describeError(inc.error).text} onRetry={() => void inc.reload()} />
      ) : (
        <>
          <FindingsList incidents={items} runId={runId} />
          {items.length === 0 && cutoff === 0 ? (
            <p className="mt-2 text-caption text-fg-muted normal-case tracking-normal">This run has not evaluated anything yet.</p>
          ) : null}
        </>
      )}
    </section>
  )
}

/** Reproducibility metadata. A real question, just not the first one. */
function RunProvenance({ run }: { run: Run }) {
  return (
    <details className="rounded-lg border border-border bg-surface">
      <summary className="group/sum flex cursor-pointer list-none items-center gap-1.5 px-4 py-3 text-caption text-fg-muted uppercase hover:text-fg focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none">
        <ChevronRight className="size-3.5 shrink-0 transition-transform group-open/sum:rotate-90 motion-reduce:transition-none" aria-hidden />
        Run provenance — is this reproducible?
      </summary>
      <div className="border-t border-border px-4 py-4">
        <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
          <Pair k="dataset" v={run.dataset_id ?? run.source_id ?? '—'} mono />
          <Pair k="config hash" v={shortId(run.config_hash, 24)} mono />
          <Pair k="reference hash" v={run.reference_hash ? shortId(run.reference_hash, 24) : '—'} mono />
          <Pair k="feature version" v={run.feature_version} mono />
          <Pair k="model" v={run.model_id ?? 'none — rules only'} mono />
          <Pair k="visible start" v={fmtTime(run.visible_start)} mono />
          <Pair k="last processed event" v={fmtTime(run.last_processed_time)} mono />
          <Pair k="last admitted event" v={fmtTime(run.last_admitted_time)} mono />
          <Pair k="created" v={fmtTime(run.created_at)} mono />
        </dl>

        <div className="mt-4 border-t border-border pt-3">
          <h4 className="mb-2 text-caption text-fg-muted uppercase">Integrations</h4>
          <div className="flex flex-wrap gap-2">
            {(['sentry', 'llm', 'slack'] as const).map((k) => {
              const l = integrationLabel(k, run.integrations[k])
              return (
                <span
                  key={k}
                  className={cn(
                    'rounded-sm border px-2 py-0.5 text-caption normal-case tracking-normal',
                    l.tone === 'ok' ? 'border-normal/30 text-normal' : l.tone === 'warn' ? 'border-late/45 text-late' : 'border-border text-fg-muted',
                  )}
                >
                  {l.text}
                </span>
              )
            })}
          </div>
        </div>

        <div className="mt-4 border-t border-border pt-3">
          <h4 className="mb-2 text-caption text-fg-muted uppercase">Counts under cutoff</h4>
          <CountsTable run={run} />
        </div>
      </div>
    </details>
  )
}

function CountsTable({ run }: { run: Run }) {
  const counts = run.counts ?? {}
  return (
    <table className="w-full max-w-lg border-collapse font-mono text-mono">
      <thead>
        <tr className="border-b border-border text-left">
          <th className="py-1 font-sans text-caption font-medium text-fg-muted uppercase">phase</th>
          <th className="py-1 text-right font-sans text-caption font-medium text-fg-muted uppercase">normal</th>
          <th className="py-1 text-right font-sans text-caption font-medium text-fg-muted uppercase">suspicious</th>
          <th className="py-1 text-right font-sans text-caption font-medium text-fg-muted uppercase">high risk</th>
          <th className="py-1 text-right font-sans text-caption font-medium text-fg-muted uppercase">unscored</th>
        </tr>
      </thead>
      <tbody>
        {(['warmup', 'visible'] as const).map((ph) => {
          const m = (counts[ph] ?? {}) as Record<string, number>
          return (
            <tr key={ph} className="border-b border-border/50 last:border-0">
              <td className="py-1 text-fg-muted">{ph === 'warmup' ? 'historical warmup' : 'visible window'}</td>
              <td className="py-1 text-right tabular-nums text-fg">{fmtNum(m.normal ?? 0)}</td>
              <td className="py-1 text-right tabular-nums text-fg">{fmtNum(m.suspicious ?? 0)}</td>
              <td className="py-1 text-right tabular-nums text-fg">{fmtNum(m.high_risk ?? 0)}</td>
              <td className="py-1 text-right tabular-nums text-fg-muted">{fmtNum(m.unscored ?? 0)}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function Pair({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-caption text-fg-muted uppercase">{k}</dt>
      <dd className={mono ? 'truncate font-mono text-mono text-fg' : 'truncate text-body text-fg'} title={v}>
        {v}
      </dd>
    </div>
  )
}

function ConsoleSkeleton() {
  return (
    <div className="mx-auto w-full max-w-[84rem] space-y-6 px-4 py-6 sm:px-6 lg:px-8">
      <Skeleton className="h-4 w-48" />
      <Skeleton className="h-36 w-full rounded-xl" />
      <div className="space-y-3">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-28 w-full rounded-lg" />
        ))}
      </div>
      <Skeleton className="h-64 w-full rounded-lg" />
    </div>
  )
}
