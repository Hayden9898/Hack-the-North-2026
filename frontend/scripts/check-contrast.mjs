#!/usr/bin/env node
/*
 * Verifies every semantic colour token in src/styles/theme.css meets WCAG AA against all
 * three surface levels, in both themes. Parses the stylesheet so it can never drift from
 * the real values.
 *
 *   npm run check:contrast
 *
 * Thresholds follow WCAG, which does not apply one bar to everything:
 *   - text tokens            4.5:1  (1.4.3 contrast minimum), including --color-fg-subtle,
 *                                   which carries the record stamps, docket metadata and the
 *                                   footer — essential content, not decoration
 *   - --color-border-strong  3.0:1  (1.4.11 non-text contrast — it bounds controls)
 *   - --color-border         exempt (decorative hairline; conveys no information)
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const THEME = fileURLToPath(new URL('../src/styles/theme.css', import.meta.url))
const AA = 4.5
const NON_TEXT = 3.0
/**
 * Non-text: WCAG 1.4.11 sets 3:1, not 4.5:1. These bound controls or are the graphical
 * objects themselves — the chart marks are painted as `bg-*` swatches and `stroke-*`
 * series lines, never as type.
 */
const RELAXED = new Set(['border-strong', 'normal-mark', 'suspicious-mark', 'high-risk-mark'])
/**
 * Purely decorative; WCAG sets no minimum. Hairlines and shadows that carry no information
 * on their own — the chart's meaning is carried by its marks and its (text) axis labels,
 * which are held to the bars above.
 */
const EXEMPT = new Set(['border', 'grid', 'axis', 'chart-shadow'])
/**
 * Backgrounds that type is painted on, so they are the comparison set rather than candidates.
 * `sunken` (inset wells, code strips) and `chip` (chips, --bg-3, --pending-bg) are surfaces
 * too, but are not in SURFACES: holding every ink token against them as well would tighten
 * the gate beyond what the screens actually do.
 */
const NOT_INK = new Set(['sunken', 'chip'])
const SURFACES = ['bg', 'surface', 'surface-raised']

function oklchToSrgb(L, C, hDeg) {
  const h = (hDeg * Math.PI) / 180
  const a = C * Math.cos(h)
  const b = C * Math.sin(h)
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  const lin = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
  return lin.map((v) => {
    const c = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(Math.max(v, 0), 1 / 2.4) - 0.055
    return Math.min(1, Math.max(0, c))
  })
}

const luminance = ([r, g, b]) => {
  const f = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}

function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}

const hex = (rgb) => '#' + rgb.map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('')

function hexToSrgb(h) {
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  if (h.length === 8) h = h.slice(0, 6) // ignore alpha; contrast is measured against the token itself
  if (h.length !== 6) return null
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
}

/**
 * Pull `--lo-<name>: <colour>` pairs out of a `:root {}` / `.dark {}` block.
 *
 * The palette is authored in hex; oklch() is still accepted so the gate keeps working if a
 * token is ever expressed that way. Anything else (rgb(), color-mix(), var(), bare numbers)
 * is skipped — those are composite/derived values, not flat surface or ink colours.
 */
function parseBlock(css, selector) {
  const start = css.indexOf(selector + ' {')
  if (start === -1) throw new Error(`no ${selector} block in theme.css`)
  const body = css.slice(start, css.indexOf('\n}', start))
  const out = {}
  for (const m of body.matchAll(/--lo-([a-z0-9-]+):\s*([^;]+);/g)) {
    const [, name, raw] = m
    const value = raw.trim()
    const oklch = value.match(/^oklch\(([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)$/)
    if (oklch) {
      out[name] = oklchToSrgb(+oklch[1], +oklch[2], +oklch[3])
      continue
    }
    const hexMatch = value.match(/^#([0-9a-fA-F]{3,8})$/)
    if (hexMatch) {
      const rgb = hexToSrgb(hexMatch[1])
      if (rgb) out[name] = rgb
    }
  }
  return out
}

const css = readFileSync(THEME, 'utf8')
const themes = { light: parseBlock(css, ':root'), dark: parseBlock(css, '.dark') }

let failures = 0
for (const [themeName, tokens] of Object.entries(themes)) {
  console.log(`\n${themeName}`)
  const surfaces = SURFACES.map((s) => [s, tokens[s]])
  for (const [name, rgb] of Object.entries(tokens)) {
    if (SURFACES.includes(name) || NOT_INK.has(name) || name.endsWith('-wash') || name === 'hover') continue
    if (name.endsWith('-opacity')) continue
    if (EXEMPT.has(name)) continue
    if (name === 'accent-fg') continue // sits on --color-accent, not on a surface
    const need = RELAXED.has(name) ? NON_TEXT : AA
    const ratios = surfaces.map(([s, srgb]) => [s, contrast(rgb, srgb)])
    const worst = Math.min(...ratios.map(([, r]) => r))
    const ok = worst >= need
    if (!ok) failures++
    console.log(
      `  ${ok ? 'ok  ' : 'FAIL'} ${name.padEnd(15)} ${hex(rgb)}  ` +
        ratios.map(([s, r]) => `${s} ${r.toFixed(2)}`).join('  ') +
        `  (need ${need})`,
    )
  }
  // accent-fg is only ever painted on the accent itself.
  const af = contrast(tokens['accent-fg'], tokens.accent)
  const afOk = af >= AA
  if (!afOk) failures++
  console.log(`  ${afOk ? 'ok  ' : 'FAIL'} ${'accent-fg'.padEnd(15)} on accent ${af.toFixed(2)}  (need ${AA})`)
}

if (failures > 0) {
  console.error(`\n${failures} token(s) below WCAG AA`)
  process.exit(1)
}
console.log('\nAll tokens meet WCAG AA.')
