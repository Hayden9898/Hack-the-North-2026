/**
 * The only place the chart layer names a colour.
 *
 * Every value is a `var(--…)` reference to a token Agent A owns (contract frozen in
 * `docs/agents/README-agent-a-foundation.md` §5). Charts must never hard-code a hex: a chart
 * colour here carries product meaning, and it has to follow the theme without a re-render.
 * If Agent A renames a token, this file is the single edit.
 */

/** Verdict = the three threat classes. These are *status* colours in the dataviz sense: they mean
 *  good -> critical, they are reserved, and they always ship with an icon + label, never colour
 *  alone. Never reuse one as "series 4". */
export const VERDICT = {
  normal: 'var(--color-normal)',
  suspicious: 'var(--color-suspicious)',
  high_risk: 'var(--color-high-risk)',
} as const

/** Processing states. Architecture invariant #6: pending / late / blocked / failed are NOT a
 *  fourth threat class and must never read as a clean verdict. Colour alone cannot carry that —
 *  every use pairs with an icon + label, and `HATCH` is the non-colour backup channel. */
export const PROCESSING = {
  pending: 'var(--color-pending)',
  late: 'var(--color-late)',
  blocked: 'var(--color-blocked)',
} as const

export const SURFACE = {
  /** the colour a mark sits on — also the 2px surface-gap and surface-ring separator colour */
  base: 'var(--color-surface)',
  raised: 'var(--color-surface-raised)',
  border: 'var(--color-border)',
  borderStrong: 'var(--color-border-strong)',
} as const

export const INK = {
  primary: 'var(--color-fg)',
  secondary: 'var(--color-fg-muted)',
  /** axis ticks, gridlines, de-emphasised marks */
  subtle: 'var(--color-fg-subtle)',
} as const

export const ACCENT = 'var(--color-accent)'

/**
 * The emphasis form's background hue: "every other series", drawn so it recedes.
 *
 * Deliberately NOT `--color-normal`. De-emphasised is not a clean verdict — reusing the normal
 * token here would tell a judge that grey bars had been evaluated and cleared, which is false.
 * Requested from Agent A as R3.
 */
export const DEEMPHASIS = 'var(--color-fg-subtle)'

// ------------------------------------------------------------------ fixed mark specs

/** From the dataviz mark table. These are not style choices; they are the specs. */
export const MARK = {
  /** bars/columns never fill their slot — the leftover band is air */
  maxBarThickness: 24,
  lineWidth: 2,
  /** r >= 4 */
  markerRadius: 4,
  /** white doing the separating: between touching fills, and as a ring on overlapping dots */
  surfaceGap: 2,
  surfaceRing: 2,
  /** hairline, solid, one step off the surface — never dashed */
  gridWidth: 1,
  /** area fills are a wash, never a saturated block */
  areaOpacity: 0.1,
  /** rounded data-end, square at the baseline */
  barEndRadius: 4,
} as const

/**
 * The accessibility backup channel: 45 deg and its 135 deg mirror only (horizontal/vertical read
 * as gridlines). Used for processing states, and wherever hue alone would have to carry meaning.
 */
export type HatchAngle = 45 | 135

export function hatchId(key: string, angle: HatchAngle = 45): string {
  return `hatch-${key}-${angle}`
}
