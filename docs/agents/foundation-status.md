# Agent A — Foundation & Landing: status log

Append-only. One entry per push. Never edit `console-status.md`.

Format: `## <timestamp> — <headline>` then: what landed · what it unblocks for Agent B · anything broken.

---

## Seeded by setup — brief ready, no work started

- Branch `hayden/frontend-foundation` cut from `hayden/frontend`.
- Brief: `docs/agents/README-agent-a-foundation.md`.
- Repo verified running: API + Vite + TimescaleDB up, dataset imported (180,800 rows, 0 rejects),
  86 backend tests green, `rules_only` mode (no model artifacts).
- **Next:** Phase 0 — Tailwind v4 + shadcn/ui + Motion.dev + design tokens + route migration.
  Agent B is blocked until this is pushed.

## 2026-09-19 — Phase 0 LIVE: Agent B is unblocked

**What landed.** Tailwind v4, shadcn/ui (new-york), Motion.dev v13, the full §5 token
contract, and the `/app` route migration. `typecheck`, `lint` and `build` are green.

### Routes (build internal links against these now)

```
/                                 Landing          (mine)
/app                              RunsPage
/app/runs/:runId                  RunConsole
/app/runs/:runId/incidents/:id    IncidentPage
/app/runs/:runId/events/:seq      EventPage
/runs/*                           -> /app/runs/*   (redirect; keeps query + hash)
```

I re-prefixed the internal links in `ui.tsx`, `RunsPage`, `RunConsole`, `IncidentPage`,
`EventPage` and `NotFound` — **route strings only, no styling, one line each.** `api.ts` is
untouched. Expect these to merge cleanly into whatever you rewrite.

### Import paths

```ts
import { cn } from '@/lib/cn'
import { DUR, EASE, useReducedMotion, useRise, useLayoutTransition, stagger } from '@/lib/motion'
import { useTheme } from '@/lib/theme-context'

import { Button }   from '@/components/ui/button'
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/card'
import { Badge }    from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Sheet, SheetTrigger, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'  // provider already mounted at root
import { Skeleton }   from '@/components/ui/skeleton'
import { Separator }  from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { Toast, toast } from '@/components/ui/toast'   // <Toast /> already mounted in App.tsx
import { StatusChip, resolveStatus } from '@/components/ui/status-chip'
import { CodeBlock, CodeInline } from '@/components/ui/code-block'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
```

### Tokens — use as Tailwind utilities

Surfaces/text: `bg-bg` `bg-surface` `bg-surface-raised` `bg-hover` · `text-fg` `text-fg-muted`
`text-fg-subtle` · `border-border` `border-border-strong` · `text-accent` `bg-accent`
`text-accent-fg`

Verdicts: `text-normal` `text-suspicious` `text-high-risk` (+ `bg-*-wash` tints)
Processing states: `text-pending` `text-late` `text-blocked`

Radii: `rounded-sm|md|lg|xl` (3/5/8/14px — deliberately different values)
Type: `text-display` `text-title` `text-heading` `text-body` `text-caption` `text-mono`
Fonts: `font-sans` (IBM Plex Sans) · `font-serif` (Instrument Serif, display only) ·
`font-mono` (IBM Plex Mono — **use for every log line, hash and ID**)

### Two things that will bite you if you don't read them

1. **Do not hand-pick a verdict colour.** Use `<StatusChip verdict="high_risk" />` or
   `<StatusChip state="late" />`. Props are a discriminated union (verdict XOR state), so
   you cannot pass a processing state into a verdict slot. `resolveStatus(threat_class,
   processing_status)` collapses the API pair for you, with processing state winning.
   Verdicts render as tinted fills; processing states render as outline + diagonal hatch.
   That difference is structural, which is how invariant #6 survives greyscale and
   colour-blindness. Please don't flatten it back to a hue difference.

2. **Stylesheet layer order is load-bearing**: `theme, base, legacy, app-base, components,
   utilities`. Your old `index.css` is imported into the `legacy` layer, so it still
   outranks Tailwind's preflight — that is the only reason your six screens still look
   like themselves today. It loses to `utilities`, so your Tailwind classes work normally.
   As you convert a screen, just delete its rules from `index.css`.

### Known state / caveats

- **Theme defaults to dark on purpose.** Your screens are dark-only legacy CSS; defaulting
  to dark keeps them pixel-identical to before. Light mode is fully supported by my tokens
  and components — the legacy console will look wrong in light until you convert it. Not a
  bug, and nothing for you to work around.
- `npm run check:contrast` parses `theme.css` and asserts WCAG AA (4.5:1 text, 3:1 non-text).
  Run it if you add a colour. **It currently reports 10 failures, all real** — see
  "Known: the light palette is below AA" below. Do not treat a red run as noise.
- Verified: `/` and `/app` both 200, console renders, `typecheck && lint && build` green.
  Lint emits 5 pre-existing `only-export-components` fast-refresh warnings; oxlint exits 0.
- The shadcn CLI mis-resolved `@/` and installed an unrelated npm package called `cn`.
  Removed. If you run `shadcn add`, check what it writes — the root tsconfig now has
  `paths`, so it should behave.

**REQUEST to B:** none. Nothing blocks me on you.

**Next for me:** landing page design + the §8 rate-and-iterate loop. I will not touch your
six screens again.

## 2026-09-19 (later) — three changes that touch your screens. Please pull.

You merged Phase 0 at `3831907`. Four commits since then, three of which affect you.

### 1. Legacy console CSS is now scoped to `.app` — `index.css`

`index.css` targeted `h1/h2/h3/a/p/code/pre/input` as **bare elements**, so it escaped the
console and restyled the landing page (`h2` forced UPPERCASE and a muted colour onto every
section heading on `/`). Those rules are now `.app h2 { … }` etc., and the font stack plus the
14px base moved onto `.app` itself.

**Your screens render byte-identically** — I screenshotted `/app` and `/app/runs/:id` before
and after to confirm. It only matters to you if you add a component that renders **outside**
`.app`: it will no longer inherit the legacy element styles. Everything under the shell is
unchanged. As you convert a screen, deleting its rules from `index.css` still works the same way.

### 2. `CodeBlock` no longer wraps by default — **behaviour change**

`wrap` now defaults to **`false`**. Wrapped log lines were splitting mid-token — a timestamp
broke as `[05/Aug/2025:1` + `3:05:36`, a path broke inside the word `reports`. On the one
component whose entire job is byte-exact evidence, that is a fidelity bug. Lines now scroll
horizontally with a right-edge fade mask, and the container is width-constrained so an
overflowing line can never widen the page.

```tsx
<CodeBlock code={raw} />                  // scrolls, line stays intact  ← new default
<CodeBlock code={raw} wrap />             // old behaviour, if you want it somewhere
<CodeBlock code={raw} lineNumbers maxHeight="24rem" />   // for the 77-denial evidence rail
```

For your paged 77-denial list I would keep the default (no wrap): a judge comparing 77 lines
wants them aligned in a column, and a wrapped line destroys that. **REQUEST → me:** if the
evidence rail needs a different affordance (line numbers in a sticky gutter, a "copy all"
action, virtualised rows), say so and I will build it into `CodeBlock` rather than have you
fork it.

### 3. One focus treatment everywhere — `components/ui/*`

shadcn primitives shipped `outline-none` plus a 50%-alpha box-shadow ring, so buttons had a
weaker and visually different focus indicator than every link. Removed the opt-out; the single
2px solid accent outline from `styles/base.css` now applies to everything. Verified by tabbing
the page over CDP: 14 focusables, all with a visible ring (3 had none before). Nothing for you
to do — it just means don't re-add `outline-none` when you pull a new shadcn component.

### Also available to you

- `npm run check:contrast` — parses `theme.css`, asserts WCAG (4.5:1 text, 3:1 for non-text
  `border-strong` and the chart marks; decorative `border`, `grid`, `axis` and `chart-shadow`
  exempt; `sunken`/`chip` are surfaces, not ink). Run it if you add a colour. Red today, and
  the failures are real — see "Known: the light palette is below AA".
- `node scripts/shoot.mjs <outDir>` — dependency-free headless-Chrome screenshots, full-page,
  both themes, 1440×900 and 390×844. `SHOOT_PAGES="/app:runs,/app/runs/<id>:console"` to point
  it at your screens. It seeds the theme in localStorage before load, so you get a real light
  capture rather than a flash. I used it for every round of the review loop; it will save you
  the same setup.
- `--color-hover` exists for neutral hover surfaces. Use it rather than `--color-accent` —
  brass is chrome (focus, primary action, links), never a hover fill.

### Landing page status

Round 1 of the review loop scored a mean of 7.42/10 across three blind judges (lowest: motion
6.0, craft 6.33). Round 2 is running. Nothing on the landing page imports from your files
except `api.ts`, `format.ts` and `useFetch.ts`, all read-only.

**REQUEST from you:** none outstanding. Nothing blocks me.

## 2026-09-19 (later still) — R4 fixed: `cn()` was dropping tokens. Pull this one.

**R4 is fixed and pushed** (`fix(design): cn() was silently dropping colour and size tokens`).
Thank you for the diagnosis — it was exactly right, and worse than it looked.

`twMerge` only recognises t-shirt sizes as font sizes, so it filed every `--text-*` token under
**colours**, put `text-heading` in the same conflict group as `text-fg`, and kept whichever came
last. Six of eight probe cases were losing a token, including `text-mono text-fg` — the pair
`CodeBlock` uses for every raw log line, so this was corrupting evidence rendering on my side too.

`cn.ts` now registers both scales with `extendTailwindMerge`. A size and a colour survive
together; genuine same-group conflicts still collapse to the last one, as they should:

```
text-heading text-fg      -> text-heading text-fg     (was: text-fg)
text-mono text-fg         -> text-mono text-fg        (was: text-fg)
text-body text-caption    -> text-caption             (correct: both are sizes)
text-fg text-fg-muted     -> text-fg-muted            (correct: both are colours)
```

**You can revert your five workarounds** and write the natural `cn('text-heading text-fg', …)`
again. `npm run check:cn` locks the behaviour in — worth running if you add a token, because the
failure mode is invisible in review: nothing errors, the class just disappears.

**If you add a `--text-*` step**, add it to `FONT_SIZES` in `cn.ts` or it will silently fight the
colour utilities. `check:cn` will catch it.

### On the theme default

You're right that my comment was stale, and I've corrected it. Dark stays the default — but now
because it is the theme the product was designed around and the one the demo runs in, not because
your screens were unfinished. It is a one-word change in `lib/theme.tsx` if the owner prefers
`system`; I'm leaving it as the owner's call rather than changing demo behaviour this late.

### On R5 (`GET /api/v1/runs` returns empty `counts`)

Agreed with how you handled it, and noting it here so it reaches the reviewer from both branches:
rendering honest cursor progress beats N+1 fetches that look fine with two runs and collapse with
fifty. That one is the backend teammate's to serve.

### Landing status

Four judging rounds run: 7.42 → 7.71 → 7.41 → (round 4 scoring now). The dips are the panel
getting more forensic each round, not regressions — round 3 caught a hero capsule that was
truncating a raw log line into a fragment that exists in no log file, which is exactly the class
of bug this product cannot ship. Fixed, and the capsule now shares one code path with the
Exhibit A strips.

## 2026-09-20 — final. PR branch cut; 4 rounds run, threshold not met.

**Stopped at 4 rounds on the owner's instruction** (asked to speed up and test), below the
mean ≥8.5 threshold. Final means: hierarchy 7.33 · typography 7.67 · spacing 6.83 ·
colour 7.67 · motion 8.50 · density 7.50 · originality 8.67 · craft 6.50 → **7.58**.
Craft and spacing are both under 7. Not rounding up.

Round means were 7.42 → 7.71 → 7.41 → 7.58. Roughly flat, because each panel measured more
precisely than the last and found real defects the previous one had accepted by eye. What the
loop bought was defect removal, not score: the blank light page, a hero capsule truncating a
raw log line into `IDENTIAL.zip`, the `77` and the AFTER strip painted in the verdict colour,
978px then 405px of mobile overflow, and `fg-subtle` at 4.26:1 in light.

**PR is from `hayden/frontend-foundation-pr`, not `hayden/frontend-foundation`.** The ML
teammate committed into the same working tree after I checked my branch out into it, so nine
backend/ML commits landed on my branch — three exist nowhere else. I cherry-picked my 20
commits onto a clean branch rather than force-push and risk orphaning their work. The original
branch is untouched and still holds them. The PR branch touches `frontend/` and `docs/agents/`
only.

Nothing merged. Nothing on `main`.

## 2026-09-20 (post-merge) — Known: the light palette is below AA

`npm run check:contrast` had been **crashing, not passing**, since the palette rebuild
(`eec144b`). The script only ever parsed `--lo-<name>: oklch(...)`, and that commit moved the
whole palette to hex, so it matched zero tokens and then threw on `tokens['accent-fg']`. Every
"all tokens pass" note above it was written against a gate that was not running.

The parser now reads hex (and still reads oklch), and the token taxonomy matches how the
tokens are actually painted: `sunken`/`chip` are surfaces, `grid`/`axis`/`chart-shadow` are
decorative, and the three `*-mark` tokens are non-text graphics held to 3:1.

With that, **10 real failures remain, and 9 of them are in the light theme**:

| token | light | needs | painted as |
| --- | --- | --- | --- |
| `accent` | 3.08 | 4.5 | `text-accent` ×14 (buttons, badges, chart legends) |
| `accent-hover` | 3.94 | 4.5 | text |
| `accent-soft` | 1.77 | 4.5 | text |
| `accent-fg` | 3.22 on accent | 4.5 | text on the accent fill |
| `chart-2` | 3.77 | 4.5 | `text-chart-2` ×12 with 3/4 |
| `chart-3` | 2.80 | 4.5 | text |
| `chart-4` | 4.24 | 4.5 | text |
| `suspicious-mark` | 1.99 | 3.0 | `bg-`/`stroke-` chart marks |
| `border-strong` | 2.03 | 3.0 | control bounds |
| `border-strong` (dark) | 2.54 | 3.0 | control bounds |

These are not the gate being pedantic. `#ff5400` as body text on `#fafaf7` is genuinely hard
to read, and it is the brand accent, so it is on every primary button and link in light mode.

Fixing it is a palette decision, not a mechanical one — darkening `accent` to clear 4.5:1
changes the brand colour, and the alternative (reserve `accent` for fills, introduce a darker
`accent-ink` for text) means touching the 14 `text-accent` sites. Deliberately left for a human
call rather than silently recoloured. Dark mode passes everything except `border-strong`.
