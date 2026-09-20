# Agent A — Design Foundation & Landing Page

You are one of **two** agents rebuilding the Log & Order frontend. Read this entire file before
touching code. Your counterpart is **Agent B (Console)**; their brief is
`docs/agents/README-agent-b-console.md`. Read it too — you are building the system they consume.

**Your branch:** `hayden/frontend-foundation`
**Your one-line mission:** own the design system and the judge-facing landing page at `/`, and ship
the Tailwind + shadcn foundation that Agent B builds the console on.

---

## 1. What Log & Order is

A **behavioral security investigation console** for HTTP access logs, built for Hack the North 2026
(CSE challenge). It ingests 180,800 real access-log lines spanning Aug 2025 – Mar 2026, replays them
in causal order, and flags events as **normal / suspicious / high risk** using five deterministic
rules (R1–R5) plus a frozen Isolation Forest. Matches are grouped into versioned **incidents** made
of typed, provable **facts** — every claim resolves back to exact raw log lines.

The differentiator is **reproducible explanation**: a judge can open any claim, see the original
evidence, replay the sequence, and get the same verdict. A constrained AI step may *select* facts and
qualified hypotheses, but a validator checks them before anything is shown — it cannot invent facts
or downgrade a detector verdict.

### The story the UI has to tell

Three incidents exist in the data, all in March 2026. This is the demo:

| Incident | What happened | Rules |
|---|---|---|
| Unfamiliar-source login burst | `sarah_j` gets 10 login 401s from `10.0.8.45` (an IP that is not hers) over Mar 13–14, then a **successful** login from that same IP on Mar 15 followed by a confidential ZIP download | R1 → escalated to **high risk** by R4 at line 168345 |
| Admin transition | `sarah_j` views forum post 1042, then one second later makes a role-update POST returning 200 | R3, line 168336 |
| Access change | `david_m` receives a **200** for a confidential ZIP (8,459,200 bytes) after **77 previous 403s** for that exact account+resource | R2 → **high risk** via R5, line 168338 |

The 77 prior denials are recomputable and pageable in the UI — that number is the single most
persuasive artifact in the whole product. Design for it.

### Language discipline (non-negotiable)

This product is deliberately honest about uncertainty, and the copy you write must match:

- "High risk" means **urgently investigate**, never established guilt.
- Account names and IPs identify **recorded actors and sources**, not humans.
- Never write "confirmed breach", "stolen credentials", "exfiltration", "99% accurate",
  "production-ready", or "hallucination-free".
- A successful login event does **not** prove session identity — there are no session IDs in the data.
- Numbers on the landing page must be real and verifiable (180,800 events, 0 rejects, 3 incidents,
  77 denials, 10 accounts). Do not invent metrics, testimonials, logos, or customers.

---

## 2. State of the repo (verified, not assumed)

Everything below was confirmed working on this machine before you started.

- **Branch base:** `hayden/frontend` (forked from `main` @ `7036445`). Your branch starts there.
- **Backend:** complete through milestone M7. 86 tests pass (`-m "not slow"`).
- **Database:** TimescaleDB 2.30.1 in Docker via **colima** (not Docker Desktop), `localhost:5433`.
- **Dataset:** imported. 180,800 rows, 0 rejects, SHA-256 `9f773643…0575`.
- **Model artifacts:** **absent** (`ml/artifacts/` is empty). The app runs in `rules_only` mode.
  All three incidents still fire — they come from rules, not the model. Do not "fix" this; training
  is a ~14 minute job outside your scope. The UI must render `model_health: "rules_only"` honestly.
- **Frontend today:** React 19 + Vite 8 + react-router 7, **hand-rolled CSS** (`src/index.css`, 889
  lines) and a small `src/ui.tsx`. No Tailwind, no component library. 5,088 lines total.

### Known environment traps

| Trap | What you must do |
|---|---|
| **npm is blocked** | Zscaler firewalls `registry.npmjs.org`, and the corporate Nexus proxy in `~/.npmrc` 403s every public tarball. `frontend/.npmrc` already points at `registry.npmmirror.com` and works. **Always run npm from inside `frontend/`** — elsewhere you get the broken global config. Never edit `~/.npmrc`. |
| **Node/Python versions** | Pinned by `mise.toml` (node 24.11.1, python 3.12.13). Prefix with `mise exec --` if a shim misbehaves. |
| **`ignore-scripts`** | The global npmrc sets `ignore-scripts=true`, which breaks esbuild/rolldown. `frontend/.npmrc` overrides it to `false`. Keep it. |
| **Lockfile noise** | npmmirror drops `libc` metadata fields from `package-lock.json`. Harmless, but review the lockfile diff before committing so it stays legible. |
| **Reachable hosts** | `ui.shadcn.com` ✅, `kokonutui.com` ✅, `motion.dev` ✅, `registry.npmmirror.com` ✅. `registry.npmjs.org` ❌. |

### Environments & commands

Run everything from the repo root unless stated. `make` targets also work as `python tasks.py <t>`.

| Thing | Where / how |
|---|---|
| UI (Vite dev) | `http://127.0.0.1:5173` |
| API | `http://127.0.0.1:8000` |
| API readiness (rich JSON) | `GET /health/ready` — db, migrations, config hash, integrations, degraded modes |
| API liveness | `GET /health/live` |
| OpenAPI | `GET /api/v1/openapi.json` (note the `/api/v1` prefix — **not** `/openapi.json`) |
| Database | `postgresql://logorder:logorder@localhost:5433/logorder` |
| Start everything | `.venv/bin/python tasks.py dev` (API + detector + side-effect worker + Vite) |
| Frontend only | `cd frontend && npm run dev` |
| Tests | `.venv/bin/python tasks.py test ARGS="-m 'not slow'"` → 86 pass |
| Typecheck / lint / build | `cd frontend && npm run typecheck && npm run lint && npm run build` |
| Demo run with incidents | `.venv/bin/python tasks.py replay-demo` (warms Aug–Feb, ~12–15 min, pauses at Mar 1; resume in the UI to see the three incidents) |

Integration status you will see and must render truthfully: `sentry: disabled_no_dsn`,
`llm: deterministic_only_no_key`, `slack: preview`, `no_model_artifacts_rules_only`.

---

## 3. Your scope

### You own

| Path | What |
|---|---|
| `frontend/tailwind.config.*`, `frontend/src/styles/**` | Tailwind v4 setup, `@theme` tokens, base layer |
| `frontend/src/components/ui/**` | shadcn/ui primitives + any Kokonut UI components you pull in |
| `frontend/src/lib/motion.ts`, `frontend/src/lib/cn.ts`, `frontend/src/lib/**` | Motion tokens, `cn()` helper, shared utilities |
| `frontend/src/pages/Landing/**` (new) | The judge-facing landing page at `/` |
| `frontend/src/App.tsx`, `frontend/src/main.tsx` | Shell + routing (see route migration below) |
| `frontend/index.html`, `frontend/public/**` | Document head, fonts, favicon, OG image |
| `frontend/src/index.css` | You migrate this to Tailwind; you may delete it once nothing imports it |
| `docs/agents/foundation-status.md` | Your status log (see §7) |
| `backend/app/api/summary.py` (new, optional) | Only if the landing page needs a public stats endpoint |

### You do NOT own

`frontend/src/pages/RunsPage.tsx`, `RunConsole.tsx`, `IncidentPage.tsx`, `EventPage.tsx`,
`ActivityPanel.tsx`, `NotFound.tsx`, `frontend/src/api.ts`, `format.ts`, `useFetch.ts`,
`useRunUpdates.ts` — those are Agent B's. Do not restyle them. Do not "helpfully" convert them to
Tailwind; that is B's job and you will collide.

Everything under `backend/app/{ingest,detection,incidents,investigation,notifications,workers,db}`,
`ml/`, `config/`, and all migrations are **off-limits to both of you**.

### Route migration (you own this, B depends on it)

Current routes are flat at `/`. Move the console under `/app` and put the landing page at `/`:

```
/                                   → Landing (yours, new)
/app                                → RunsPage        (B's component, your route wiring)
/app/runs/:runId                    → RunConsole
/app/runs/:runId/incidents/:id      → IncidentPage
/app/runs/:runId/events/:seq        → EventPage
/runs/*                             → redirect to /app/runs/* (keep old links alive)
*                                   → NotFound
```

Ship this route change in your **Phase 0** (below) so B can build against it immediately.

---

## 4. Phase 0 — unblock Agent B first (do this before anything else)

Agent B cannot start styling until the Tailwind/shadcn foundation exists. Your first commits are a
contract delivery, not a design exercise. Get this pushed within your first working block:

1. Install and configure **Tailwind CSS v4** (CSS-first `@theme`, not a JS config if avoidable).
2. Init **shadcn/ui** (`new-york` style, CSS variables on). Add the baseline primitives listed in §5.
3. Install **`motion`** (Motion.dev, v13.x — verified available on the mirror) and create
   `src/lib/motion.ts` exporting the motion tokens in §5.
4. Implement the **design tokens** in §5 with real values (your aesthetic call).
5. Apply the route migration in §3.
6. Leave every existing console page **visually untouched but still rendering** — import the old CSS
   scoped if you must. A broken console blocks B.
7. `git push` and write `docs/agents/foundation-status.md` saying Phase 0 is live, with the exact
   token names and component import paths you shipped.

Until Phase 0 lands, B works on non-blocking tasks. Every hour you delay is an hour B is idle.

---

## 5. The design contract (frozen — both agents code against these names)

You choose the **values**. The **names** are fixed so B can write code before you finish.

### Stack

- Tailwind CSS **v4** — CSS-first `@theme` block in `src/styles/theme.css`
- shadcn/ui — style `new-york`, components land in `src/components/ui/`
- **Motion.dev** — package `motion`, import from `motion/react`
- `lucide-react` for icons. **No emoji as UI icons, ever.**
- Fonts: your choice, but self-host or use a Zscaler-reachable CDN, and verify it loads offline-ish.

### Semantic color tokens

```
--color-bg               --color-fg
--color-surface          --color-fg-muted
--color-surface-raised   --color-fg-subtle
--color-border           --color-accent
--color-border-strong    --color-accent-fg
```

**Verdict colors** (the three threat classes — these carry product meaning):
```
--color-normal  --color-suspicious  --color-high-risk
```

**Processing-state colors** — `pending`, `late`, `blocked`:
```
--color-pending  --color-late  --color-blocked
```

> **Product invariant #6:** pending / late / blocked / failed records are **not** "normal" and must
> never read as green or as a fourth threat class. Give them a visually distinct treatment
> (hatching, outline, neutral-warm) that no one would mistake for a clean verdict. This is a
> correctness requirement, not a style preference.

All verdict and state colors must pass **WCAG AA (4.5:1)** against `--color-bg` and
`--color-surface`, in both themes. Verify with a contrast checker, don't eyeball it.

### Scale tokens

```
--radius-sm | --radius-md | --radius-lg | --radius-xl
--text-display | --text-title | --text-heading | --text-body | --text-caption | --text-mono
```

Spacing follows Tailwind's 4px base. Hold a strict 4/8 rhythm — no `13px` one-offs.

**Log lines, raw evidence, hashes, and IDs must render in `--text-mono`.** This is forensic data;
proportional type on a log line is a correctness smell.

### Motion tokens — `src/lib/motion.ts`

```ts
export const DUR  = { instant: 0.10, fast: 0.18, base: 0.26, slow: 0.42 }
export const EASE = {
  out:    [0.22, 1, 0.36, 1],
  inOut:  [0.65, 0, 0.35, 1],
  spring: { type: 'spring', stiffness: 400, damping: 34 },
}
```

Plus a `useReducedMotion()` re-export. **Every animation must respect
`prefers-reduced-motion`** — this is an accessibility requirement and a rubric line item.

### Components you must ship (B imports these by name)

`Button` `Card` `Badge` `StatusChip` `Tabs` `Sheet` `Dialog` `Tooltip` `Skeleton` `Separator`
`ScrollArea` `Table` primitives `Toast` `EmptyState` `ErrorState` `CodeBlock`

`StatusChip` takes a verdict or processing state and renders the correct semantic colour — B should
never hand-pick a verdict colour. `CodeBlock` renders mono, escaped, copy-able evidence text.

> **Security:** all evidence text is untrusted input and may contain HTML or script-like strings
> (there are real `script=success` query values in this dataset). Never `dangerouslySetInnerHTML`
> on anything derived from log data. Acceptance test S01 covers this.

---

## 6. The visual bar

The current console has been described as **"a Bloomberg terminal — very complex"**. That is the
problem you are solving. But the fix is *not* to strip information out; it is **progressive
disclosure**: a confident primary read, with depth one interaction away.

### References the user gave

- <https://polyyield.vercel.app/> — the target for sleekness
- <https://v0.app/templates/pointer-ai-landing-page-XQxxv76lK5w>
- <https://v0.app/templates/v0-irl-event-landing-custom-3d-lanyard-IegtBb6qiEV>

Treat these as *calibration*, not templates to clone. Copying them lands you in the slop bucket below.

### Explicitly banned — "AI slop" tells

The user specifically asked that this not look AI-generated. These are the tells. Each is a rubric
deduction:

- Purple→blue or violet→pink gradient as the primary brand move
- Glassmorphism cards floating on a dark radial-gradient background
- Emoji used as icons or bullets
- The centered-hero → three-identical-feature-cards → identical-CTA skeleton
- Default-weight Inter/Geist everywhere with no typographic contrast
- Gratuitous glow, blur, and drop shadows on every surface
- Uniform grids where every card is the same size regardless of importance
- Vague hype copy ("Supercharge your workflow", "AI-powered insights")
- Border-radius on everything at the same value
- Perfect symmetry, zero editorial rhythm

### What to do instead

- **One** confident accent colour against a restrained neutral base. Earn the colour.
- Real typographic hierarchy — meaningful jumps in size *and* weight *and* measure.
- Asymmetric, editorial layout. Let importance drive size.
- Whitespace with intent; density where the data earns it.
- Screenshots and numbers from the **actual running app**, not mockups.
- Motion that explains state change (layout transitions, shared elements), never decoration.

---

## 7. Coordination with Agent B

You are peers. Neither of you needs the other's approval, but you must stay legible to each other.

### What Agent B is doing

Agent B owns the **six console screens, the data layer, and charting** on branch
`hayden/frontend-console`:

| File | Lines | Their job |
|---|---|---|
| `src/pages/IncidentPage.tsx` | 1046 | Decompose it — this is the "Bloomberg terminal" complaint |
| `src/pages/RunConsole.tsx` | 779 | Live feed, replay controls, charts, filters |
| `src/pages/ActivityPanel.tsx` | 349 | Activity stream |
| `src/pages/RunsPage.tsx` | 291 | Run list + create |
| `src/pages/EventPage.tsx` | 227 | Single event detail |
| `src/api.ts` `format.ts` `useFetch.ts` `useRunUpdates.ts` | — | Data layer, SSE |

They also pick and justify a charting library (the user's "BKlit UI" does not resolve to a real
package), and may make **additive, tested** changes to `backend/app/api/analytics.py`.

**They are blocked on your Phase 0.** They cannot restyle anything until your tokens and components
exist. While waiting they audit information architecture, read `api.ts`, run `replay-demo`, and
evaluate chart libraries — but every hour your Phase 0 slips is an hour of their real work lost.
Ship it first, push it, and say so in your status file.

**They build against `/app` routes from day one**, so land your route migration in Phase 0 or their
internal links break.

### Status protocol

- **Your status file:** `docs/agents/foundation-status.md`. Append-only. Update it **every time you
  push**. Never edit B's file (`console-status.md`) — that guarantees zero conflicts.
- **Format each entry:** timestamp · what landed · what it unblocks for B · anything you broke.
- **Read B's file before each work block:**
  ```bash
  git fetch origin
  git show origin/hayden/frontend-console:docs/agents/console-status.md
  ```
- If B files a **REQUEST** line for a token or component you haven't shipped, treat it as high
  priority — they are stubbing around your absence, and every stub is future rework.
- **Known conflict point:** `backend/app/api/main.py` line ~52 registers routers from a tuple:
  `("datasets", "runs", "incidents", "updates", "analytics")`. If you add `summary.py`, append
  `"summary"`; B appends their own name if needed. Expect a one-line conflict and keep both entries.
- If you need something from B (a prop, a data shape, a component contract), write it in your status
  file as a **REQUEST** line. Don't block waiting — stub it and move on.

---

## 8. The rate-and-iterate loop

The user's instruction: *keep iterating until it is genuinely visually pleasing, using subagents to
rate it.* This is your `/goal` — a persistence contract, not a single pass.

### Loop

1. Build or improve a screen.
2. Run it (`npm run dev`), navigate with the **claude-in-chrome** skill, capture screenshots at
   **1440×900 desktop** and **390×844 mobile**, in **both light and dark** themes.
3. Launch a **workflows** run with **3 independent judge subagents** per round. Give each judge the
   screenshots, the rubric below, and a *different* lens: one **visual-craft** judge, one
   **usability/IA** judge, one **anti-slop / originality** judge. Judges must not see each other's
   scores.
4. Collect scores, take the **lowest-scoring dimensions**, fix those specifically.
5. Repeat.

### Rubric — score each 0–10

| # | Dimension | What a 9–10 looks like |
|---|---|---|
| 1 | Visual hierarchy | Eye lands on the right thing first, every time; clear primary/secondary/tertiary |
| 2 | Typography | Deliberate scale, real weight contrast, comfortable measure (45–75ch), mono for evidence |
| 3 | Spacing & alignment | Strict 4/8 rhythm, optical alignment, nothing accidentally off-grid |
| 4 | Colour & contrast | Restrained palette, one earned accent, all text ≥4.5:1, verdict colours semantically correct |
| 5 | Motion quality | Purposeful, ≤300ms, eased not linear, reduced-motion respected, no decoration |
| 6 | Information density | Progressive disclosure; dense where earned, never a wall; the anti-Bloomberg test |
| 7 | Originality (anti-slop) | None of the §6 banned tells; has a point of view someone could recognise |
| 8 | Craft & completeness | Loading, empty, and error states designed; focus rings; keyboard nav; responsive |

### Stop condition

**Mean ≥ 8.5/10 with no single dimension below 7**, or **6 rounds**, whichever comes first.
If you hit 6 rounds without the threshold, stop anyway and report the scores honestly — do not
keep burning rounds, and do not inflate the score to exit.

When you stop, write the final scores and the screenshots into your status file.

---

## 9. Git protocol — enforced

```bash
git fetch origin
git checkout hayden/frontend
git checkout -b hayden/frontend-foundation
git push -u origin hayden/frontend-foundation
```

**Incremental commits and pushes are a hard requirement, not a style note.**

- **Commit at every meaningful unit of progress.** One token set, one component, one section of the
  landing page, one fix. A reviewer must be able to read your branch as a narrative. A single giant
  end-of-task commit is a failure of the task.
- **Push at least every 3 commits, and always before you stop working.** Your pushed branch is the
  only way Agent B can track you — and Phase 0 is worthless to them until it is pushed. An unpushed
  commit does not exist.
- **Conventional Commits, scoped:** `feat(design):`, `feat(landing):`, `style(tokens):`,
  `refactor(shell):`, `fix(a11y):`, `docs(agents):`, `chore(deps):`, `test(ui):`.
- Before every push: `npm run typecheck && npm run lint && npm run build` must pass, and the console
  must still render. **Do not push red** — a red foundation branch blocks B completely.
- Never commit `node_modules/`, `dist/`, `.env`, or `htn_challenge_logs_2026.txt`.

### PR

When done, open a PR from `hayden/frontend-foundation` → **`hayden/frontend`** (the integration
branch). **Not to `main`.** Title `feat(frontend): design system foundation and landing page`.
Body: what changed, the final rubric scores, screenshots, and anything you left undone.

**Do not merge to `main`.** The user merges to `main` only on their explicit go.

### Final integration (whoever finishes second drives it)

Once both PRs exist and both are approved-in-spirit: merge both into `hayden/frontend`, resolve
conflicts with your counterpart, then verify the integrated app end to end — landing → console →
incident → evidence drawer, in both themes, typecheck + lint + build + the 86 backend tests green.
Report the result. Then stop and wait for the user.

---

## 10. Definition of done

- [ ] Tailwind v4 + shadcn/ui + Motion.dev installed and working; Phase 0 pushed early
- [ ] Every token and component in §5 shipped under the contract names
- [ ] Landing page at `/` that explains Log & Order to a judge in 30 seconds and links into `/app`
- [ ] Route migration done; old `/runs/*` links redirect
- [ ] Light and dark themes, both WCAG AA
- [ ] Responsive at 390px and 1440px
- [ ] `prefers-reduced-motion` honoured everywhere
- [ ] Keyboard navigable; visible focus rings
- [ ] No banned §6 slop tells
- [ ] Rubric threshold met, or 6 rounds spent and scores reported honestly
- [ ] `npm run typecheck && npm run lint && npm run build` green
- [ ] 86 backend tests still green
- [ ] Status file current; PR open against `hayden/frontend`; nothing merged to `main`
