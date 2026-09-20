/*
 * Bklit chart kit — barrel.
 *
 * Components pulled from the bklit registry (https://bklit.com/r/<name>.json) and adapted for
 * Vite: the "use client" directives are stripped and `@/lib/utils` is rewritten to `@/lib/cn`.
 * Their colours come from the `--chart-*` bridge in src/styles/theme.css, so they follow the
 * page palette and the light/dark toggle without per-chart configuration.
 *
 * Re-pull with:  python3 /tmp/pull-registry.py bklit/<name>
 */

// Cartesian charts
export { BarChart, type BarChartProps, type BarOrientation } from './bar-chart'
export { Bar, type BarProps, type BarAnimationType, type BarLineCap } from './bar'
export { BarXAxis, type BarXAxisProps } from './bar-x-axis'
export { AreaChart, type AreaChartProps } from './area-chart'
export { Area, type AreaProps } from './area'
export { LineChart, type LineChartProps } from './line-chart'
export { Line, type LineProps } from './line'

// 3D / glass bar surfaces
export {
  BarDepthProvider,
  type BarDepthProviderProps,
  BarDepthBack,
  type BarDepthBackProps,
  BarDepthFront,
  type BarDepthFrontProps,
  BarPulse,
  type BarPulseProps,
} from './bar-depth'

// Radial
export { RingChart, type RingChartProps } from './ring-chart'
export { Ring, type RingProps } from './ring'
export { RingCenter, type RingCenterProps } from './ring-center'

// Plot furniture
export { Grid, type GridProps } from './grid'
export { XAxis, type XAxisProps, selectEvenlySpacedIndices } from './x-axis'
export { YAxis, type YAxisProps } from './y-axis'
export { ReferenceArea, type ReferenceAreaProps } from './reference-area'

// Interaction — the pop-outs
export * from './tooltip'
export * from './legend'
export * from './markers'
