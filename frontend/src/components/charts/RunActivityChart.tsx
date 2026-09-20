import { useId, useMemo, useState } from 'react'
import { fmtNum } from '../../format'
import { cn } from '@/lib/cn'
import { axisTicks, bandScale, tickCount, tickTime, timeTicks } from './scale'
import type { Bin } from './timeseries'

/**
 * The shape of a run over time.
 *
 * Form choice matters here. "Events per bucket, by verdict" sounds like a stacked column, but
 * the real ratio on the demo run is 22,975 normal to 5 suspicious to 2 high risk — stacked, the
 * coloured segments are literally sub-pixel, and the chart would claim to show something it
 * cannot. So this is the emphasis form: total volume recedes into one de-emphasis hue, and the
 * rare verdicts are marks pinned to their bucket, which is what they actually are.
 *
 * Verdict colours are status colours: reserved, and always paired with a label in the legend.
 */
const W = 900
const H = 200
const PAD = { t: 12, r: 14, b: 34, l: 48 }
/** height of the dense-case flagged strip, drawn just under the baseline */
const STRIP_H = 6

export function RunActivityChart({
  bins,
  widthMs,
  unitLabel,
  cutoffLabel,
  visibleStart,
  className,
}: {
  bins: Bin[]
  widthMs: number
  unitLabel: string
  cutoffLabel?: string
  /** ISO instant the visible window begins; everything before it is warmup. */
  visibleStart?: string | null
  className?: string
}) {
  const uid = useId()
  const [hover, setHover] = useState<number | null>(null)
  const [showTable, setShowTable] = useState(false)

  const plotW = W - PAD.l - PAD.r
  const plotH = H - PAD.t - PAD.b

  const model = useMemo(() => {
    if (bins.length === 0) return null
    const peak = Math.max(...bins.map((b) => b.events))
    const { max, ticks } = axisTicks(peak, 4)
    const band = bandScale(bins.length, [PAD.l, PAD.l + plotW], bins.length > 80 ? 0.08 : 0.25)
    const barW = Math.max(1, Math.min(band.bandwidth, 24))
    const y = (v: number) => PAD.t + plotH - (max === 0 ? 0 : (v / max) * plotH)
    const t0 = bins[0].start
    const t1 = bins[bins.length - 1].start + widthMs
    return { max, ticks, band, barW, y, t0, t1 }
  }, [bins, widthMs, plotW, plotH])

  if (!model) {
    return (
      <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-body text-fg-muted">
        No activity under the current cutoff yet.
      </p>
    )
  }

  const { max, ticks, band, barW, y, t0, t1 } = model
  const warmupEndMs = visibleStart ? Date.parse(visibleStart) : Number.NaN
  const hasWarmup = Number.isFinite(warmupEndMs) && warmupEndMs > t0
  // Only draw the boundary when it actually falls inside the plotted range; past the right
  // edge there is no visible window on screen and the label would overflow the viewBox.
  const boundaryInRange = hasWarmup && warmupEndMs < t1
  const tTicks = timeTicks(t0, t1, 7)
  const tStep = tTicks.length > 1 ? tTicks[1] - tTicks[0] : widthMs
  const xOf = (ms: number) => PAD.l + ((ms - t0) / Math.max(1, t1 - t0)) * plotW
  const warmupBins = hasWarmup ? bins.filter((b) => b.start < warmupEndMs).length : 0
  const flagged = bins.filter((b) => b.high_risk > 0 || b.suspicious > 0)
  // Marks are for rare things. Past this share of buckets they collide into a field of colour
  // that overstates the finding, so the flagged layer becomes a counted strip instead.
  const dense = flagged.length > Math.max(12, bins.length * 0.15)
  const maxFlagged = Math.max(1, ...bins.map((b) => b.high_risk + b.suspicious))
  const hovered = hover !== null ? bins[hover] : null

  return (
    <figure className={cn('min-w-0', className)}>
      <figcaption className="mb-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <span className="text-caption text-fg-muted normal-case tracking-normal">
          Events per {unitLabel} bucket{cutoffLabel ? ` · ${cutoffLabel}` : ''}
        </span>
        <Legend onToggleTable={() => setShowTable((v) => !v)} showTable={showTable} hasWarmup={hasWarmup} />
      </figcaption>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full touch-none"
        role="img"
        aria-label={`Events over time. ${fmtNum(bins.length)} buckets, peak ${fmtNum(max)} events. ${fmtNum(flagged.length)} buckets contain a flagged verdict.`}
        onMouseLeave={() => setHover(null)}
      >
        {/* Warmup region: dimmed and explicitly labelled. */}
        {hasWarmup ? (
          <g>
            <rect
              x={PAD.l}
              y={PAD.t}
              width={Math.max(0, Math.min(W - PAD.r, xOf(warmupEndMs)) - PAD.l)}
              height={plotH}
              fill="var(--color-fg-subtle)"
              opacity={0.06}
            />
            {boundaryInRange ? (
              <>
                <line
                  x1={xOf(warmupEndMs)}
                  x2={xOf(warmupEndMs)}
                  y1={PAD.t}
                  y2={PAD.t + plotH}
                  stroke="var(--color-border-strong)"
                  strokeWidth={1}
                />
                <text
                  x={xOf(warmupEndMs) + 4}
                  y={PAD.t + 9}
                  textAnchor="start"
                  className="fill-[var(--color-fg-subtle)] text-[9px]"
                >
                  visible window begins
                </text>
              </>
            ) : null}
          </g>
        ) : null}

        {/* hairline grid, solid, one step off the surface — never dashed */}
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} stroke="var(--color-border)" strokeWidth={1} />
            <text x={PAD.l - 7} y={y(t) + 3} textAnchor="end" className="fill-[var(--color-fg-subtle)] text-[9px] tabular-nums">
              {tickCount(t)}
            </text>
          </g>
        ))}

        {/* total volume: de-emphasised, because it is context for the marks, not the story */}
        {bins.map((b, i) => {
          const h = b.events > 0 ? Math.max(1, (b.events / max) * plotH) : 0
          return (
            <rect
              key={b.start}
              x={band(i) + (band.bandwidth - barW) / 2}
              y={PAD.t + plotH - h}
              width={barW}
              height={h}
              rx={barW > 4 ? 2 : 0}
              fill="var(--color-fg-subtle)"
              opacity={hover === i ? 0.75 : 0.4}
            />
          )
        })}

        {/* Rare verdicts render as marks; see `dense` below for when they stop being rare. */}
        {!dense &&
          flagged.map((b, fi) => {
          const i = bins.indexOf(b)
          const cx = band(i) + band.bandwidth / 2
          const isHigh = b.high_risk > 0
          // Neighbouring flagged buckets would draw their dots on top of each other; stagger
          // the row so each stays a countable mark rather than a blob.
          const prev = fi > 0 ? flagged[fi - 1] : null
          const crowded = prev !== null && Math.abs(cx - (band(bins.indexOf(prev)) + band.bandwidth / 2)) < 12
          const cy = PAD.t + 6 + (crowded ? 11 : 0)
          return (
            <g key={`f-${b.start}`}>
              <line
                x1={cx}
                x2={cx}
                y1={PAD.t}
                y2={PAD.t + plotH}
                stroke={isHigh ? 'var(--color-high-risk)' : 'var(--color-suspicious)'}
                strokeWidth={1}
                opacity={0.35}
              />
              <circle
                cx={cx}
                cy={cy}
                r={4.5}
                fill={isHigh ? 'var(--color-high-risk)' : 'var(--color-suspicious)'}
                stroke="var(--color-surface)"
                strokeWidth={2}
              />
            </g>
          )
        })}

        {/* Dense case: a counted strip along the baseline. Height encodes how many flagged
            events fell in the bucket, colour the worst class present. Still recessive against
            the volume, but it no longer claims every bucket is an incident. */}
        {dense
          ? bins.map((b, i) => {
              const n = b.high_risk + b.suspicious
              if (n === 0) return null
              const h = Math.max(2, Math.min(STRIP_H, (n / maxFlagged) * STRIP_H))
              return (
                <rect
                  key={`s-${b.start}`}
                  x={band(i) + (band.bandwidth - barW) / 2}
                  y={PAD.t + plotH + 3}
                  width={barW}
                  height={h}
                  fill={b.high_risk > 0 ? 'var(--color-high-risk)' : 'var(--color-suspicious)'}
                  opacity={0.85}
                />
              )
            })
          : null}

        {/* time axis */}
        {tTicks.map((t) => {
          // Anchor edge labels inward; a centred label at the axis ends overflows the viewBox
          // and gets clipped mid-word ("Apr 202").
          const x = xOf(t)
          const anchor = x < PAD.l + 24 ? 'start' : x > W - PAD.r - 24 ? 'end' : 'middle'
          return (
            <text
              key={t}
              x={anchor === 'start' ? PAD.l : anchor === 'end' ? W - PAD.r : x}
              y={H - 8}
              textAnchor={anchor}
              className="fill-[var(--color-fg-subtle)] text-[9px] tabular-nums"
            >
              {tickTime(t, tStep)}
            </text>
          )
        })}

        {/* hit layer: full-height targets, far bigger than the marks */}
        {bins.map((b, i) => (
          <rect
            key={`h-${b.start}`}
            x={band(i)}
            y={PAD.t}
            width={Math.max(band.step, 3)}
            height={plotH}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
          >
            <title>{tooltipText(b, widthMs)}</title>
          </rect>
        ))}

        {hovered ? (
          <line
            x1={band(bins.indexOf(hovered)) + band.bandwidth / 2}
            x2={band(bins.indexOf(hovered)) + band.bandwidth / 2}
            y1={PAD.t}
            y2={PAD.t + plotH}
            stroke="var(--color-border-strong)"
            strokeWidth={1}
          />
        ) : null}
      </svg>

      {hovered ? (
        <p aria-live="polite" className="mt-1 font-mono text-mono text-fg-muted">
          {tooltipText(hovered, widthMs)}
        </p>
      ) : (
        <p className="mt-1 font-mono text-mono text-fg-subtle">
          {fmtNum(flagged.length)} of {fmtNum(bins.length)} buckets contain a flagged verdict
          {dense ? ' (shown as a counted strip below the baseline, not per-bucket marks)' : ''}
          {warmupBins > 0
            ? ` · ${fmtNum(warmupBins)} bucket${warmupBins === 1 ? '' : 's'} are historical warmup, replayed to build state rather than decided live`
            : ''}
        </p>
      )}

      {/* the table-view twin: every value reachable without colour or hover */}
      {showTable ? (
        <div className="mt-3 max-h-64 overflow-y-auto rounded-lg border border-border">
          <table className="w-full border-collapse font-mono text-mono" id={`${uid}-table`}>
            <thead className="sticky top-0 bg-surface-raised">
              <tr className="border-b border-border text-left">
                <th className="px-3 py-1.5 font-sans text-caption font-medium text-fg-muted uppercase">bucket (UTC)</th>
                <th className="px-3 py-1.5 text-right font-sans text-caption font-medium text-fg-muted uppercase">events</th>
                <th className="px-3 py-1.5 text-right font-sans text-caption font-medium text-fg-muted uppercase">401</th>
                <th className="px-3 py-1.5 text-right font-sans text-caption font-medium text-fg-muted uppercase">403</th>
                <th className="px-3 py-1.5 text-right font-sans text-caption font-medium text-fg-muted uppercase">susp.</th>
                <th className="px-3 py-1.5 text-right font-sans text-caption font-medium text-fg-muted uppercase">high risk</th>
              </tr>
            </thead>
            <tbody>
              {bins.map((b) => (
                <tr key={b.start} className="border-b border-border/50 last:border-0">
                  <td className="px-3 py-1 tabular-nums text-fg-muted">{new Date(b.start).toISOString().replace('.000Z', 'Z')}</td>
                  <td className="px-3 py-1 text-right tabular-nums text-fg">{fmtNum(b.events)}</td>
                  <td className="px-3 py-1 text-right tabular-nums text-fg-muted">{fmtNum(b.c401)}</td>
                  <td className="px-3 py-1 text-right tabular-nums text-fg-muted">{fmtNum(b.c403)}</td>
                  <td className={cn('px-3 py-1 text-right tabular-nums', b.suspicious ? 'text-suspicious' : 'text-fg-subtle')}>{fmtNum(b.suspicious)}</td>
                  <td className={cn('px-3 py-1 text-right tabular-nums', b.high_risk ? 'text-high-risk' : 'text-fg-subtle')}>{fmtNum(b.high_risk)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </figure>
  )
}

function Legend({ showTable, onToggleTable, hasWarmup }: { showTable: boolean; onToggleTable: () => void; hasWarmup: boolean }) {
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-caption normal-case tracking-normal">
      {hasWarmup ? <Key color="var(--color-fg-subtle)" label="historical warmup" muted /> : null}
      <Key color="var(--color-fg-subtle)" label="all events" muted />
      <Key color="var(--color-suspicious)" label="suspicious" />
      <Key color="var(--color-high-risk)" label="high risk" />
      <button
        type="button"
        onClick={onToggleTable}
        aria-pressed={showTable}
        className="rounded-sm text-fg-muted underline underline-offset-2 hover:text-fg focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
      >
        {showTable ? 'hide table' : 'table view'}
      </button>
    </span>
  )
}

function Key({ color, label, muted }: { color: string; label: string; muted?: boolean }) {
  return (
    <span className="flex items-center gap-1.5 text-fg-muted">
      <span
        aria-hidden
        className={cn('inline-block shrink-0 rounded-[2px]', muted ? 'h-2.5 w-2.5 opacity-40' : 'size-2.5 rounded-full')}
        style={{ background: color }}
      />
      {label}
    </span>
  )
}

function tooltipText(b: Bin, widthMs: number): string {
  const start = new Date(b.start).toISOString().replace('.000Z', 'Z')
  const parts = [`${start} · ${fmtNum(b.events)} events`]
  if (b.c401) parts.push(`${fmtNum(b.c401)}×401`)
  if (b.c403) parts.push(`${fmtNum(b.c403)}×403`)
  if (b.suspicious) parts.push(`${fmtNum(b.suspicious)} suspicious`)
  if (b.high_risk) parts.push(`${fmtNum(b.high_risk)} high risk`)
  void widthMs
  return parts.join(' · ')
}
