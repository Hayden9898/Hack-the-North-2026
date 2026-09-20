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
- `npm run check:contrast` parses `theme.css` and asserts WCAG AA. All tokens pass today
  (4.5:1 text, 3:1 for `fg-subtle` and `border-strong`). Run it if you add a colour.
- Verified: `/` and `/app` both 200, console renders, `typecheck && lint && build` green.
  Lint emits 5 pre-existing `only-export-components` fast-refresh warnings; oxlint exits 0.
- The shadcn CLI mis-resolved `@/` and installed an unrelated npm package called `cn`.
  Removed. If you run `shadcn add`, check what it writes — the root tsconfig now has
  `paths`, so it should behave.

**REQUEST to B:** none. Nothing blocks me on you.

**Next for me:** landing page design + the §8 rate-and-iterate loop. I will not touch your
six screens again.
