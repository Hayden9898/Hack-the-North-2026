# Agent B — Console & Data Visualisation: status log

Append-only. One entry per push. Never edit `foundation-status.md`.

Format: `## <timestamp> — <headline>` then: what landed · what you need from Agent A · anything broken.

---

## Seeded by setup — brief ready, no work started

- Branch `hayden/frontend-console` cut from `hayden/frontend`.
- Brief: `docs/agents/README-agent-b-console.md`.
- Repo verified running: API + Vite + TimescaleDB up, dataset imported (180,800 rows, 0 rejects),
  86 backend tests green, `rules_only` mode (no model artifacts).
- **Blocked on:** Agent A's Phase 0 (Tailwind + shadcn + tokens + `/app` route migration).
- **Next while waiting:** read `api.ts` end to end, run `replay-demo`, audit IA of the six screens,
  evaluate charting libraries via the `dataviz` skill.

---

## 2026-09-19 21:58 EDT — Phase −1: grounding, IA audit, charting decision (no UI code yet)

**What landed:** no UI code. Agent A's Phase 0 is not pushed yet, so this is the §7 non-blocked
work: read `api.ts`, drive the real demo run, audit the IA of all six screens, pick a charting
library. Everything below is measured against the running system, not assumed.

### ⚠️ Coordination hazard found and fixed — Agent A please read

Both agents were working **in the same checkout** (`~/Desktop/Hack-the-North-2026`). When I ran
`git checkout hayden/frontend-console` there, it moved the *shared* `HEAD` onto my branch while
Agent A had ~8 files of uncommitted Phase 0 work in the tree (`src/styles/`, `src/lib/`,
`@/components/ui/`, `components.json`, modified `package.json` / `vite.config.ts` /
`tsconfig.app.json`, written seconds earlier). Agent A's next `git commit` would have landed
Phase 0 on `hayden/frontend-console`.

Resolved, no work lost:
- Restored `HEAD` in the main checkout to `hayden/frontend` — Agent A's tree is byte-for-byte as I
  found it (verified with `git status`; both refs were at `dadf8ef`, so no file contents changed).
- Moved myself to a dedicated worktree: **`~/Desktop/htn-console`** on `hayden/frontend-console`.

**Agent A: the main checkout is yours.** I will not run git commands there again. Two consequences:
- Your Vite dev server on `:5173` serves *your* tree. I will run mine on a different port so we
  don't fight over it.
- `frontend/package.json` will conflict between our branches (you add Tailwind/shadcn/motion, I add
  3 chart deps). I am keeping my dependency diff to exactly three lines to make that merge trivial.

### Demo fixture is live and complete

Run `5ffdaacd-f111-49a7-807d-149ae5b63441` resumed at speed 600 and ran to completion.

| | |
|---|---|
| state / processed | `completed` · 180,800 of 180,800 · cutoff_seq 180800 |
| warmup | normal 157,818 |
| visible | normal 22,975 · suspicious 5 · **high_risk 2** |
| incidents | **high_risk 2 · suspicious 1** |
| notifications | preview 5 · explanation_jobs done 3, superseded 5 |
| model | `rules_only`, `models.artifacts: []` — degraded, as expected |

All three demo incidents fired:

| incident_id | class | rules | account | evidence | versions |
|---|---|---|---|---|---|
| `5f675ad1-…05b4` | high_risk | R1→R4 | sarah_j @ 10.0.8.45 | 15 | v5 |
| `09c1b229-…db62` | high_risk | R2→R5 | david_m | **82** | v1 suspicious → v2 high_risk |
| `ad074f1e-…f641` | suspicious | R3 | sarah_j | 2 | v1 |

**The 77-denial proof works end to end** — fact `f_835847db3186ab94`, `prior_denials_count = 77`,
`cutoff_seq 168338`, query `account_path_status_count`, and the aggregate proof returns
`recomputed_count 77` vs `recorded_value 77` → **`matches_recorded: true`**, with `limit`/`offset`
paging over the rows and 78 exact `raw_line` evidence lines. That recompute-vs-recorded agreement
is the most persuasive single artifact in the product and the current UI renders it as a sub-heading
inside a drawer. It is getting the hero treatment.

**Tiger aggregate is live** and worth surfacing: `mode: aggregate_plus_raw_tail`,
`materialized_through 2026-03-31T22:00:00Z`, `materialized_buckets 16342`, `raw_tail_buckets 1`,
`stale: false`, plus `refreshed_at`. All three `TimeseriesSource` modes are renderable.

### §7.3 — IA audit: the one question each screen answers, and what competes with it

The rule I applied: name the single question, then list everything currently rendered at equal or
greater visual weight that answers a *different* question. Nothing below gets deleted — it gets
demoted behind a disclosure.

**1. `RunsPage` (291 lines) → `/app` — "Which run do I open?"**
Competing: three co-equal `Section`s — Runs, Datasets, New replay run. `DatasetCard` surfaces
import internals (`content_sha256`, `progress_line`, `progress_bytes`, `rejected_count`) which
answer "did ingestion work?", and `NewRunForm` is a full form. A judge's first screen is a form,
not the demo. → Demo run becomes one hero card (verdict counts + primary *Open console*); other
runs a compact list; dataset facts collapse to a one-line provenance strip
(180,800 rows · 0 rejects · sha `9f77…0575`); new-run form moves into a Dialog.

**2. `RunConsole` (779 lines) → `/app/runs/:runId` — "What is happening, and what needs me?"**
Competing: `RunHeader` is a 3-column slab holding 4 stat tiles + a **10-row** definition list +
a 2×5 counts table + integration tags + replay controls, all above any event. Then a `grid-2`
puts an 11-column, 300-row event table beside the incidents list, so the 3 incidents — the answer —
sit in a right-hand column at equal weight to 22,975 normal rows. `ActivityPanel` (the only chart
and the only freshness evidence) is third, below the fold.
→ Primary read: the incidents + the replay transport. Event feed is the evidence substrate,
secondary and virtualised. Provenance (`config_hash`, `feature_version`, `dataset_id`,
`visible_start`, `virtual_time`, integrations) is a real question — "is this reproducible?" — so it
becomes a **Run provenance** disclosure, not deleted.

**3. `IncidentPage` (1046 lines) — "What happened, how bad, and can you prove it?"** ← the big one
Competing: eight co-equal sections, two of them enormous and both fully expanded on load — an
**81-row** timeline table and a **92-item** fact panel. The actual answer (headline + qualifier) is
one line of text inside a header slab that also carries a version `<select>`, five badges and a
four-row definition list. Below: relations, explanation, playbooks (full step lists), baseline
histogram, delivery, feedback form — all the same size.

The decisive measurement, from the real packet on `09c1b229`:

| | count |
|---|---|
| total facts | **92** |
| `kind: event_observed` (raw rows) | **81** |
| derived facts (the actual argument) | **11** |
| `role: trigger` | **87** of 92 |

So `role` is useless for ranking — 87 of 92 are "trigger". **`kind` is the real discriminator.**
The panel currently renders 92 equal rows where 11 carry the reasoning and 81 are raw log rows
wearing the same chrome. That single fact is most of the "Bloomberg terminal" complaint.

**4. `EventPage` (227 lines) — "What was this line, and why was it classed that way?"**
Competing: `Features (v1)` and `Observed context at processing time` render raw dicts at the same
weight as the detector outcome. → Raw line + verdict + reason codes primary; features and observed
context into a **Model inputs** disclosure (they matter for reproducibility, not for the first read).

**5. `ActivityPanel` (349 lines, embedded) — "How did activity move, and is this chart trustworthy?"**
Competing: operator actions (`POST /analytics/refresh`, `/benchmark`) sit in the chart's header
next to the freshness badge, mixing "is this data fresh?" with "re-materialise it". It is also the
lowest thing on the page while holding the strongest sponsor evidence.
→ Promote the chart band; `FreshnessBadge` becomes a first-class provenance chip; refresh/benchmark
become an explicit operator affordance, visually separate.

**6. `NotFound` (11 lines)** — no question. Make it consistent and route back into `/app`.

### §7.1 — `api.ts` field → screen map (the gaps are the interesting part)

Read end to end (714 lines). Highlights of what is already served and currently under-used:

| Field / type | Where it belongs | Status today |
|---|---|---|
| `TimeseriesSource.mode` + `materialized_through` + `refreshed_at` + `stale` | Run console chart band | rendered small in `FreshnessBadge`; **promote** |
| `BenchmarkResponse.{raw_ms, aggregate_ms, identical_results}` | Operator drawer | fetched, barely shown — sponsor evidence |
| `Fact.provenance_hash`, `Fact.cutoff_seq`, `Fact.query` | Fact drawer header | present; the reproducibility claim |
| `AggregateProof.{recomputed_count, recorded_value, matches_recorded}` | **Hero of the fact drawer** | buried under an `<h3>` |
| `Packet.completeness.{rules_incomplete, listing_truncated, max_events}` | Evidence-strength band | rendered as tags |
| `EvidenceStrength.missing_evidence` + `Summary.unknowns` | "What we cannot establish" | present; must stay visibly separate from facts |
| `ValidatedExplanation.ai_review` / `ai_review_reason` | AI panel | **currently `"unavailable"` / `"no LLM provider configured (deterministic mode)"`** |
| `ValidatedExplanation.forced_inclusions` | AI panel | system-forced counterevidence — needs its own marker |
| `ValidatedExplanation.tool_log` | AI panel disclosure | read-only cutoff-bounded tool calls |
| `PlaybooksBlock.selected_by_ai` vs `.applicable` | Playbooks | **`applicable: 4`, `selected_by_ai: []`** — must be visibly different things |
| `Explanation.rejection_reasons` + `state: 'rejected'` | Rejected-AI state | **no natural fixture** — needs `inject_invalid_claim` |
| `Run.{block_reason, blocked_seq}` | Blocked run state | no natural fixture |
| `EventRow.processing_status` | Feed | drives `classTone`; must never read as a verdict |
| `Baseline.hour_histogram` | Incident baseline | 24 ordered buckets — a real chart |
| `Run.counts.late_events` / `Run.late_count` | Run header | processing state, not a verdict |

**No data gap found.** I am filing **no REQUEST against the backend.** Every number the redesign
needs is already served. Two *states* have no natural fixture in the demo run (`explanation.state
= rejected`, `run.state = blocked`); I will generate the first with the documented
`scripts.inject_invalid_claim` fault-injection run and design the second against the typed shape.

### §7.4 — Charting: decision and justification (`dataviz` skill invoked first, as required)

**Decision: hand-rolled SVG on `d3-scale` + `d3-shape` + `d3-array`, behind a thin adapter in
`src/components/charts/`. No charting framework.**

All five candidates resolve on the npmmirror registry, so availability did not decide it:

| Candidate | Mirror | Why not |
|---|---|---|
| Recharts 3.10.1 (11 deps) | ✅ | Ships its own tooltip/legend/animation. The `dataviz` mark specs (≤24px bars, 4px rounded data-end **square at the baseline**, 2px *surface-gap* separators, hairline **solid** grid, selective direct labels) mean overriding nearly all of its chrome. Animates by default — a `prefers-reduced-motion` liability. |
| Tremor 3.18.7 | ✅ | Built for **Tailwind v3** colour conventions (`color="blue"`); collides with Agent A's v4 `@theme` semantic tokens. Wraps Recharts anyway. Its house style is also squarely in the §6 slop bucket. |
| nivo 0.99.0 (12 deps) | ✅ | Heaviest; themes through a **JS object**, so it cannot read CSS custom properties — light/dark would need a re-render on theme toggle instead of being free. react-spring fights reduced-motion. |
| visx 4.0.0 | ✅ | Genuinely good and the closest call — but it is a *toolkit*, not a library: I'd install 5–6 `@visx/*` packages to get scales, axes, shapes, tooltip. That is d3 with a React tax. |
| **hand-rolled + d3 primitives** | ✅ | Chosen. |

Why it is right *for this app specifically*:

1. **Every colour must be a CSS custom property.** Verdict colour is product meaning, and it has to
   flip with Agent A's theme with zero JS. Writing the SVG myself means `fill="var(--color-high-risk)"`
   and light/dark is free. Every JS-themed library breaks this.
2. **`ActivityPanel.tsx` already hand-rolls its chart** and already has the `rollup()` adapter and
   `MAX_BUCKETS` guard. Hand-rolled is the incumbent here and it works; adding a framework would be
   a rewrite, not an upgrade.
3. **Bundle.** Measured baseline on this branch: **407.56 kB / 122.04 kB gzip**. `d3-scale` +
   `d3-shape` + `d3-array` are tree-shakeable and add single-digit kB; Recharts/nivo are ~100 kB+.
4. **The forms I need are simple.** Column, line, ranked bar, histogram, sparkline, a log-scale dot
   strip. None of these needs a chart engine — and see the form analysis below, where half of them
   turn out not to be charts at all.

The teammate may change the timeseries shape, so **all chart data access goes through one adapter
module** (`src/components/charts/timeseries.ts`) exposing a `Bin[]` contract. A backend shape change
is a one-file fix. I am porting the existing `rollup()`/`chooseBucketMinutes()` logic into it rather
than reinventing it.

**Palette discipline.** Per `dataviz`, my verdict colours are **status**, not categorical — they
mean good→critical, so they wear reserved status tokens and always ship **icon + label, never colour
alone**. That means the categorical six-check validator mostly does not apply; for the status and
processing-state tokens the correct check is **WCAG text contrast** (`contrast(a,b)`, 4.5:1). I have
the validator running under the repo's pinned node (`mise exec -- node …/validate_palette.js`) and
verified it executes; it runs for real the moment Agent A's token values land.

**Form choices — half of these are deliberately not charts** (`dataviz` form heuristic):

| Question | Form | Why |
|---|---|---|
| Events/min by verdict over the replay | **volume column in de-emphasis + verdict event markers** | Stacked-by-verdict is a *lie* at this ratio: 22,975 normal vs 5 suspicious vs 2 high-risk renders the coloured slivers sub-pixel. The rare verdicts are annotations, not a series. This is the `emphasis` form. |
| 401/403 rate per account | **ranked horizontal bars, faceted 401 \| 403, emphasis colouring** | 10 accounts exceeds the 8-hue ceiling, and the story is "two accounts stand out" → emphasise `sarah_j`/`david_m`, de-emphasise the rest. Two measures ⇒ two facets, **never** a dual axis. |
| March escalation window | **single-account line + annotated escalation points + cutoff marker** | The money chart for incident 1. |
| Response-byte distribution w/ 8.4 MB outlier | **stat tile + log-scale dot strip** | One outlier in 180,800 — a histogram's bins would be invisible. The number *is* the chart. |
| `baseline.hour_histogram` (24 buckets) | **single-hue column chart**, trigger hour emphasised | Hours are ordered, but bar length already encodes magnitude — colouring by value would double-encode (a named anti-pattern). One colour, no legend. |
| 180,800 / 0 rejects / 3 incidents / **77** | **KPI row + hero figure** | On `IncidentPage` the hero figure is **77**, ≥48px, sans, proportional figures, exactly one per view. |

Every chart ships a **table-view twin** and a crosshair/hover layer; filters live in **one row above**
everything they scope, never inside a chart card.

### §7.5 — `IncidentPage` decomposition plan

Target: `IncidentPage.tsx` becomes a ~150-line composition root over `src/components/console/incident/*`.
Nothing is deleted; everything moves behind one interaction.

```
IncidentPage (route shell, data fetch, version param)
├── IncidentVerdictBand      ← PRIMARY READ. class + headline + qualifier + account/ip + time span.
│                              Version selector and ids demoted to a provenance popover.
├── ProofRail                ← THE ARGUMENT. The 11 derived facts as claim cards, ranked by kind,
│   ├── ClaimCard              each with its value, its cutoff, and one "Show the evidence" action.
│   └── ObservedEventsGroup   ← the 81 `event_observed` facts collapse into ONE expander.
├── EvidenceDrawer           ← THE MONEY SHOT. Hero figure 77 · recomputed 77 = recorded 77 ✓
│                              · cutoff #168338 · provenance hash · paged raw log lines (mono, escaped).
├── UnknownsPanel            ← "What we cannot establish": `missing_evidence` + `unknowns`.
│                              Visibly separate from facts. Never styled as a finding.
└── Tabs / disclosures       ← Timeline (81 rows, virtualised) · Related episodes · AI explanation
                               · Playbooks · Baseline · Delivery · Analyst disposition
```

Three domain rules this layout enforces structurally, not by convention:
- **AI is a separate surface.** `explanation.state` is currently **`fallback`** with
  `ai_review: "unavailable"` and `hypotheses: []` because there is no LLM key. The AI panel renders
  that honestly as a degraded surface — it never borrows the authority of the fact rail, and
  `forced_inclusions` gets its own marker.
- **`applicable` ≠ `selected_by_ai`.** 4 playbooks apply by rule; the AI selected 0. Two different
  labels, never merged into one list.
- **Observed fact / AI suggested / unknown** get three distinct visual treatments, and unknowns are
  never rendered in a verdict colour.

### REQUESTs to Agent A

None blocking yet — Phase 0 covers all of it. Flagging three specifics early so the contract is
unambiguous when it lands:

- **R1 — processing-state tokens need a non-colour channel.** Invariant #6 says pending/late/blocked
  must not read as a verdict. Per `dataviz`, colour alone cannot carry that: status marks need
  **icon + label**, and the accessible backup channel is **texture at 45°/135°**. Please make
  `StatusChip` emit an icon + label for processing states, not just a colour, and expose a hatch/
  texture utility I can reuse on chart marks.
- **R2 — chart surface tokens.** The validator needs the exact light and dark *chart surface*
  values (the `--color-surface` a mark sits on) to check contrast. Also: the 2px "surface gap" and
  "surface ring" separators need that same colour as a token I can reference from SVG.
- **R3 — one de-emphasis hue.** The emphasis form is used in three charts; I need a neutral
  de-emphasis token that is clearly *not* `--color-normal` (de-emphasised ≠ a clean verdict).

### Next

Blocked on Phase 0 for anything visual. While waiting: port the timeseries adapter, build the
chart primitives against stubbed tokens, and generate the missing `rejected` / `blocked` fixtures.

---

## 2026-09-19 22:10 EDT — chart foundations, zero new dependencies

**What landed:** `frontend/src/components/charts/{timeseries,scale}.ts`. Data layer only — no UI,
still nothing that needs Agent A's tokens. `typecheck && lint && build` green; bundle unchanged at
**122.04 kB gzip**.

- **`timeseries.ts`** — the adapter seam the brief asked for. Nothing outside it imports
  `TimeseriesRow` / `TimeseriesSource`, so the teammate's Tiger work is a one-file change here.
  `describeFreshness()` flattens all three source modes into one descriptor so no chart branches on
  `mode`. Verified against the live API on all four query shapes; events/401s/403s/verdict counts
  and response bytes all conserve through the fold (180,800 events, 67,724,174,686 bytes), and the
  12,907-row grouped query folds to 200 bins in 4 ms.
- **`scale.ts`** — scales, UTC tick selection, axis labels. 45 assertions against the real
  magnitudes in this dataset.

**Charting decision revised — and it is now better than what I wrote at 21:58.** I had chosen
`d3-scale` + `d3-shape` + `d3-array`. Writing it, the only thing those buy is nice-tick selection,
and the cost is editing `frontend/package.json` — the one file guaranteed to conflict with your
Phase 0. So I hand-rolled it instead: **zero new dependencies, zero `package.json` diff, no merge
conflict with you at all.** The library comparison in the previous entry still stands as the reason
for "not a charting framework"; the d3 primitives just turned out not to earn their line either.

Two things the tests caught that are worth recording:
- `niceTicks(0, 22975)` tops out at 20000, so a caller passing a raw data maximum draws bars through
  the top gridline. Fixed by adding `axisTicks()`, which nices the domain first and guarantees the
  top tick equals the axis max.
- Response bytes need a **symlog** scale, not log: the dataset contains genuine zero-byte responses
  that a plain log scale cannot place. Symlog puts a 245-byte 403 body at 35% of the axis instead of
  0.0029%, which is what makes the 8.4 MB outlier legible as an outlier.

**Fixtures:** a second run `c5b39cd9` named `fault-injection` is warming, for the two states the
demo run cannot show — `explanation.state = rejected` and a live `running`/SSE-connected console.
The demo run is now `completed`, so it can never show a live transport state again. I did **not**
point `inject_invalid_claim` at the demo run: it does
`DELETE FROM explanations WHERE run_id=… AND version=…` and would have destroyed a real fallback
explanation in the primary fixture.

**Still blocked on Phase 0** for anything visual. Nothing I need from you has changed; R1–R3 in the
previous entry stand.

---

## 2026-09-19 22:12 EDT — chart token contract + the rejected-AI fixture exists

**What landed:** `frontend/src/components/charts/tokens.ts` — the only file in the chart layer that
names a colour. Every value is a `var(--…)` reference to your frozen §5 contract, so charts follow
the theme with no re-render and a rename is one edit. Also carries the fixed dataviz mark specs
(≤24px bars, 2px surface gap/ring, 1px solid grid, 10% area wash, 4px bar-end radius) as constants
rather than scattered magic numbers.

**Fault-injection fixture is live** — run `c5b39cd9` (`fault-injection`, so `isFaultRun()` tags it),
paused at Mar 23 with all 3 incidents and **Mar 23–31 still unplayed**, so it can be resumed slowly
later for live-transport screenshots. `inject_invalid_claim` was pointed explicitly at the R2/R5
77-denial incident `b16f0365`, not at the default target, so the rejected state can be designed
against the flagship evidence rail.

What the API now serves for `explanation.state = "rejected"`, and why it is the best AI-honesty
demo in the product:

- `model_name: "fault-injection-scripted"`, 5 `rejection_reasons` across 2 attempts.
- The AI tried to assert hypothesis `confirmed_credential_theft` — **precisely the "confirmed
  breach" language this product bans** — citing fact `f_fabricated000001`, which does not exist.
- The validator rejected both attempts. `hypotheses` came back `[]`; the fabricated fact ids never
  reach the UI.
- **The verdict did not move.** `incident.current_class` and `version.threat_class` are both still
  `high_risk`. That is invariant "AI cannot downgrade a detector verdict", observable on screen.
- The deterministic fallback still stands: `summary_fact_ids` has 6 real facts, and
  `ai_review_reason` reads *"AI proposal rejected by the validator; deterministic summary shown"*.
- `playbooks.applicable` is 4 while `selected_by_ai` is `[]` — the two lists stay different things.

Design consequence: `rejection_reasons` are raw validator strings
(`attempt 0: schema:('summary_fact_ids',):Value error, not a fact id: 'f_fabricated000001'`).
Those are developer-facing. The rejected panel will group them by attempt and lead with the
*category* of each rejection (fabricated fact id · unknown hypothesis code · altered packet hash ·
non-existent playbook), keeping the raw string available in mono underneath. Never the raw string
alone.

**Fixtures now covered:** `fallback` (demo run, all 3), `rejected` (fault run, `b16f0365`),
`rules_only` / degraded (both runs), `completed` (demo), `paused` (fault), plus `running` + SSE on
demand. Still without a natural fixture: `run.state = blocked`, which I will design against the
typed shape and the existing `block_reason` / `blocked_seq` fields.

---

## 2026-09-19 22:45 EDT — all six screens rebuilt on Phase 0; round 1 judging underway

**Unblocked by your Phase 0 — thank you, the contract was exactly what I needed.** `StatusChip`
with a discriminated union and a *structural* verdict-vs-processing difference (tinted fill vs
outline + hatch) answered my R1 before I filed it properly. I have not flattened it back to a hue
difference anywhere.

**Branch note:** I merged `origin/hayden/frontend-foundation` into my branch as a labelled
dependency merge (`chore(branch): take Agent A's Phase 0 as a dependency merge`). My screens import
your tokens and components, so Phase 0 has to be in my tree for typecheck/lint/build to pass.
Suggested resolution for the reviewer: **merge your PR into `hayden/frontend` first**, after which
my diff shows only console work. My `package.json` is byte-identical to yours — I added zero
dependencies, so the only merge artifact was `package-lock.json`, resolved in your favour.

### What landed

| Screen | Before | After |
|---|---|---|
| `IncidentPage.tsx` | 1046 lines, 8 co-equal sections | **207 lines**, composition root |
| `RunConsole.tsx` | 779 | 420, findings-first |
| `RunsPage.tsx` | 291 | rebuilt, form behind a dialog |
| `EventPage.tsx` | 227 | rebuilt, model inputs disclosed |
| `ActivityPanel.tsx` | 349 | rebuilt on the chart adapter |
| `NotFound.tsx` | 11 | rebuilt |

New: `components/console/**` (feed virtualiser, findings, transport, incident subtree) and
`components/charts/**` (adapter, scales, activity chart, freshness chip).

**The 77-denial flow now works as specified**: click the claim → drawer leads with the hero figure
**77**, then *"Recounted now, same answer — recomputed 77 = recorded 77"*, the cutoff it was counted
under (`run_seq ≤ 168,338`), the exact query, the provenance hash, and all 77 original log lines
paged 25 at a time. Exactly one hero figure per view: claims sit at 32px in the rail so opening one
reads as an escalation rather than a repetition.

### Two bugs worth your attention

**R4 — `src/lib/cn.ts` silently drops colour tokens (yours to fix; affects your components too).**
`twMerge` has no config for your custom `--text-*` size scale, so it groups `text-heading` with
`text-fg` as conflicting `text-*` utilities and keeps only the last one. In light mode this left
finding headlines at `rgb(170,182,198)` on a near-white card — roughly **2:1, well under AA** —
because `text-fg` was stripped and the heading inherited the legacy anchor colour. Confirmed by
reading computed styles in the browser: the rendered class list was
`mt-2.5 text-balance max-w-[54ch] text-heading`, no colour class at all.

It fails silently in both directions — when the colour comes last, the *size* token is dropped
instead. I fixed my five call sites by avoiding the conflict, but the real fix is registering your
text scale with `twMerge` in `cn.ts`. Any `cn('text-caption text-fg-muted', …)` in your own
components has the same latent bug.

**Not a bug, a heads-up:** your `defaultTheme` comment says dark is the default *because* my screens
were dark-only legacy CSS. That is no longer true — all six now use your tokens and render
correctly in light. `npm run check:contrast` passes. Changing the default is your call.

### REQUESTs still open

- **R2 / R3 — resolved by inspection, no action needed.** `--color-surface` and `--color-fg-subtle`
  cover the chart surface and de-emphasis needs. My charts reference them via one `tokens.ts` file.
- **R5 (backend teammate, not Agent A) — `GET /api/v1/runs` returns `counts: {}`.** The detail
  endpoint returns full `counts` (warmup/visible/incidents/notifications), the list endpoint does
  not. So the run list cannot show which run has findings without an N+1 fetch per run. I did
  **not** paper over it with N+1 calls — that would look fine with two runs and fall over with
  fifty, and it would hide the gap. The list renders honest cursor progress instead. The shape I
  need is the same `counts` object the detail endpoint already builds.

### Round 1 judging

Screenshots captured from the real demo run at 1440×900 and 390×844, dark and light, including the
open evidence drawer and the rejected-AI incident. Three independent judges (visual-craft,
usability/IA, anti-slop) are scoring the 8-dimension rubric now. Scores and the fixes they drive
land in the next entry.

---

## 2026-09-20 00:05 EDT — rate-and-iterate rounds 1–3, and REQUESTs R4–R7

Three judging rounds run, three independent judges each (visual-craft / usability-IA /
anti-slop), scoring the §8 rubric from real screenshots of the demo run at 1440×900 and 390×844
in both themes, including the open evidence drawer and the rejected-AI incident.

| round | hierarchy | type | spacing | contrast | motion | density | originality | craft | **mean** |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 6.67 | 7.33 | 6.33 | 4.67 | 7.0 | 7.67 | 7.67 | 5.67 | **6.63** |
| 2 | 7.0 | 7.33 | 6.33 | 5.33 | 7.0 | 7.33 | 8.0 | 5.67 | **6.75** |
| 3 | 7.0 | 7.67 | 7.0 | 6.33 | 7.0 | 7.33 | 8.33 | 6.67 | **7.17** |

Not at the 8.5 threshold. The judges have found something real every round, which is the point.

### The correction worth recording

In round 2 I reported "0 WCAG AA failures on five screens in both themes". **That was wrong**,
and the judges rejected it. My probe iterated *elements* and skipped any element with children,
which excluded every text node sitting beside a sibling element — including the header's
"API ready", whose span also holds the status dot. The probe now walks text nodes with a
TreeWalker, measures each via a Range, resolves colours through a canvas (string-parsing
`oklch()` silently produces fictional ratios) and composites alpha against the real painted
ancestor. Round 3 then caught a second gap: it measures **text only**, so WCAG 1.4.11 control
boundaries went unchecked and were sitting at 1.13–1.32:1 in dark.

Current measured state: **0 AA text failures on all five console screens in both themes**, and
every control I own moved to the strong border token.

### ⚠️ R8 — light mode was rendering as a dark slab (fixed here, in your file)

Scoping `index.css` to `.app` moved `background: var(--bg)` onto a real div with no competing
utility, and `--bg` is a hardcoded `#0e1116`. The whole console painted dark in **both** themes.
I confirmed it by sampling painted pixels rather than trusting the render: every point in the
light viewport came back `rgb(14,17,22)`.

I fixed it in `index.css` — the legacy surface/text/semantic variables now alias to your theme
tokens rather than pinning dark hexes, and the unconditional `:root { color-scheme: dark }` is
gone (it sat in the `legacy` layer and beat `theme.css`). Banner text was hardcoded cream that
only reads on a dark fill, so banner colours and borders are themed too.

**I know `index.css` is yours.** You invited edits to it as screens are converted, all six of
mine are, and shipping a console whose light theme is a dark slab was the worse trade. Please
review — if you would rather own the fix, revert my commit and replace it.

### Open REQUESTs

- **R4 — `src/lib/cn.ts`.** `twMerge` has no config for your custom `--text-*` size scale, so it
  treats `text-heading` and `text-fg` as conflicting and keeps only the last. It fails silently
  in both directions. I worked around it at five call sites; your components have the same
  latent bug.
- **R6 — `App.tsx` health chip.** `API {status}` renders on the legacy `.dot` chip; in light
  mode the label takes a theme foreground on the permanently dark header and measures ~1.01:1,
  so the connection state degrades to an unlabelled colour dot. Three judges flagged it
  independently. One-line fix: pin the label to the on-dark foreground.
- **R7 — `CodeBlock` line-number gutter** is a hardcoded `3.5ch`; a six-digit line number
  overruns it into the log text. I stopped using that branch and adopted your new `wrap` prop
  instead, which is better than the hack I had.
- **R5 (backend teammate) — `GET /api/v1/runs` returns `counts: {}`** while the detail endpoint
  returns full counts, and `notifications_sent` is 0 even for a run with 5 previews. So the run
  list cannot show which run has findings without an N+1 fetch. I did not fake it; the list
  shows honest cursor progress and the gap is stated in the PR.

### Thanks for the three cross-impact notes

Your `wrap` prop is a better answer than my arbitrary-variant hack — wrapping at spaces rather
than `break-all` keeps tokens whole, which matters for byte-exact evidence. Adopted. The
unified focus treatment shows up in my keyboard audit: 24 tab stops on the incident page, every
one with a visible ring.

