import { ChevronRight } from 'lucide-react'
import { useMemo, useState } from 'react'
import { api, describeError, type BenchmarkResponse, type RefreshResponse, type Run, type TimeseriesResponse } from '../api'
import { fmtNum } from '../format'
import { useFetch } from '../useFetch'
import { FreshnessChip, FreshnessDetail } from '../components/charts/FreshnessChip'
import { RunActivityChart } from '../components/charts/RunActivityChart'
import { binUnitLabel, chooseBucketMinutes, describeFreshness, toBins } from '../components/charts/timeseries'
import { Button } from '@/components/ui/button'
import { ErrorState } from '@/components/ui/error-state'
import { Skeleton } from '@/components/ui/skeleton'

/**
 * The shape of the run, plus where its numbers came from.
 *
 * Operator actions (re-materialise, benchmark) are deliberately separated from the freshness
 * chip: "is this data fresh?" and "go recompute it" are different questions, and mixing them
 * in one control strip was part of why the old panel read as a control surface rather than an
 * answer.
 */
export function ActivityPanel({ runId, processedSeq, run }: { runId: string; processedSeq: number; run: Run }) {
  const [account, setAccount] = useState('')
  const [accountDraft, setAccountDraft] = useState('')
  const [asOf, setAsOf] = useState(false)
  const [showOps, setShowOps] = useState(false)

  const bucketMinutes = chooseBucketMinutes(run, account)
  const ts = useFetch<TimeseriesResponse>(
    () =>
      api.timeseries(runId, {
        account: account || undefined,
        as_of_seq: asOf ? processedSeq : undefined,
        bucket_minutes: bucketMinutes,
        group_by_account: !!account,
      }),
    [runId, account, asOf, bucketMinutes],
  )

  const model = useMemo(() => {
    if (!ts.data) return null
    const serverMinutes = ts.data.source.bucket_minutes ?? bucketMinutes
    return {
      ...toBins(ts.data.rows, serverMinutes),
      freshness: describeFreshness(ts.data.source),
      serverMinutes,
    }
  }, [ts.data, bucketMinutes])

  return (
    <section aria-labelledby="activity" className="rounded-lg border border-border bg-surface">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <h2 id="activity" className="text-heading normal-case tracking-normal text-fg">
            Shape of the run
          </h2>
          {model ? <FreshnessChip freshness={model.freshness} /> : null}
        </div>

        {/* one filter row, above everything it scopes */}
        <div className="flex flex-wrap items-center gap-2">
          <form
            className="flex items-center gap-1.5"
            onSubmit={(e) => {
              e.preventDefault()
              setAccount(accountDraft.trim())
            }}
          >
            <input
              value={accountDraft}
              onChange={(e) => setAccountDraft(e.target.value)}
              placeholder="all accounts"
              aria-label="Filter by account"
              className="w-32 rounded-md border border-border bg-surface-raised px-2 py-1 font-mono text-mono text-fg focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
            />
            <Button type="submit" variant="outline" size="sm">
              Filter
            </Button>
          </form>
          <label className="flex items-center gap-1.5 text-caption text-fg-muted normal-case tracking-normal">
            <input type="checkbox" checked={asOf} onChange={(e) => setAsOf(e.target.checked)} className="accent-[var(--color-accent)]" />
            as of cutoff #{fmtNum(processedSeq)}
          </label>
        </div>
      </header>

      <div className="px-4 py-4">
        {ts.loading && !ts.data ? (
          <Skeleton className="h-48 w-full" />
        ) : ts.error && !ts.data ? (
          <ErrorState title="Could not load the activity series" detail={describeError(ts.error).text} onRetry={() => void ts.reload()} />
        ) : model ? (
          <div className={ts.loading ? 'opacity-60 transition-opacity' : undefined}>
            <RunActivityChart
              bins={model.bins}
              widthMs={model.widthMs}
              unitLabel={binUnitLabel(model.unit, model.serverMinutes)}
              cutoffLabel={account ? `account ${account}` : undefined}
              visibleStart={run.visible_start}
            />
          </div>
        ) : null}

        {model ? (
          <details className="mt-4 border-t border-border pt-3" open={showOps} onToggle={(e) => setShowOps((e.target as HTMLDetailsElement).open)}>
            <summary className="group/sum flex cursor-pointer list-none items-center gap-1.5 text-caption text-fg-muted normal-case tracking-normal hover:text-fg focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none">
              <ChevronRight className="size-3.5 shrink-0 transition-transform group-open/sum:rotate-90 motion-reduce:transition-none" aria-hidden />
              Where these numbers came from
            </summary>
            <div className="mt-3 space-y-4">
              <FreshnessDetail freshness={model.freshness} />
              <OperatorTools runId={runId} disabled={asOf} onRefreshed={() => void ts.reload()} />
            </div>
          </details>
        ) : null}
      </div>
    </section>
  )
}

/**
 * Operator-only actions. Behind the provenance disclosure on purpose — a judge reading the
 * chart should not be one click from re-materialising the aggregate.
 */
function OperatorTools({ runId, disabled, onRefreshed }: { runId: string; disabled: boolean; onRefreshed: () => void }) {
  const [refresh, setRefresh] = useState<{ busy: boolean; result: RefreshResponse | null; error: unknown }>({
    busy: false,
    result: null,
    error: null,
  })
  const [bench, setBench] = useState<{ busy: boolean; result: BenchmarkResponse | null; error: unknown }>({
    busy: false,
    result: null,
    error: null,
  })

  async function doRefresh() {
    setRefresh({ busy: true, result: null, error: null })
    try {
      const r = await api.refreshAggregate(runId)
      setRefresh({ busy: false, result: r, error: null })
      onRefreshed()
    } catch (e) {
      setRefresh({ busy: false, result: null, error: e })
    }
  }

  async function doBench() {
    setBench({ busy: true, result: null, error: null })
    try {
      setBench({ busy: false, result: await api.benchmark(runId, 5), error: null })
    } catch (e) {
      setBench({ busy: false, result: null, error: e })
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" disabled={refresh.busy || disabled} onClick={() => void doRefresh()}>
          {refresh.busy ? 'Refreshing…' : 'Re-materialise aggregate'}
        </Button>
        <Button variant="outline" size="sm" disabled={bench.busy} onClick={() => void doBench()}>
          {bench.busy ? 'Measuring…' : 'Benchmark aggregate vs raw'}
        </Button>
      </div>

      {refresh.result ? (
        <p className="font-mono text-mono text-fg-muted">
          {refresh.result.refreshed
            ? `refreshed through ${refresh.result.refreshed_through} · ${fmtNum(refresh.result.buckets)} buckets · ${fmtNum(refresh.result.duration_ms)} ms`
            : `not refreshed: ${refresh.result.reason ?? 'unknown reason'}`}
        </p>
      ) : null}
      {refresh.error ? <p className="text-caption text-high-risk normal-case tracking-normal">{describeError(refresh.error).text}</p> : null}

      {bench.result ? (
        <p className="font-mono text-mono text-fg-muted">
          aggregate {bench.result.aggregate_ms.median} ms vs raw {bench.result.raw_ms.median} ms (median of {bench.result.repeats}) ·{' '}
          {fmtNum(bench.result.rows)} rows ·{' '}
          <span className={bench.result.identical_results ? 'text-normal' : 'text-high-risk'}>
            {bench.result.identical_results ? 'identical results' : 'RESULTS DIFFER'}
          </span>
        </p>
      ) : null}
      {bench.error ? <p className="text-caption text-high-risk normal-case tracking-normal">{describeError(bench.error).text}</p> : null}
    </div>
  )
}
