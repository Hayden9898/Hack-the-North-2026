import { useMemo, useState } from 'react'
import { api, describeError, type BenchmarkResponse, type RefreshResponse, type TimeseriesResponse, type TimeseriesRow, type TimeseriesSource } from '../api'
import { fmtNum, fmtTime } from '../format'
import { useFetch } from '../useFetch'
import { Empty, ErrorState, Loading, Section, Tag } from '../ui'

const MAX_BUCKETS = 500

interface Bin {
  start: number // epoch ms
  events: number
  c401: number
  c403: number
  suspicious: number
  high_risk: number
}

type Rollup = '5m' | 'hour' | 'day'

/** Roll 5-minute buckets up client-side to hourly or daily bins when there are too many to draw. */
function rollup(rows: TimeseriesRow[]): { bins: Bin[]; unit: Rollup } {
  if (rows.length === 0) return { bins: [], unit: '5m' }
  // No spread over the row list: a full run returns >100k rows (per account per 5-minute bucket).
  const distinctTimes = new Set<number>()
  let tMin = Number.POSITIVE_INFINITY
  let tMax = Number.NEGATIVE_INFINITY
  for (const r of rows) {
    const t = Date.parse(r.bucket)
    if (!Number.isFinite(t)) continue
    distinctTimes.add(t)
    if (t < tMin) tMin = t
    if (t > tMax) tMax = t
  }
  let unit: Rollup = '5m'
  let size = 5 * 60_000
  if (distinctTimes.size > MAX_BUCKETS) {
    unit = 'hour'
    size = 3_600_000
    const span = tMax - tMin
    if (span / size > MAX_BUCKETS) {
      unit = 'day'
      size = 86_400_000
    }
  }
  const map = new Map<number, Bin>()
  for (const r of rows) {
    const t = Date.parse(r.bucket)
    if (!Number.isFinite(t)) continue
    const key = Math.floor(t / size) * size
    const b = map.get(key) ?? { start: key, events: 0, c401: 0, c403: 0, suspicious: 0, high_risk: 0 }
    b.events += r.events
    b.c401 += r.c401
    b.c403 += r.c403
    b.suspicious += r.suspicious
    b.high_risk += r.high_risk
    map.set(key, b)
  }
  return { bins: Array.from(map.values()).sort((a, b) => a.start - b.start), unit }
}

function iso(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z')
}

export function ActivityPanel({ runId, processedSeq }: { runId: string; processedSeq: number }) {
  const [account, setAccount] = useState('')
  const [accountDraft, setAccountDraft] = useState('')
  const [asOf, setAsOf] = useState(false)
  const ts = useFetch<TimeseriesResponse>(
    () => api.timeseries(runId, { account: account || undefined, as_of_seq: asOf ? processedSeq : undefined }),
    [runId, account, asOf],
  )
  const [refresh, setRefresh] = useState<{ busy: boolean; result: RefreshResponse | null; error: unknown | null }>({ busy: false, result: null, error: null })
  const [bench, setBench] = useState<{ open: boolean; busy: boolean; result: BenchmarkResponse | null; error: unknown | null }>({
    open: false,
    busy: false,
    result: null,
    error: null,
  })

  const rolled = useMemo(() => rollup(ts.data?.rows ?? []), [ts.data])

  async function doRefresh() {
    setRefresh({ busy: true, result: null, error: null })
    try {
      const r = await api.refreshAggregate(runId)
      setRefresh({ busy: false, result: r, error: null })
      void ts.reload()
    } catch (e) {
      setRefresh({ busy: false, result: null, error: e })
    }
  }

  async function runBench() {
    setBench((b) => ({ ...b, open: true, busy: true, error: null }))
    try {
      const r = await api.benchmark(runId, 5)
      setBench((b) => ({ ...b, busy: false, result: r }))
    } catch (e) {
      setBench((b) => ({ ...b, busy: false, error: e }))
    }
  }

  const refreshErr = refresh.error ? describeError(refresh.error) : null
  const benchErr = bench.error ? describeError(bench.error) : null

  return (
    <Section
      title={
        <span className="row">
          Activity <span className="muted small" style={{ textTransform: 'none', letterSpacing: 0 }}>Tiger continuous aggregate</span>
        </span>
      }
      aside={
        <div className="filters">
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault()
              setAccount(accountDraft.trim())
            }}
          >
            <input value={accountDraft} onChange={(e) => setAccountDraft(e.target.value)} placeholder="account (all)" style={{ width: 120 }} />
            <button type="submit" className="btn btn-sm">
              Filter
            </button>
          </form>
          <label className="check">
            <input type="checkbox" checked={asOf} onChange={(e) => setAsOf(e.target.checked)} /> as-of current cutoff (#{fmtNum(processedSeq)})
          </label>
          <button type="button" className="btn btn-sm" disabled={refresh.busy || asOf} onClick={() => void doRefresh()} title="POST /analytics/refresh (operator)">
            {refresh.busy ? 'Refreshing…' : 'Refresh aggregate'}
          </button>
        </div>
      }
    >
      {ts.data ? <FreshnessBadge source={ts.data.source} /> : null}
      {refresh.result ? (
        <div className="notice small" style={{ marginTop: 6 }}>
          {refresh.result.refreshed
            ? `Aggregate refreshed through ${fmtTime(refresh.result.refreshed_through)} · ${fmtNum(refresh.result.buckets)} buckets · ${fmtNum(refresh.result.duration_ms)} ms`
            : `Not refreshed: ${refresh.result.reason ?? 'unknown reason'}`}
        </div>
      ) : null}
      {refreshErr ? (
        <div className="notice notice-danger small" style={{ marginTop: 6 }}>
          Refresh failed (HTTP {refreshErr.status ?? '—'}): {refreshErr.text}
        </div>
      ) : null}

      <div style={{ marginTop: 8 }}>
        {ts.loading && !ts.data ? (
          <Loading what="activity" />
        ) : ts.error && !ts.data ? (
          <ErrorState error={ts.error} onRetry={() => void ts.reload()} what="activity time series" />
        ) : !ts.data || rolled.bins.length === 0 ? (
          <Empty>No activity buckets under the current cutoff{account ? ` for ${account}` : ''}.</Empty>
        ) : (
          <>
            {ts.error ? (
              <div className="notice notice-warn small" style={{ marginBottom: 6 }}>
                Refresh failed (HTTP {describeError(ts.error).status ?? '—'}); showing the last loaded series.
              </div>
            ) : null}
            <ActivityChart bins={rolled.bins} />
            <p className="muted small" style={{ marginTop: 4 }}>
              {fmtNum(ts.data.rows.length)} five-minute rows{account ? ` for ${account}` : ' summed across accounts'}
              {rolled.unit !== '5m' ? `, rolled up client-side to ${rolled.unit === 'hour' ? 'hourly' : 'daily'} bins (${fmtNum(rolled.bins.length)}) because more than ${MAX_BUCKETS} buckets were returned` : ''}
              . Bars: events per bin. Markers: <span style={{ color: 'var(--warn)' }}>401</span> · <span style={{ color: '#ffb36b' }}>403</span> ·{' '}
              <span style={{ color: 'var(--warn)' }}>■ suspicious</span> · <span style={{ color: 'var(--danger)' }}>■ high risk</span>. Counts are measured from processed
              evidence under cutoff #{fmtNum(ts.data.cutoff_seq)}.
            </p>
          </>
        )}
      </div>

      <details
        open={bench.open}
        onToggle={(e) => {
          const open = (e.currentTarget as HTMLDetailsElement).open
          setBench((b) => ({ ...b, open }))
          if (open && !bench.result && !bench.busy) void runBench()
        }}
        style={{ marginTop: 8 }}
      >
        <summary className="small muted">Benchmark: raw scoped query vs continuous aggregate (measured on this database, not a promise)</summary>
        <div className="small" style={{ marginTop: 6 }}>
          {bench.busy ? (
            <Loading what="benchmark" />
          ) : benchErr ? (
            <span style={{ color: 'var(--danger)' }}>
              Benchmark failed (HTTP {benchErr.status ?? '—'}): {benchErr.text}
            </span>
          ) : bench.result ? (
            <dl className="kvs">
              <div className="kv">
                <dt>raw ms (median)</dt>
                <dd className="mono">{bench.result.raw_ms.median.toFixed(1)}</dd>
              </div>
              <div className="kv">
                <dt>aggregate ms (median)</dt>
                <dd className="mono">{bench.result.aggregate_ms.median.toFixed(1)}</dd>
              </div>
              <div className="kv">
                <dt>identical results</dt>
                <dd>{bench.result.identical_results ? <span className="check-ok">✓ yes</span> : <span className="check-bad">✗ no</span>}</dd>
              </div>
              <div className="kv">
                <dt>rows · repeats · watermark</dt>
                <dd className="mono">
                  {fmtNum(bench.result.rows)} · {bench.result.repeats} · {fmtTime(bench.result.watermark)}
                </dd>
              </div>
            </dl>
          ) : null}
          <button type="button" className="btn btn-sm" style={{ marginTop: 6 }} disabled={bench.busy} onClick={() => void runBench()}>
            Run again (5 repeats)
          </button>
        </div>
      </details>
    </Section>
  )
}

function FreshnessBadge({ source }: { source: TimeseriesSource }) {
  if (source.mode === 'aggregate_plus_raw_tail') {
    return (
      <div className="row small">
        <Tag tone={source.stale ? 'warn' : 'ok'}>
          materialized through {fmtTime(source.materialized_through)} (refreshed {fmtTime(source.refreshed_at)}) + raw tail
        </Tag>
        <span className="muted">
          {fmtNum(source.materialized_buckets)} aggregate buckets · {fmtNum(source.raw_tail_buckets)} raw tail buckets
          {source.stale ? ' · stale: processed evidence is ahead of the aggregate' : ''}
          {source.last_processed_time ? ` · last processed ${fmtTime(source.last_processed_time)}` : ''}
        </span>
      </div>
    )
  }
  if (source.mode === 'raw_fallback') {
    return (
      <div className="row small">
        <Tag tone="warn">raw fallback: {source.reason}</Tag>
        <span className="muted">served from a raw scoped query; detector semantics unchanged</span>
      </div>
    )
  }
  return (
    <div className="row small">
      <Tag tone="info">pinned as-of seq {fmtNum(source.as_of_seq)}</Tag>
      <span className="muted">raw processed records with run_seq ≤ cutoff; the aggregate is not used for pinned views</span>
    </div>
  )
}

function ActivityChart({ bins }: { bins: Bin[] }) {
  const W = 960
  const H = 180
  const padL = 44
  const padR = 8
  const padT = 8
  const padB = 26
  const n = bins.length
  const max = bins.reduce((m, b) => (b.events > m ? b.events : m), 1)
  const innerW = W - padL - padR
  const innerH = H - padT - padB
  const bw = innerW / n
  const y = (v: number) => padT + innerH - (innerH * v) / max
  const labelEvery = Math.max(1, Math.ceil(n / 8))
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Events per time bin with 401, 403, suspicious and high-risk markers">
      <line x1={padL} y1={padT + innerH} x2={W - padR} y2={padT + innerH} stroke="var(--line-strong)" />
      <line x1={padL} y1={padT} x2={padL} y2={padT + innerH} stroke="var(--line-strong)" />
      <text x={padL - 6} y={padT + 4} fill="var(--fg-3)" fontSize="10" textAnchor="end">
        {fmtNum(max)}
      </text>
      <text x={padL - 6} y={padT + innerH} fill="var(--fg-3)" fontSize="10" textAnchor="end">
        0
      </text>
      {bins.map((b, i) => {
        const x = padL + i * bw
        const w = Math.max(1, bw - (bw > 3 ? 1 : 0))
        const top = y(b.events)
        return (
          <g key={b.start}>
            <rect x={x} y={top} width={w} height={padT + innerH - top} fill="var(--accent-2)" opacity={0.85}>
              <title>{`${iso(b.start)} — events ${fmtNum(b.events)}, 401 ${fmtNum(b.c401)}, 403 ${fmtNum(b.c403)}, suspicious ${fmtNum(b.suspicious)}, high risk ${fmtNum(b.high_risk)}`}</title>
            </rect>
            {b.c401 > 0 ? <rect x={x} y={y(b.c401) - 1} width={w} height={2} fill="var(--warn)" /> : null}
            {b.c403 > 0 ? <rect x={x} y={y(b.c403) - 1} width={w} height={2} fill="#ffb36b" /> : null}
            {b.suspicious > 0 ? <rect x={x} y={padT + innerH + 3} width={w} height={4} fill="var(--warn)" /> : null}
            {b.high_risk > 0 ? <rect x={x} y={padT + innerH + 8} width={w} height={4} fill="var(--danger)" /> : null}
            {i % labelEvery === 0 ? (
              <text x={x} y={H - 4} fill="var(--fg-3)" fontSize="9" textAnchor="start">
                {iso(b.start).slice(0, 16).replace('T', ' ')}
              </text>
            ) : null}
          </g>
        )
      })}
    </svg>
  )
}
