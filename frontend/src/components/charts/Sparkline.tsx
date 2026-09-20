import { useId, useMemo } from 'react'
import { cn } from '@/lib/cn'
import { type Tone, TONE_STROKE, TONE_WASH_TEXT } from './tone'

export interface SparklineProps {
  /** The series, in order. One point per sample; no gaps, no nulls. */
  data: number[]
  /** Identity colour. Defaults to the recessive axis grey. */
  tone?: Tone
  /** Rendered height in px. The width is always 100% of the parent. */
  height?: number
  /** Draw a gradient area under the line, in the tone's wash token. */
  fill?: boolean
  className?: string
}

/** Vertical breathing room inside the viewBox so the 2px stroke never clips at an extreme. */
const PAD = 6
/** Internal viewBox height. Arbitrary — preserveAspectRatio="none" scales it to `height`. */
const VB_H = 100

/**
 * A line with no axes, no labels and no grid — the smallest possible picture of a shape.
 *
 * Decoration-grade but data-true: the polyline is the real series, so it is always honest about
 * direction and roughly honest about proportion, and it is never the only place a value can be
 * read. It belongs inside a <StatTile>, under the figure it is describing; on its own it says
 * nothing, because without a scale a reader cannot take a number off it.
 *
 * Marked aria-hidden on purpose. The tile's label, value and hint already carry the meaning,
 * and a screen reader announcing an unlabelled squiggle is noise.
 */
export function Sparkline({ data, tone = 'neutral', height = 32, fill = false, className }: SparklineProps) {
  // A stable id per instance: two sparklines on one page must not share a <defs> gradient.
  // useId's colons are legal in HTML but awkward inside url(#…), so strip them.
  const gradientId = `lo-spark-${useId().replace(/:/g, '')}`

  const geometry = useMemo(() => {
    if (data.length === 0) return null

    const min = Math.min(...data)
    const max = Math.max(...data)
    // A flat series has no range to normalise against; draw it down the middle rather than
    // dividing by zero and producing NaN coordinates that silently blank the whole svg.
    const span = max - min || 1
    const width = Math.max(1, data.length - 1)

    const points = data.map((value, i) => {
      const x = data.length === 1 ? width / 2 : i
      const y = VB_H - PAD - ((value - min) / span) * (VB_H - PAD * 2)
      return `${x},${y}`
    })

    return {
      width,
      line: points.join(' '),
      // Close the path down to the baseline and back, so the area sits under the line.
      area: `0,${VB_H} ${points.join(' ')} ${width},${VB_H}`,
    }
  }, [data])

  if (!geometry) return null

  return (
    <svg
      aria-hidden
      className={cn('block w-full overflow-visible', className)}
      style={{ height }}
      viewBox={`0 0 ${geometry.width} ${VB_H}`}
      preserveAspectRatio="none"
    >
      {fill ? (
        <>
          <defs>
            {/*
             * stopColor="currentColor" + a wash text token keeps the gradient on real design
             * tokens; stopOpacity then fades that wash to nothing toward the baseline.
             */}
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" className={TONE_WASH_TEXT[tone]} stopColor="currentColor" stopOpacity={1} />
              <stop offset="100%" className={TONE_WASH_TEXT[tone]} stopColor="currentColor" stopOpacity={0} />
            </linearGradient>
          </defs>
          <polygon points={geometry.area} fill={`url(#${gradientId})`} />
        </>
      ) : null}
      <polyline
        className={TONE_STROKE[tone]}
        points={geometry.line}
        fill="none"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        /*
         * Mandatory with preserveAspectRatio="none": the viewBox is squashed non-uniformly, so
         * without this the "2px" stroke renders as a wedge that is hairline-thin horizontally
         * and fat vertically.
         */
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}
