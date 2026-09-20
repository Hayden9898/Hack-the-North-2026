/*
 * The chart kit's colour contract.
 *
 * Every chart component imports its class strings from here, so the mapping from a semantic
 * tone name to a design token exists exactly once. Nothing in this directory may write a hex,
 * an rgb() or an oklch() — the tokens live in src/styles/theme.css and only there.
 *
 * WHY THE STRINGS ARE SPELLED OUT IN FULL
 * Tailwind v4 scans source text for candidate class names. A class assembled at runtime
 * (`bg-${tone}`) is invisible to that scan and the utility is simply never emitted, so the
 * mark renders transparent. Each record below therefore holds complete literal strings. The
 * same rule is already applied to RULE_TONE_CLASS in src/pages/Landing/parts.tsx.
 *
 * HOW TO CHOOSE A TONE
 *   chart-1..6  identity. Assign by ENTITY — a rule, an account, a status class, a section —
 *               and keep it for that entity everywhere on the page. Fixed order, never cycled
 *               by rank, never extended to a 7th: a filter that drops a series must not
 *               repaint the survivors.
 *   normal /    verdict. These carry product meaning. Never spend one on "series 4", and
 *   suspicious/ never use a chart-N where the colour is supposed to mean a threat class.
 *   high-risk
 *   accent      the seal. One per view at most — a primary CTA or the single figure a section
 *               is built around. Used often, it stops being loud.
 *   neutral     the recessive default: unremarkable bars, baselines, "everything else".
 *
 * PAIRING CAVEAT (measured, not guessed)
 * chart-5 (violet) and chart-6 (blue) sit close enough that a protan/deutan reader separates
 * them poorly, and they are only ~10 ΔE apart for normal vision too. They are fine as distant
 * members of a set; do not make them neighbouring slices, adjacent stacked segments, or the
 * only two series in a comparison. Prefer chart-1..4 for small sets. Because of this, a
 * <Legend> is mandatory wherever two or more tones appear — identity is never colour alone.
 */

export type Tone =
  | 'chart-1'
  | 'chart-2'
  | 'chart-3'
  | 'chart-4'
  | 'chart-5'
  | 'chart-6'
  | 'normal'
  | 'suspicious'
  | 'high-risk'
  | 'accent'
  | 'neutral'

/** The categorical index in its fixed order. Iterate this; never generate a seventh entry. */
export const CATEGORICAL_TONES = [
  'chart-1',
  'chart-2',
  'chart-3',
  'chart-4',
  'chart-5',
  'chart-6',
] as const satisfies readonly Tone[]

/**
 * Ink. Use for a tile's single headline figure and as the `currentColor` source for SVG marks.
 *
 * Never colour ordinary labels, axis text or table values with these — text wears text tokens
 * and identity comes from the coloured mark beside it. `neutral` deliberately resolves to the
 * body ink rather than to a grey, because when this record is used for text that is what is
 * wanted; for a recessive *mark* use TONE_STROKE or TONE_BG instead.
 */
export const TONE_TEXT: Record<Tone, string> = {
  'chart-1': 'text-chart-1',
  'chart-2': 'text-chart-2',
  'chart-3': 'text-chart-3',
  'chart-4': 'text-chart-4',
  'chart-5': 'text-chart-5',
  'chart-6': 'text-chart-6',
  normal: 'text-normal',
  suspicious: 'text-suspicious',
  'high-risk': 'text-high-risk',
  accent: 'text-accent',
  neutral: 'text-fg',
}

/**
 * Solid fills — bars, legend swatches, the rail down a StatTile.
 *
 * The verdicts resolve to their `-mark` steps: a fill is not read as a glyph, so it is allowed
 * to be brighter than the text step of the same name. `neutral` is border-strong, which is the
 * quietest thing on the page that still reads as a mark.
 */
export const TONE_BG: Record<Tone, string> = {
  'chart-1': 'bg-chart-1',
  'chart-2': 'bg-chart-2',
  'chart-3': 'bg-chart-3',
  'chart-4': 'bg-chart-4',
  'chart-5': 'bg-chart-5',
  'chart-6': 'bg-chart-6',
  normal: 'bg-normal-mark',
  suspicious: 'bg-suspicious-mark',
  'high-risk': 'bg-high-risk-mark',
  accent: 'bg-accent',
  neutral: 'bg-border-strong',
}

/** Hairlines and outlines that need to carry the entity's identity. */
export const TONE_BORDER: Record<Tone, string> = {
  'chart-1': 'border-chart-1',
  'chart-2': 'border-chart-2',
  'chart-3': 'border-chart-3',
  'chart-4': 'border-chart-4',
  'chart-5': 'border-chart-5',
  'chart-6': 'border-chart-6',
  normal: 'border-normal',
  suspicious: 'border-suspicious',
  'high-risk': 'border-high-risk',
  accent: 'border-accent',
  neutral: 'border-border-strong',
}

/** Low-alpha tint panels and area fills. ~10-14% of the parent hue — a wash, never a block. */
export const TONE_WASH: Record<Tone, string> = {
  'chart-1': 'bg-chart-1-wash',
  'chart-2': 'bg-chart-2-wash',
  'chart-3': 'bg-chart-3-wash',
  'chart-4': 'bg-chart-4-wash',
  'chart-5': 'bg-chart-5-wash',
  'chart-6': 'bg-chart-6-wash',
  normal: 'bg-normal-wash',
  suspicious: 'bg-suspicious-wash',
  'high-risk': 'bg-high-risk-wash',
  accent: 'bg-accent-wash',
  neutral: 'bg-sunken',
}

/**
 * SVG strokes — sparkline polylines, donut arcs.
 *
 * `neutral` is the axis token here rather than the body ink: an unremarkable series is plot
 * furniture and must stay recessive, which is the opposite of what TONE_TEXT.neutral wants.
 */
export const TONE_STROKE: Record<Tone, string> = {
  'chart-1': 'stroke-chart-1',
  'chart-2': 'stroke-chart-2',
  'chart-3': 'stroke-chart-3',
  'chart-4': 'stroke-chart-4',
  'chart-5': 'stroke-chart-5',
  'chart-6': 'stroke-chart-6',
  normal: 'stroke-normal-mark',
  suspicious: 'stroke-suspicious-mark',
  'high-risk': 'stroke-high-risk-mark',
  accent: 'stroke-accent',
  neutral: 'stroke-axis',
}

/**
 * The wash colour expressed as a *text* colour, so an SVG <stop stopColor="currentColor"> can
 * pick it up. SVG gradient stops have no Tailwind utility of their own; setting `color` on the
 * stop and letting stop-color inherit through currentColor is the way to keep a gradient on
 * real tokens instead of on a hardcoded rgba().
 */
export const TONE_WASH_TEXT: Record<Tone, string> = {
  'chart-1': 'text-chart-1-wash',
  'chart-2': 'text-chart-2-wash',
  'chart-3': 'text-chart-3-wash',
  'chart-4': 'text-chart-4-wash',
  'chart-5': 'text-chart-5-wash',
  'chart-6': 'text-chart-6-wash',
  normal: 'text-normal-wash',
  suspicious: 'text-suspicious-wash',
  'high-risk': 'text-high-risk-wash',
  accent: 'text-accent-wash',
  neutral: 'text-sunken',
}
