/**
 * The single seam between the analytics API and every chart.
 *
 * A teammate owns `backend/app/api/analytics.py` and the Tiger continuous aggregate, and the
 * response shape may still change. Nothing outside this module may import `TimeseriesRow` or
 * `TimeseriesSource`: charts consume `Bin` and `Freshness`, so a backend shape change is a
 * one-file fix here.
 */
import type { Run, TimeseriesQuery, TimeseriesRow, TimeseriesSource } from '../../api'

/** Server-side roll-up widths the API accepts. */
export type BucketMinutes = NonNullable<TimeseriesQuery['bucket_minutes']>

/** One plotted time bucket. Counts are additive, so bins can be re-rolled client-side. */
export interface Bin {
  /** bucket start, epoch ms */
  start: number
  events: number
  c401: number
  c403: number
  suspicious: number
  high_risk: number
  /** summed response bytes; coerced from the API's bigint-as-string */
  bytes: number
}

/** Which width the returned bins actually carry, after any client-side safety roll-up. */
export type BinUnit = 'server' | 'hour' | 'day'

export interface Bins {
  bins: Bin[]
  unit: BinUnit
  /** width of one bin in ms — charts need this to size marks and label the axis */
  widthMs: number
}

const MINUTE_MS = 60_000
const HOUR_MS = 3_600_000
const DAY_MS = 86_400_000

/** Above this many distinct buckets the client rolls up before drawing. */
const MAX_BUCKETS = 500

export function bucketLabel(minutes: number): string {
  if (minutes === 1440) return 'daily'
  if (minutes === 60) return 'hourly'
  if (minutes === 5) return 'five-minute'
  return `${minutes}-minute`
}

export function binUnitLabel(unit: BinUnit, serverMinutes: number): string {
  if (unit === 'hour') return 'hourly (rolled up client-side)'
  if (unit === 'day') return 'daily (rolled up client-side)'
  return bucketLabel(serverMinutes)
}

/** `response_bytes` is a bigint the API serialises as a string. */
function toBytes(v: TimeseriesRow['response_bytes']): number {
  const n = typeof v === 'string' ? Number(v) : v
  return Number.isFinite(n) ? n : 0
}

/**
 * Fold API rows into drawable bins, rolling up to hourly or daily when a run returns more buckets
 * than we can honestly draw.
 *
 * Deliberately avoids spreading the row list: grouped by account at five-minute buckets a full run
 * returns >100k rows, and `Math.min(...rows)` on that blows the call stack.
 */
export function toBins(rows: readonly TimeseriesRow[], serverMinutes: number): Bins {
  if (rows.length === 0) return { bins: [], unit: 'server', widthMs: serverMinutes * MINUTE_MS }

  const distinct = new Set<number>()
  let tMin = Number.POSITIVE_INFINITY
  let tMax = Number.NEGATIVE_INFINITY
  for (const r of rows) {
    const t = Date.parse(r.bucket)
    if (!Number.isFinite(t)) continue
    distinct.add(t)
    if (t < tMin) tMin = t
    if (t > tMax) tMax = t
  }
  if (distinct.size === 0) return { bins: [], unit: 'server', widthMs: serverMinutes * MINUTE_MS }

  let unit: BinUnit = 'server'
  let width = serverMinutes * MINUTE_MS
  if (distinct.size > MAX_BUCKETS && serverMinutes < 1440) {
    // Only claim a roll-up when one actually happens. `Math.max(width, HOUR_MS)` is a no-op
    // once the server already returns hourly-or-wider buckets, so setting unit='hour'
    // unconditionally made binUnitLabel report "hourly (rolled up client-side)" for data that
    // arrived hourly and was never re-bucketed — a false provenance line on the one panel
    // whose job is saying where its numbers came from.
    if (HOUR_MS > width) {
      unit = 'hour'
      width = HOUR_MS
    }
    if ((tMax - tMin) / width > MAX_BUCKETS) {
      unit = 'day'
      width = DAY_MS
    }
  }

  const byStart = new Map<number, Bin>()
  for (const r of rows) {
    const t = Date.parse(r.bucket)
    if (!Number.isFinite(t)) continue
    const key = Math.floor(t / width) * width
    let b = byStart.get(key)
    if (!b) {
      b = { start: key, events: 0, c401: 0, c403: 0, suspicious: 0, high_risk: 0, bytes: 0 }
      byStart.set(key, b)
    }
    b.events += r.events
    b.c401 += r.c401
    b.c403 += r.c403
    b.suspicious += r.suspicious
    b.high_risk += r.high_risk
    b.bytes += toBytes(r.response_bytes)
  }

  return { bins: [...byStart.values()].sort((a, b) => a.start - b.start), unit, widthMs: width }
}

/**
 * Server-side roll-up width: hourly by default, daily past a 14-day span, five-minute for a short
 * visible window or a single-account view.
 */
export function chooseBucketMinutes(run: Run, account: string): BucketMinutes {
  if (account) return 5
  const end = Date.parse(run.last_processed_time ?? run.last_admitted_time ?? '')
  const visibleStart = Date.parse(run.visible_start ?? '')
  const spanStart = Date.parse(run.range_start ?? run.visible_start ?? '')
  const endMs = Number.isFinite(end) ? end : Date.now()

  const visibleWindow = Number.isFinite(visibleStart) ? endMs - visibleStart : Number.NaN
  if (Number.isFinite(visibleWindow) && visibleWindow > 0 && visibleWindow < DAY_MS) return 5

  const span = Number.isFinite(spanStart) ? endMs - spanStart : Number.NaN
  if (Number.isFinite(span) && span > 14 * DAY_MS) return 1440
  return 60
}

// ------------------------------------------------------------------ freshness

/**
 * Where a chart's numbers came from, flattened from the three `TimeseriesSource` modes so the UI
 * never branches on `mode` itself.
 *
 * `tone` is a *processing* signal, not a verdict — render it with processing-state treatment,
 * never with verdict colour.
 */
export interface Freshness {
  /** short chip text */
  label: string
  /** one sentence a judge can read without knowing the schema */
  detail: string
  tone: 'materialized' | 'tail' | 'stale' | 'raw' | 'as_of'
  /** true when the aggregate is behind the run's processed cutoff */
  stale: boolean
  /** ISO instant the aggregate is materialized through, when there is one */
  materializedThrough: string | null
  /** ISO instant the aggregate was last refreshed, when known */
  refreshedAt: string | null
  materializedBuckets: number | null
  rawTailBuckets: number | null
  bucketMinutes: number | null
  groupedByAccount: boolean
}

export function describeFreshness(source: TimeseriesSource): Freshness {
  const bucketMinutes = source.bucket_minutes ?? null
  const groupedByAccount = source.group_by_account ?? false

  if (source.mode === 'aggregate_plus_raw_tail') {
    const stale = source.stale
    return {
      label: stale ? 'aggregate behind cutoff' : 'materialized aggregate',
      detail: stale
        ? `Tiger continuous aggregate is materialized through ${source.materialized_through}, behind the run's processed cutoff. The gap is served from raw rows.`
        : `Served from the Tiger continuous aggregate: ${source.materialized_buckets.toLocaleString()} materialized buckets through ${source.materialized_through}, plus ${source.raw_tail_buckets.toLocaleString()} raw tail bucket${source.raw_tail_buckets === 1 ? '' : 's'}.`,
      tone: stale ? 'stale' : source.raw_tail_buckets > 0 ? 'tail' : 'materialized',
      stale,
      materializedThrough: source.materialized_through,
      refreshedAt: source.refreshed_at,
      materializedBuckets: source.materialized_buckets,
      rawTailBuckets: source.raw_tail_buckets,
      bucketMinutes,
      groupedByAccount,
    }
  }

  if (source.mode === 'raw_fallback') {
    return {
      label: 'raw fallback',
      detail: `The continuous aggregate was not used (${source.reason}). Numbers are computed from raw rows under the cutoff — correct, but not the materialized path.`,
      tone: 'raw',
      stale: true,
      materializedThrough: null,
      refreshedAt: null,
      materializedBuckets: null,
      rawTailBuckets: null,
      bucketMinutes,
      groupedByAccount,
    }
  }

  return {
    label: 'as-of cutoff',
    detail: `Recomputed from raw rows as of run_seq #${source.as_of_seq.toLocaleString()}, so the chart matches exactly what had been processed at that point.`,
    tone: 'as_of',
    stale: false,
    materializedThrough: null,
    refreshedAt: null,
    materializedBuckets: null,
    rawTailBuckets: null,
    bucketMinutes,
    groupedByAccount,
  }
}
