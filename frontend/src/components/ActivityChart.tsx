import { useId, useMemo, useState } from 'react'
import { AreaClosed, LinePath } from '@visx/shape'
import { scaleLinear, scaleTime } from '@visx/scale'
import { curveLinear } from '@visx/curve'
import { motion } from 'motion/react'
import { fmtNum } from '../format'

// Bklit UI's area-chart pattern: Visx area/line primitives, subtle fill, a shared
// time scale and a contextual tooltip. Kept local to avoid registry-wide coupling.
export interface ChartPoint {
  time: number
  value: number
}
export function ActivityChart({
  data,
  label,
  color = 'var(--accent)',
}: {
  data: ChartPoint[]
  label: string
  color?: string
}) {
  const id = useId()
  const [active, setActive] = useState<number | null>(null)
  const width = 960,
    height = 228,
    left = 48,
    right = 14,
    top = 18,
    bottom = 32
  const max = Math.max(1, ...data.map((d) => d.value))
  const first = data[0]?.time ?? 0
  const last = data.at(-1)?.time ?? first + 1
  const x = useMemo(
    () =>
      scaleTime({
        domain: [new Date(first), new Date(last === first ? last + 60_000 : last)],
        range: [left, width - right],
      }),
    [first, last],
  )
  const y = useMemo(() => scaleLinear({ domain: [0, max], range: [height - bottom, top], nice: true }), [max])
  const point = active === null ? null : data[Math.min(active, data.length - 1)]
  const formatDate = (time: number) =>
    new Intl.DateTimeFormat('en', {
      month: 'short',
      day: 'numeric',
      ...(last - first < 86_400_000 ? { hour: '2-digit', minute: '2-digit' } : {}),
      timeZone: 'UTC',
    }).format(time)
  return (
    <div
      className="activity-chart"
      tabIndex={0}
      role="group"
      aria-label={`${label} over time. Use left and right arrows to inspect data.`}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
          e.preventDefault()
          setActive((n) =>
            Math.max(0, Math.min(data.length - 1, (n ?? 0) + (e.key === 'ArrowRight' ? 1 : -1))),
          )
        }
        if (e.key === 'Escape') setActive(null)
      }}
      onBlur={() => setActive(null)}
    >
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`${label}: ${fmtNum(data.reduce((sum, d) => sum + d.value, 0))} across ${data.length} time buckets`}
        onPointerLeave={() => setActive(null)}
        onPointerMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect()
          const cursor = x.invert(((e.clientX - rect.left) / rect.width) * width).getTime()
          let nearest = 0
          for (let i = 1; i < data.length; i++)
            if (Math.abs(data[i].time - cursor) < Math.abs(data[nearest].time - cursor)) nearest = i
          setActive(nearest)
        }}
      >
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.13} />
            <stop offset="100%" stopColor={color} stopOpacity={0.015} />
          </linearGradient>
        </defs>
        {y.ticks(4).map((tick) => (
          <g key={tick}>
            <line
              x1={left}
              y1={y(tick)}
              x2={width - right}
              y2={y(tick)}
              stroke="var(--line)"
              strokeDasharray="3 4"
            />
            <text x={left - 12} y={y(tick) + 4} textAnchor="end" className="chart-axis">
              {new Intl.NumberFormat('en', { notation: 'compact' }).format(tick)}
            </text>
          </g>
        ))}
        <motion.g initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }}>
          <AreaClosed
            data={data}
            x={(d) => x(d.time)}
            y={(d) => y(d.value)}
            yScale={y}
            curve={curveLinear}
            fill={`url(#${id})`}
          />
          <LinePath
            data={data}
            x={(d) => x(d.time)}
            y={(d) => y(d.value)}
            curve={curveLinear}
            stroke={color}
            strokeWidth={2}
          />
          {data.length === 1 && <circle cx={x(data[0].time)} cy={y(data[0].value)} r={4} fill={color} />}
        </motion.g>
        {[0, 1, 2, 3, 4].map((i) => {
          const time = first + ((last - first) * i) / 4
          return (
            <text
              key={i}
              x={left + ((width - right - left) * i) / 4}
              y={height - 5}
              textAnchor={i === 0 ? 'start' : i === 4 ? 'end' : 'middle'}
              className="chart-axis"
            >
              {formatDate(time)}
            </text>
          )
        })}
        {point && (
          <g>
            <line
              x1={x(point.time)}
              x2={x(point.time)}
              y1={top}
              y2={height - bottom}
              stroke="var(--fg-3)"
              strokeDasharray="3 3"
            />
            <circle
              cx={x(point.time)}
              cy={y(point.value)}
              r={4.5}
              fill={color}
              stroke="var(--bg-2)"
              strokeWidth={2}
            />
          </g>
        )}
      </svg>
      {point && (
        <div className="chart-tooltip" role="status">
          <span>{new Date(point.time).toISOString().replace('T', ' ').slice(0, 16)} UTC</span>
          <strong>
            <i style={{ background: color }} />
            {label}
            <b>{fmtNum(point.value)}</b>
          </strong>
        </div>
      )}
    </div>
  )
}
