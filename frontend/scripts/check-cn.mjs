#!/usr/bin/env node
/*
 * Guards src/lib/cn.ts against the class-group collision that silently drops tokens.
 *
 * tailwind-merge only recognises t-shirt sizes as font sizes, so without explicit config it
 * files `text-heading` under *colours* and lets it fight `text-fg` — keeping whichever came
 * last. The failure is silent and goes both ways: sometimes the size vanishes, sometimes the
 * colour. It shipped a ~2:1 contrast failure to the console before it was caught.
 *
 *   npm run check:cn
 */
import { cn } from '../src/lib/cn.ts'

/** [input, expected] — a size and a colour must survive together; same-group pairs collapse. */
const CASES = [
  ['text-heading text-fg', 'text-heading text-fg'],
  ['text-fg text-heading', 'text-fg text-heading'],
  ['text-caption text-fg-muted', 'text-caption text-fg-muted'],
  ['text-mono text-fg', 'text-mono text-fg'],
  ['text-body text-high-risk', 'text-body text-high-risk'],
  ['text-mono text-fg-subtle', 'text-mono text-fg-subtle'],
  ['text-display text-accent', 'text-display text-accent'],
  // Genuine conflicts still resolve to the last one.
  ['text-body text-caption', 'text-caption'],
  ['text-fg text-fg-muted', 'text-fg-muted'],
  ['bg-surface bg-surface-raised', 'bg-surface-raised'],
]

let failed = 0
for (const [input, expected] of CASES) {
  const got = cn(input)
  const ok = got === expected
  if (!ok) failed++
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} "${input}" -> "${got}"${ok ? '' : `  (expected "${expected}")`}`)
}

if (failed > 0) {
  console.error(`\n${failed} case(s) failed — a token is being dropped. Check FONT_SIZES/COLORS in src/lib/cn.ts.`)
  process.exit(1)
}
console.log('\ncn() keeps size and colour tokens together.')
