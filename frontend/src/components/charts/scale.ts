/**
 * Scales and tick selection for the console charts.
 *
 * Hand-rolled on purpose. The alternative was `d3-scale` + `d3-array`, but the only thing this
 * layer genuinely needs from them is nice-tick selection, and carrying the dependency would mean
 * editing `frontend/package.json` — the one file guaranteed to conflict with Agent A's Phase 0.
 * Zero dependencies keeps that merge clean and holds the bundle at its measured baseline.
 *
 * Everything here is pure: no DOM, no tokens, no React.
 */

export interface Scale {
  /** map a domain value to a pixel position */
  (v: number): number
  domain: readonly [number, number]
  range: readonly [number, number]
  /** inverse map, for pointer -> value hit testing */
  invert(px: number): number
}

function makeScale(
  domain: readonly [number, number],
  range: readonly [number, number],
  fwd: (v: number) => number,
  inv: (v: number) => number,
): Scale {
  const [d0, d1] = domain
  const [r0, r1] = range
  const f0 = fwd(d0)
  const f1 = fwd(d1)
  const span = f1 - f0
  const scale = ((v: number) => (span === 0 ? r0 : r0 + ((fwd(v) - f0) / span) * (r1 - r0))) as Scale
  scale.domain = domain
  scale.range = range
  scale.invert = (px: number) => {
    if (r1 === r0) return d0
    return inv(f0 + ((px - r0) / (r1 - r0)) * span)
  }
  return scale
}

const identity = (v: number) => v

export function linearScale(domain: readonly [number, number], range: readonly [number, number]): Scale {
  return makeScale(domain, range, identity, identity)
}

/**
 * Symmetric-log scale: log10 above 1, linear through 0.
 *
 * Response bytes span 0 to 8,459,200 and a plain log scale cannot represent the zero-byte
 * responses that really occur in this dataset.
 */
export function symlogScale(domain: readonly [number, number], range: readonly [number, number]): Scale {
  const fwd = (v: number) => Math.sign(v) * Math.log10(1 + Math.abs(v))
  const inv = (v: number) => Math.sign(v) * (10 ** Math.abs(v) - 1)
  return makeScale(domain, range, fwd, inv)
}

/** Discrete band scale for column charts: equal slots with padding, mark width capped by the caller. */
export interface BandScale {
  (i: number): number
  bandwidth: number
  step: number
}

export function bandScale(count: number, range: readonly [number, number], paddingRatio = 0.2): BandScale {
  const [r0, r1] = range
  const step = count > 0 ? (r1 - r0) / count : 0
  const bandwidth = Math.max(0, step * (1 - paddingRatio))
  const band = ((i: number) => r0 + i * step + (step - bandwidth) / 2) as BandScale
  band.bandwidth = bandwidth
  band.step = step
  return band
}

// ------------------------------------------------------------------ ticks

/** Round a raw step up to the nearest 1, 2, 5 x 10^k. */
function niceStep(raw: number): number {
  if (!(raw > 0) || !Number.isFinite(raw)) return 1
  const mag = 10 ** Math.floor(Math.log10(raw))
  const norm = raw / mag
  const mult = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10
  return mult * mag
}

/**
 * Nice linear ticks *within* [min, max].
 *
 * Note the contract: ticks land inside the domain, so passing a raw data maximum gives a top tick
 * below the data and a bar that overflows the top gridline. For a value axis use `axisTicks()`,
 * which nices the domain first.
 */
export function niceTicks(min: number, max: number, target = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return []
  if (min === max) return [min]
  const step = niceStep((max - min) / Math.max(1, target))
  const start = Math.floor(min / step) * step
  const out: number[] = []
  // Accumulate by index, not by repeated addition, so float error cannot drift the last tick.
  for (let i = 0; start + i * step <= max + step * 1e-9; i++) {
    const v = start + i * step
    if (v >= min - step * 1e-9) out.push(Number(v.toFixed(10)))
    if (out.length > 1000) break
  }
  return out
}

/** The upper end of a nice axis domain — so a bar never touches the top of the plot. */
export function niceMax(max: number, target = 5): number {
  if (!(max > 0) || !Number.isFinite(max)) return 1
  const step = niceStep(max / Math.max(1, target))
  return Math.ceil(max / step) * step
}

/**
 * The value axis a column/bar chart actually wants: a domain rounded up past the data, and ticks
 * that reach the top of it. Always anchored at zero — every bar here grows from one baseline.
 */
export function axisTicks(dataMax: number, target = 5): { max: number; ticks: number[] } {
  const max = niceMax(dataMax, target)
  return { max, ticks: niceTicks(0, max, target) }
}

const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** Candidate time steps, coarsest-last. Months and years are handled separately (uneven length). */
const TIME_STEPS: number[] = [
  SECOND, 5 * SECOND, 15 * SECOND, 30 * SECOND,
  MINUTE, 5 * MINUTE, 15 * MINUTE, 30 * MINUTE,
  HOUR, 3 * HOUR, 6 * HOUR, 12 * HOUR,
  DAY, 2 * DAY, 7 * DAY,
]

/**
 * Nice UTC time ticks. Everything in this product is UTC — the logs, the cutoffs and the
 * replay clock — so local-time ticks would misalign with every timestamp shown beside them.
 */
export function timeTicks(startMs: number, endMs: number, target = 6): number[] {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return []
  const span = endMs - startMs
  const raw = span / Math.max(1, target)

  // Past a week per tick, step in whole months so labels land on month boundaries.
  if (raw > 7 * DAY) {
    const out: number[] = []
    const d = new Date(startMs)
    let y = d.getUTCFullYear()
    let m = d.getUTCMonth()
    if (Date.UTC(y, m, 1) < startMs) m += 1
    const monthStep = Math.max(1, Math.round(raw / (30 * DAY)))
    for (let t = Date.UTC(y, m, 1); t <= endMs; t = Date.UTC(y, m, 1)) {
      out.push(t)
      m += monthStep
      y += Math.floor(m / 12)
      m %= 12
      if (out.length > 1000) break
    }
    return out
  }

  const step = TIME_STEPS.find((s) => s >= raw) ?? TIME_STEPS[TIME_STEPS.length - 1]
  const out: number[] = []
  for (let t = Math.ceil(startMs / step) * step; t <= endMs; t += step) {
    out.push(t)
    if (out.length > 1000) break
  }
  return out
}

// ------------------------------------------------------------------ axis labels

/** Compact count for an axis tick: 1200 -> "1.2k". Axis ticks use tabular figures. */
export function tickCount(n: number): string {
  const a = Math.abs(n)
  if (a >= 1e9) return `${trim(n / 1e9)}B`
  if (a >= 1e6) return `${trim(n / 1e6)}M`
  if (a >= 1e3) return `${trim(n / 1e3)}k`
  return String(Math.round(n))
}

function trim(v: number): string {
  const r = Math.round(v * 10) / 10
  return Number.isInteger(r) ? String(r) : r.toFixed(1)
}

/** Binary byte sizes, matching how the dataset reports response_bytes. */
export function tickBytes(n: number): string {
  if (!Number.isFinite(n)) return '—'
  const a = Math.abs(n)
  if (a < 1024) return `${Math.round(n)} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = n / 1024
  let i = 0
  while (Math.abs(v) >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${trim(v)} ${units[i]}`
}

/**
 * UTC tick label at a granularity matching the step, so an axis never repeats the same string.
 * `stepMs` is the gap between ticks.
 */
export function tickTime(ms: number, stepMs: number): string {
  const d = new Date(ms)
  const p2 = (n: number) => String(n).padStart(2, '0')
  if (stepMs >= 28 * DAY) return d.toLocaleString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })
  if (stepMs >= DAY) return d.toLocaleString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
  if (stepMs >= MINUTE) return `${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`
  return `${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())}`
}
