import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { RefreshCw } from 'lucide-react'
import { api, type Run } from '../api'
import { fmtNum, fmtTime } from '../format'
import { useFetch, useInterval } from '../useFetch'
import { Empty, ErrorState, Loading, Section, Tag } from '../ui'
import { ActivityChart } from '../components/ActivityChart'

const metrics = {
  events: 'Events',
  suspicious: 'Suspicious findings',
  high_risk: 'High-risk findings',
  errors: '401 / 403 responses',
} as const
type Metric = keyof typeof metrics

export function ActivityPanel({
  runId,
  processedSeq,
  run,
}: {
  runId: string
  processedSeq: number
  run: Run
}) {
  const [params, setParams] = useSearchParams()
  const range = params.get('chartRange') || 'all'
  const metric = (
    Object.hasOwn(metrics, params.get('metric') || '') ? params.get('metric') : 'events'
  ) as Metric
  const account = params.get('chartAccount') || ''
  const [advanced, setAdvanced] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const end = Date.parse(run.last_processed_time || run.last_admitted_time || '')
  const start =
    Number.isFinite(end) && range !== 'all'
      ? new Date(end - (range === '24h' ? 1 : 7) * 86_400_000).toISOString()
      : undefined
  const span = end - Date.parse(run.range_start || run.visible_start || '')
  const bucket =
    range === '24h' ? 5 : range === '7d' ? 60 : !Number.isFinite(span) || span > 14 * 86_400_000 ? 1440 : 60
  const series = useFetch(
    () =>
      api.timeseries(runId, {
        start,
        account: account || undefined,
        bucket_minutes: bucket,
        group_by_account: false,
      }),
    [runId, start, account, bucket],
  )
  const benchmark = useFetch(() => api.benchmark(runId), [runId, advanced], advanced)
  useInterval(() => {
    if (!document.hidden && ['running', 'warming'].includes(run.state)) void series.reload()
  }, 10_000)
  function update(key: string, value: string) {
    setParams(
      (p) => {
        if (value) p.set(key, value)
        else p.delete(key)
        return p
      },
      { replace: true },
    )
  }
  const points = useMemo(() => {
    const buckets = new Map<number, number>()
    for (const row of series.data?.rows ?? []) {
      const time = Date.parse(row.bucket)
      if (Number.isFinite(time))
        buckets.set(
          time,
          (buckets.get(time) ?? 0) + (metric === 'errors' ? row.c401 + row.c403 : row[metric]),
        )
    }
    return Array.from(buckets, ([time, value]) => ({ time, value })).sort((a, b) => a.time - b.time)
  }, [series.data, metric])
  async function refreshAggregate() {
    setBusy(true)
    setError(null)
    try {
      await api.refreshAggregate(runId)
      await series.reload()
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }
  const source = series.data?.source
  return (
    <Section
      title="Event activity"
      aside={
        <div className="row">
          <span className="chart-legend">
            <i />
            {metrics[metric]}
          </span>
          <select
            aria-label="Activity time range"
            value={range}
            onChange={(e) => update('chartRange', e.target.value)}
          >
            <option value="all">Full execution</option>
            <option value="7d">Last 7 event days</option>
            <option value="24h">Last 24 event hours</option>
          </select>
          <button
            className="icon-btn"
            aria-label="Refresh activity"
            disabled={series.refreshing}
            onClick={() => void series.reload()}
          >
            <RefreshCw size={15} className={series.refreshing ? 'spin' : ''} />
          </button>
        </div>
      }
    >
      <div className="chart-heading">
        <div>
          <strong>{series.data ? fmtNum(points.reduce((sum, p) => sum + p.value, 0)) : '—'}</strong>
          <span>{metrics[metric].toLowerCase()} in this window</span>
        </div>
        <select
          aria-label="Activity metric"
          value={metric}
          onChange={(e) => update('metric', e.target.value)}
        >
          {Object.entries(metrics).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
      </div>
      {series.loading ? (
        <Loading what="activity" />
      ) : !!series.error && !series.data ? (
        <ErrorState error={series.error} what="activity" onRetry={() => void series.reload()} />
      ) : !points.length ? (
        <Empty>No processed events in this time window.</Empty>
      ) : (
        <ActivityChart
          data={points}
          label={metrics[metric]}
          color={
            metric === 'high_risk'
              ? 'var(--danger)'
              : metric === 'suspicious'
                ? 'var(--warn)'
                : 'var(--accent)'
          }
        />
      )}
      {!!series.error && series.data && (
        <div className="notice notice-warn">Refresh failed. Showing the last loaded series.</div>
      )}
      <div className="chart-caption">
        <span>
          {bucket === 1440 ? 'Daily' : bucket === 60 ? 'Hourly' : '5-minute'} buckets · UTC · processed
          through #{fmtNum(series.data?.cutoff_seq ?? processedSeq)}
        </span>
        <span>
          {source?.mode === 'raw_fallback'
            ? 'Raw data fallback'
            : source?.mode === 'aggregate_plus_raw_tail' && source.stale
              ? 'Aggregate + recent events'
              : 'Processed evidence'}
        </span>
      </div>
      <details className="chart-details">
        <summary>Data and query details</summary>
        <div className="stack">
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault()
              update('chartAccount', String(new FormData(e.currentTarget).get('chartAccount') ?? '').trim())
            }}
          >
            <label className="field">
              Account
              <input key={account} name="chartAccount" placeholder="All accounts" defaultValue={account} />
            </label>
            <button className="btn btn-sm" type="submit">
              Apply
            </button>
            <button
              className="btn btn-sm"
              type="button"
              onClick={() => void refreshAggregate()}
              disabled={busy}
            >
              {busy ? 'Refreshing…' : 'Refresh aggregate'}
            </button>
          </form>
          {source && (
            <div className="small muted">
              {source.mode === 'aggregate_plus_raw_tail'
                ? `Materialized through ${fmtTime(source.materialized_through)}. ${source.materialized_buckets} aggregate buckets and ${source.raw_tail_buckets} raw-tail buckets.`
                : source.mode === 'raw_fallback'
                  ? `Raw fallback: ${source.reason}`
                  : `Snapshot at sequence ${source.as_of_seq}`}
            </div>
          )}
          {!!error && <ErrorState error={error} what="aggregate refresh" />}
          <div className="table-wrap chart-data">
            <table className="tbl">
              <caption className="sr-only">Activity data</caption>
              <thead>
                <tr>
                  <th>Bucket (UTC)</th>
                  <th>{metrics[metric]}</th>
                </tr>
              </thead>
              <tbody>
                {points.map((p) => (
                  <tr key={p.time}>
                    <td>{fmtTime(new Date(p.time).toISOString())}</td>
                    <td>{fmtNum(p.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            className="btn btn-sm"
            disabled={benchmark.loading}
            onClick={() => {
              if (advanced) void benchmark.reload()
              else setAdvanced(true)
            }}
          >
            Measure query performance
          </button>
          {advanced &&
            (benchmark.loading ? (
              <Loading what="benchmark" />
            ) : benchmark.error ? (
              <ErrorState error={benchmark.error} what="benchmark" />
            ) : (
              benchmark.data && (
                <div className="row small">
                  <Tag>Raw: {benchmark.data.raw_ms.median.toFixed(1)} ms</Tag>
                  <Tag>Aggregate: {benchmark.data.aggregate_ms.median.toFixed(1)} ms</Tag>
                  <Tag tone={benchmark.data.identical_results ? 'ok' : 'danger'}>
                    {benchmark.data.identical_results ? 'Results match' : 'Results differ'}
                  </Tag>
                </div>
              )
            ))}
        </div>
      </details>
    </Section>
  )
}
