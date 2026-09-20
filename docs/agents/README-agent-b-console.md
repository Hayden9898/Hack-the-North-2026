# Agent B — Analyst Console & Data Visualisation

You are one of **two** agents rebuilding the WatchTower frontend. Read this entire file before
touching code. Your counterpart is **Agent A (Foundation & Landing)**; their brief is
`docs/agents/README-agent-a-foundation.md`. Read it too — you consume the design system they build.

**Your branch:** `hayden/frontend-console`
**Your one-line mission:** redesign the six console screens so a judge can go from "a run is
playing" to "here is why line 168338 is high risk, and here are the 77 denials that prove it" without
ever feeling like they're reading a Bloomberg terminal.

---

## 1. What WatchTower is

A **behavioral security investigation console** for HTTP access logs, built for Hack the North 2026
(CSE challenge). It ingests 180,800 real access-log lines spanning Aug 2025 – Mar 2026, replays them
in causal order, and flags events as **normal / suspicious / high risk** using five deterministic
rules (R1–R5) plus a frozen Isolation Forest. Matches are grouped into versioned **incidents** made
of typed, provable **facts** — every claim resolves back to exact raw log lines.

The differentiator is **reproducible explanation**: a judge can open any claim, see the original
evidence, replay the sequence, and get the same verdict. A constrained AI step may *select* facts and
qualified hypotheses, but a validator checks them before anything is shown — it cannot invent facts
or downgrade a detector verdict.

### The story your screens have to tell

Three incidents exist in the data, all in March 2026. **This is the demo, and it is your screens.**

| Incident | What happened | Rules |
|---|---|---|
| Unfamiliar-source login burst | `sarah_j` gets 10 login 401s from `10.0.8.45` (an IP that is not hers) over Mar 13–14, then a **successful** login from that same IP on Mar 15 followed by a confidential ZIP download | R1 → escalated to **high risk** by R4 at line 168345 |
| Admin transition | `sarah_j` views forum post 1042, then one second later makes a role-update POST returning 200 | R3, line 168336 |
| Access change | `david_m` receives a **200** for a confidential ZIP (8,459,200 bytes) after **77 previous 403s** for that exact account+resource | R2 → **high risk** via R5, line 168338 |

**The 77 denials are the money shot.** A judge clicks the fact "77 prior denials", and the evidence
drawer pages through all 77 original log lines under the same cutoff, proving the count. If one
screen in this app is perfect, make it that one.

### Domain rules your UI must respect (correctness, not taste)

- **Pending / late / blocked / failed are not "normal"** and must never render green or as a fourth
  threat class (architecture invariant #6). Use Agent A's processing-state tokens, never the verdict
  tokens.
- **Warmup vs visible phase:** warmup events are history being replayed to build state. They are not
  live model-evaluated decisions and must be visually distinguished from `visible` phase events.
- **Run isolation:** every screen, metric, query and chart is scoped to one `run_id` and to that
  run's processed cutoff. Future imported rows exist in the database but must never appear.
- **AI suggestions cannot change a verdict.** The UI must visibly separate **observed fact** /
  **AI suggested** / **unknown**. An AI "false positive" assessment is advisory and never suppresses
  or downgrades anything.
- **`model_health: "rules_only"`** is the current real state (no model artifacts on this machine).
  Render it honestly as a degraded mode — do not hide it, do not fake a model score.
- Never write "confirmed breach", "stolen credentials", "exfiltration", "99% accurate", or
  "production-ready". "High risk" means *urgently investigate*, not guilt.

---

## 2. State of the repo (verified, not assumed)

- **Branch base:** `hayden/frontend` (forked from `main` @ `7036445`). Your branch starts there.
- **Backend:** complete through M7. 86 tests pass (`-m "not slow"`). The API is rich and already
  exposes everything you need — see §4.
- **Database:** TimescaleDB 2.30.1 in Docker via **colima**, `localhost:5433`.
- **Dataset:** imported. 180,800 rows, 0 rejects, SHA-256 `9f773643…0575`, Aug 1 2025 → Mar 31 2026.
- **Model artifacts:** **absent**. App runs `rules_only`. All three incidents still fire. Do not try
  to train a model; it is out of scope.
- **Frontend today:** React 19 + Vite 8 + react-router 7, hand-rolled CSS. Your six screens:

| File | Lines | State |
|---|---|---|
| `src/pages/IncidentPage.tsx` | 1046 | The big one. Facts, timeline, evidence, explanation, playbooks, delivery |
| `src/pages/RunConsole.tsx` | 779 | Live feed, replay controls, charts, filters |
| `src/pages/ActivityPanel.tsx` | 349 | Activity stream |
| `src/pages/RunsPage.tsx` | 291 | Run list + create |
| `src/pages/EventPage.tsx` | 227 | Single event detail |
| `src/pages/NotFound.tsx` | 11 | — |

`IncidentPage.tsx` at 1046 lines is where the "Bloomberg terminal" complaint comes from. Expect to
decompose it.

### Known environment traps

| Trap | What you must do |
|---|---|
| **npm is blocked** | Zscaler firewalls `registry.npmjs.org`, and the corporate Nexus proxy in `~/.npmrc` 403s every public tarball. `frontend/.npmrc` already points at `registry.npmmirror.com` and works. **Always run npm from inside `frontend/`.** Never edit `~/.npmrc`. |
| **Node/Python versions** | Pinned by `mise.toml` (node 24.11.1, python 3.12.13). Prefix with `mise exec --` if a shim misbehaves. |
| **`ignore-scripts`** | Global npmrc sets it true, which breaks esbuild/rolldown. `frontend/.npmrc` overrides to false. Keep it. |
| **Reachable hosts** | `ui.shadcn.com` ✅, `kokonutui.com` ✅, `motion.dev` ✅, `registry.npmmirror.com` ✅. `registry.npmjs.org` ❌. |

### Environments & commands

| Thing | Where / how |
|---|---|
| UI (Vite dev) | `http://127.0.0.1:5173` |
| API | `http://127.0.0.1:8000` |
| API readiness | `GET /health/ready` — db, migrations, config hash, integrations, degraded modes |
| API liveness | `GET /health/live` |
| OpenAPI | `GET /api/v1/openapi.json` (**not** `/openapi.json`) |
| Database | `postgresql://logorder:logorder@localhost:5433/logorder` |
| Start everything | `.venv/bin/python tasks.py dev` |
| Frontend only | `cd frontend && npm run dev` |
| Backend tests | `.venv/bin/python tasks.py test ARGS="-m 'not slow'"` → 86 pass |
| Typecheck / lint / build | `cd frontend && npm run typecheck && npm run lint && npm run build` |
| **Demo run with incidents** | `.venv/bin/python tasks.py replay-demo` — warms Aug–Feb (~12–15 min), pauses at Mar 1. Open the run, set speed 600× (or 0 = fast-forward), Resume → the three March incidents appear. **This is your primary dev fixture.** |
| Fault-injection demo | `.venv/bin/python -m scripts.inject_invalid_claim --run-id <run>` — submits a fabricated AI proposal and shows the validator rejecting it (`explanation.state = rejected`). You must design this rejected state. |

---

## 3. Your scope

### You own

| Path | What |
|---|---|
| `frontend/src/pages/RunsPage.tsx` | Run list, run creation |
| `frontend/src/pages/RunConsole.tsx` | Live feed, replay controls, charts, filters |
| `frontend/src/pages/IncidentPage.tsx` | Incident detail — decompose it |
| `frontend/src/pages/EventPage.tsx` | Single event detail |
| `frontend/src/pages/ActivityPanel.tsx` | Activity stream |
| `frontend/src/pages/NotFound.tsx` | — |
| `frontend/src/components/console/**` (new) | Your decomposed console components |
| `frontend/src/components/charts/**` (new) | Charting layer |
| `frontend/src/api.ts`, `format.ts`, `useFetch.ts`, `useRunUpdates.ts` | Data layer |
| `docs/agents/console-status.md` | Your status log (see §7) |

### You do NOT own

`tailwind.config.*`, `src/styles/**`, `src/components/ui/**`, `src/lib/motion.ts`, `src/App.tsx`,
`src/main.tsx`, `index.html`, `src/index.css`, `src/pages/Landing/**` — all Agent A's. Do not add
your own design tokens, do not fork their components, do not touch routing.

Off-limits to **both** of you: `backend/app/{ingest,detection,incidents,investigation,notifications,workers,db}`,
`ml/`, `config/`, and all migrations. The detector and schema are done and tested — leave them alone.

### Backend permission: none

**You are frontend-only.** A teammate owns the Tiger Data and analytics work on the backend,
including `backend/app/api/analytics.py`, the `processed_events` continuous aggregate and its
refresh. Do not touch `backend/` at all — not additively, not "just one field". Their branch and
yours must not overlap.

If you hit a genuine data gap the API cannot serve:

1. Write a **REQUEST** line in `docs/agents/console-status.md` describing the exact shape you need.
2. Note it in your PR body so it reaches the reviewer.
3. Work around it in the frontend **without fabricating data**. Render an honest empty or
   "not available" state. This product's entire credibility rests on never showing a number it
   cannot prove — a placeholder figure is a correctness bug, not a stopgap.

Before you conclude something is missing, read §4. The API is unusually complete and the data you
want almost certainly already exists.

> **Heads-up on coupling:** the teammate's Tiger work may change the timeseries response shape. Your
> charts consume it. Keep chart data access behind a thin adapter in `src/components/charts/` so a
> backend shape change is a one-file fix, and flag the dependency in your status file.

## 4. The API you already have

`frontend/src/api.ts` is a **714-line fully-typed client**. Read it before writing any fetch code.
Typed surfaces already present include:

`ThreatClass` `Phase` `RunState` `ModelHealth` `ExplanationState` `DeliveryState` `Disposition`
`Health` `Integrations` `Run` `RunCounts` `RunCreateBody` `ReplayControlBody` `Dataset`
`EventRow` `EventsPage` `EventsQuery` `EventDetail` `Deviation` `Summary` `EvidenceStrength`
`IncidentCore` `IncidentRow` `IncidentsPage` `IncidentsQuery` `Fact` `FactQuery` `Packet`
`IncidentVersion` `IncidentVersionFull` `TimelineEntry` `Relation` `RuleMatch` `Hypothesis`
`HypothesisType` `ToolLogEntry` `ValidatedExplanation` `Playbook` `PlaybooksBlock`
**`TimeseriesRow` `TimeseriesQuery` `TimeseriesResponse` `TimeseriesSource`** `RefreshResponse`
`BenchmarkResponse` `Explanation` `ExplanationJob` `Delivery` `FeedbackRow`

Note `TimeseriesSource` — the backend already exposes the Tiger continuous aggregate **and** the raw
fallback, with a freshness watermark. Surfacing "this chart is served from the materialised
aggregate, refreshed at T" versus "falling back to raw" is a **sponsor-evidence win**. Design for it.

Key endpoints:

```
GET  /api/v1/runs                                        list
POST /api/v1/runs                                        create (replay or live)
GET  /api/v1/runs/{id}                                   cursor, phase, backlog, health
POST /api/v1/runs/{id}/replay                            start | pause | resume | speed
GET  /api/v1/runs/{id}/events                            cursor-paginated, under run cutoff
GET  /api/v1/runs/{id}/incidents                         paginated + filters
GET  /api/v1/runs/{id}/incidents/{incident}              versions, facts, timeline, relations,
                                                         explanation, playbooks, delivery
GET  /api/v1/runs/{id}/facts/{fact}                      exact evidence OR paginated aggregate proof
POST /api/v1/runs/{id}/incidents/{incident}/feedback     analyst disposition (append-only)
GET  /api/v1/runs/{id}/updates                           SSE, resumes from Last-Event-ID
GET  /health/live, /health/ready
```

`useRunUpdates.ts` already implements durable SSE with `Last-Event-ID` resume and a polling
fallback. Don't rewrite it; restyle what it drives.

---

## 5. Charting

You pick the library and **justify the choice in your status file**. The user named "BKlit UI" but no
package resolves under `bklit`, `bklit-ui`, or `@bklit/ui`, so this is your call.

Evaluate at least: **Recharts**, **visx**, **Tremor**, **nivo**, and hand-rolled SVG + Motion.
Criteria: installs through the mirror, works with Tailwind v4 tokens, supports the dark/light token
system, doesn't bloat the bundle, and can render a time-series with a **freshness watermark** and a
**verdict-coloured** overlay.

**Before writing a single line of chart code, invoke the `dataviz` skill.** It is mandatory here —
it covers palette construction, the form heuristic, mark specs, stat tiles, and accessible colour in
both themes. Your chart colours must come from Agent A's semantic tokens, not from a library default
palette.

Charts that earn their place: events/minute by verdict over the replay; 401/403 rate per account;
the March escalation window; response-byte distribution with the 8.4 MB outlier. Don't add a chart
that doesn't answer a question a judge would ask.

---

## 6. The visual bar

The current console is **"a Bloomberg terminal — very complex"**. That is the problem you are
solving. The fix is **not** deleting information — a security console that hides evidence is worse
than an ugly one. The fix is **progressive disclosure**: one confident primary read per screen, with
full depth exactly one interaction away.

Concretely, for `IncidentPage.tsx`: a judge should land on *what happened, how bad, and why* in one
glance. Facts, raw evidence, timeline, relations, AI explanation, playbooks and delivery state all
stay reachable — in drawers, tabs, and expandable regions rather than stacked in one 1046-line wall.

### References the user gave

- <https://polyyield.vercel.app/> — target for sleekness
- <https://v0.app/templates/pointer-ai-landing-page-XQxxv76lK5w>
- <https://v0.app/templates/v0-irl-event-landing-custom-3d-lanyard-IegtBb6qiEV>

Calibration, not templates. Copying them lands you in the slop bucket below.

### Explicitly banned — "AI slop" tells

The user specifically asked that this not look AI-generated. Each of these is a rubric deduction:

- Purple→blue or violet→pink gradient as the primary brand move
- Glassmorphism cards floating on a dark radial-gradient background
- Emoji used as icons or bullets
- Centered-hero → three-identical-cards → identical-CTA skeleton
- Default-weight Inter/Geist with no typographic contrast
- Gratuitous glow, blur, drop shadows on every surface
- Uniform grids where every card is the same size regardless of importance
- Vague hype copy
- The same border-radius on everything
- Perfect symmetry, zero editorial rhythm

### What to do instead

- Use Agent A's single accent deliberately; let the verdict colours carry the semantic load.
- Real typographic hierarchy; mono for all evidence, hashes, IDs and log lines.
- Density where the data earns it, whitespace where it doesn't.
- Motion that explains state change — layout transitions as events stream in, shared-element
  transitions from incident row → incident detail. Never decoration. Respect `prefers-reduced-motion`.
- **Design the unhappy states**: loading, empty, error, `rules_only`, `blocked` run, SSE
  disconnected, aggregate stale, rejected AI explanation. These are half the product's credibility
  and they are currently the weakest surfaces.
- Virtualise the event feed. 180,800 rows must never become 180,800 DOM nodes.

> **Security:** evidence text is untrusted and contains real script-like strings (`script=success`).
> Never `dangerouslySetInnerHTML` on log-derived data. Acceptance test S01 covers this.

---

## 7. Coordination with Agent A

### What Agent A is doing, and when it unblocks you

Agent A owns the **design system, app shell, routing, and the landing page at `/`**. Their Phase 0 —
Tailwind v4 + shadcn/ui + Motion.dev + the design tokens + the route migration — is a deliberate
early delivery so you are not blocked. They push it first, before doing any landing-page design.

**Their route migration moves your screens under `/app`:**

```
/                                   → Landing            (theirs)
/app                                → RunsPage           (yours)
/app/runs/:runId                    → RunConsole         (yours)
/app/runs/:runId/incidents/:id      → IncidentPage       (yours)
/app/runs/:runId/events/:seq        → EventPage          (yours)
/runs/*                             → redirect to /app/runs/*
```

Build any internal links against the `/app` paths from the start.

**Do while waiting for Phase 0** (all genuinely useful, none blocked):

1. Read `api.ts` end to end; map every field to the screen that should show it.
2. Run `replay-demo` and drive the real app — it's a 12–15 minute warm, start it now.
3. Audit the IA: for each of the six screens write down the *one* question it answers, and what is
   currently competing with that answer. This audit is the core of the anti-Bloomberg work.
4. Evaluate charting libraries; invoke the `dataviz` skill; write your justification.
5. Plan the `IncidentPage.tsx` decomposition.

### Status protocol

- **Your status file:** `docs/agents/console-status.md`. Append-only. Update it **every time you
  push**. Never edit A's file (`foundation-status.md`) — that guarantees zero conflicts.
- **Format each entry:** timestamp · what landed · what you need from A · anything you broke.
- **Read A's file before each work block:**
  ```bash
  git fetch origin
  git show origin/hayden/frontend-foundation:docs/agents/foundation-status.md
  ```
- If you need a component or token A hasn't shipped, write a **REQUEST** line in your status file,
  then **stub it locally and keep moving**. Never sit blocked.
- **No backend changes, by either of you.** A teammate owns the Tiger/analytics backend work, so
  both of your branches stay inside `frontend/` and `docs/agents/`. That makes conflicts between
  your two branches essentially limited to `frontend/src/` files neither of you owns — i.e. none.

---

## 8. The rate-and-iterate loop

The user's instruction: *keep iterating until it is genuinely visually pleasing, using subagents to
rate it.* This is your `/goal` — a persistence contract, not a single pass.

### Loop

1. Build or improve a screen.
2. Run it, navigate with the **claude-in-chrome** skill, capture screenshots at **1440×900 desktop**
   and **390×844 mobile**, in **both light and dark** themes. Capture the **real demo run with real
   incidents**, not an empty state.
3. Launch a **workflows** run with **3 independent judge subagents** per round. Give each the
   screenshots, the rubric below, and a *different* lens: one **visual-craft** judge, one
   **usability/IA** judge, one **anti-slop / originality** judge. Judges must not see each other's
   scores.
4. Collect scores, take the **lowest-scoring dimensions**, fix those specifically.
5. Repeat.

### Rubric — score each 0–10

| # | Dimension | What a 9–10 looks like |
|---|---|---|
| 1 | Visual hierarchy | Eye lands on the verdict and the reason first, every time |
| 2 | Typography | Deliberate scale, real weight contrast, mono for all evidence |
| 3 | Spacing & alignment | Strict 4/8 rhythm, optical alignment, nothing off-grid |
| 4 | Colour & contrast | Verdict colours semantically correct and ≥4.5:1; processing states never read as normal |
| 5 | Motion quality | Purposeful, ≤300ms, eased, reduced-motion respected, no decoration |
| 6 | Information density | **The anti-Bloomberg test.** Primary read in one glance, full depth one click away, nothing deleted |
| 7 | Originality (anti-slop) | None of the §6 banned tells; recognisable point of view |
| 8 | Craft & completeness | Loading, empty, error, degraded, blocked, disconnected and rejected-AI states all designed; focus rings; keyboard nav; responsive |

### Stop condition

**Mean ≥ 8.5/10 with no single dimension below 7**, or **6 rounds**, whichever comes first. If you
hit 6 rounds without the threshold, stop and report the scores honestly — do not keep burning
rounds, and do not inflate a score to exit.

Write the final scores and screenshots into your status file.

---

## 9. Git protocol — enforced

```bash
git fetch origin
git checkout hayden/frontend
git checkout -b hayden/frontend-console
git push -u origin hayden/frontend-console
```

**Incremental commits and pushes are a hard requirement, not a style note.**

- **Commit at every meaningful unit of progress.** One screen, one component, one state, one fix.
  A reviewer must be able to read your branch as a narrative. A single giant end-of-task commit is a
  failure of the task.
- **Push at least every 3 commits, and always before you stop working.** Your pushed branch is the
  only way Agent A can track you. An unpushed commit does not exist.
- **Conventional Commits, scoped:** `feat(console):`, `feat(charts):`, `refactor(incident):`,
  `fix(sse):`, `style(feed):`, `perf(feed):`, `docs(agents):`, `test(api):`, `chore(deps):`.
- Before every push: `npm run typecheck && npm run lint && npm run build` must pass.
  **Do not push red.**
- Never commit `node_modules/`, `dist/`, `.env`, or `htn_challenge_logs_2026.txt`.

### PR

When done, open a PR from `hayden/frontend-console` → **`hayden/frontend`** (the integration
branch). **Not to `main`.** Title `feat(frontend): analyst console redesign and data visualisation`.
Body: what changed, final rubric scores, screenshots, charting-library justification, and
anything left undone.

**Do not merge to `main`.** The user merges to `main` only on their explicit go.

### Handoff — you do NOT merge anything

Stop when your PR is open. **Do not merge your branch, do not merge your counterpart's branch into
yours, and do not touch `main`.**

The repo owner runs a separate **PR review agent** after both branches are finished. That agent
reviews both PRs, integrates them, and merges to `main` on the owner's explicit go. Your job ends at
a clean, reviewable, green PR.

To make that review cheap, your PR body must contain:

- What changed, screen by screen, with screenshots (light + dark, desktop + mobile)
- Final rubric scores per dimension, and how many rounds you ran
- Anything you deliberately left undone, and why
- Any **REQUEST** you filed that your counterpart or the backend teammate did not deliver
- Known conflicts you expect with the other branch, and your suggested resolution

Then report back and wait. Do not start new work after the PR is open unless asked.

---

## 10. Definition of done

- [ ] All six console screens rebuilt on Agent A's design system — no local design tokens
- [ ] `IncidentPage.tsx` decomposed; primary read in one glance, full evidence one interaction away
- [ ] The **77-denial evidence proof** is the best-designed flow in the app
- [ ] Charting library chosen, justified, and built on the shared tokens; `dataviz` skill invoked
- [ ] Tiger aggregate vs raw-fallback freshness surfaced in the UI (display only — the
      backend side belongs to the teammate)
- [ ] Event feed virtualised
- [ ] Processing states (pending/late/blocked) visually distinct from verdicts
- [ ] Warmup vs visible phase distinguished
- [ ] AI-suggested / observed-fact / unknown visibly separated; rejected-explanation state designed
- [ ] Unhappy states designed: loading, empty, error, `rules_only`, blocked, SSE disconnected, stale
- [ ] Light and dark, WCAG AA; responsive 390px and 1440px; reduced-motion honoured; keyboard navigable
- [ ] No banned §6 slop tells
- [ ] Rubric threshold met, or 6 rounds spent and scores reported honestly
- [ ] `npm run typecheck && npm run lint && npm run build` green
- [ ] `backend/` untouched (a teammate owns the Tiger/analytics work)
- [ ] Incremental commits throughout, pushed; status file current; PR open against `hayden/frontend`
- [ ] Nothing merged to `main`
