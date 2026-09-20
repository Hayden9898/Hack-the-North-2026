# CSE product review — September 19, 2026 (Toronto)

This is a source review of public snapshots, not an independently reproduced benchmark or a prediction of judging.
No competitor code, design assets, datasets, labels, or generated fixtures were incorporated into Log & Order.
Their projects may change after these commits. Local references were inspected without running their code.

## What deserves respect

| Project / snapshot | Observed in the implementation | Implication for our product |
| --- | --- | --- |
| [Minny — eedd030](https://github.com/Ch33zig/Minny/tree/eedd030ad2be6158745344ba69dc0d5fae6f702a) | Its [evaluation entry point](https://github.com/Ch33zig/Minny/blob/eedd030ad2be6158745344ba69dc0d5fae6f702a/eval.py) runs the actual detector on a background stream and independently injected variants. [Case-file tests](https://github.com/Ch33zig/Minny/blob/eedd030ad2be6158745344ba69dc0d5fae6f702a/tests/test_casefile.py) assert source-line findings and limitations. | Evidence narratives and stress testing are substantive strengths. Do not assume a polished console alone is enough. |
| [htn26 — 4ebcbe4](https://github.com/JeremyFriesenGitHub/htn26/tree/4ebcbe4af413ac8f123880997ab9aa3adfa76d33) | [Evaluation code](https://github.com/JeremyFriesenGitHub/htn26/blob/4ebcbe4af413ac8f123880997ab9aa3adfa76d33/bench/evaluate_final.py) includes synthetic-validation selection, several model families, thresholds, and bootstrap intervals. The [dashboard backend](https://github.com/JeremyFriesenGitHub/htn26/blob/4ebcbe4af413ac8f123880997ab9aa3adfa76d33/bench/dashboard.py) has strict upload parsing, model-availability checks, and an explicitly disclosed external LLM option. | Treat model-quality evaluation and straightforward ingestion as real competition. Do not describe it as only an offline notebook or claim our detector is more accurate. |

We did not reproduce either project's published detection rates, deployments, performance, or complete UI flows.
Code describing a one-shot evaluation cannot by itself establish the experiment's full history.
Different analyst label sets (our provisional 20-line inventory, htn26's 22, Minny's 26-line removal set), event versus
incident metrics, and detector objectives make headline scores non-comparable. None of those labels becomes organizer
ground truth by appearing in a repository. Our March sequence informed our rules; it remains **not a blind holdout**.

## The product standard we should demonstrate

The [CSE challenge](https://hackthenorth2026.devpost.com/) asks for who, what, when, and how, plus detection as logs arrive.
Our positioning is an operational investigation console: **observe → explain → verify → review**, with uncertainty intact.

1. **Explain in one screen.** A version-pinned brief identifies the recorded account, trigger request, source line, time,
   measured conditions, and unresolved questions. It must not equate an account with a human attacker.
2. **Let the judge challenge a claim.** One click opens exact evidence or a recomputable aggregate. Demonstrate the
   original 77-denial proof only with the original dataset, not with synthetic UI fixtures.
3. **Preserve what was known.** Change versions and show R2 before its R5 escalation, even when both share the same
   event sequence. Later evidence memberships, rules, and relationships cannot leak into the earlier snapshot.
4. **Hand off an auditable artifact.** Download a local JSON brief with source/config/model provenance, the immutable
   fact packet and its fingerprint. The fingerprint is not a signature, and the export is not a complete raw-log archive.
5. **Show operational resilience.** Pause/resume, worker recovery, late events, rejected AI proposals, and preview versus
   actual notification delivery must remain explicit. Existing integration tests cover these mechanisms; a live demo
   must establish the actual deployment behavior.
6. **Make observability useful.** Show a received trace and structured log that helped diagnose a real issue. An installed
   SDK, a queued diagnostic, or authenticated MCP alone does not satisfy that demonstration.

## Changes made from this review

- Added an investigation brief with direct proof links and clearly separated unknowns/context.
- Added confidential, local, version-pinned JSON export. Excludes AI proposals, reviewer identity, mutable dispositions,
  deliveries, and current related-incident state. Missing packets disable export; truncation remains explicit.
- Fixed evidence-version isolation in the API: membership version **and** processing sequence, version rule set,
  and relationship-creation provenance. Migration `0004` backfills old R5 relationships from persisted matches;
  unresolvable legacy links are withheld from as-of views rather than assigned invented dates.
- Added a real-database regression for same-sequence R2/R5 versions, later R4 matches, reverse relationships,
  versioned reviews, and the migration's legacy backfill. Added browser checks for proof navigation, download contents,
  keyboard focus, accessibility, mobile layout, reduced motion, missing/truncated packets, and inert untrusted text.

This does **not** add a new model or expand detection claims. It improves the reliability and legibility of our existing system.

## Gaps that remain material

- The original 180,800-event source and frozen model are absent on this machine. Historical results are documented,
  but current canonical replay acceptance remains blocked. Resolve this before a competition-quality demo.
- Persistent local Docker storage is full; the isolated temporary test database is not a production database.
- Real Sentry receipt still needs the user's organization/project choice and DSNs. Manus deployment, authenticated
  access to evidence, durable workers/storage, and live-source latency are not verified.
- Broader independent scenario evaluation and analyst-reviewed benign controls would strengthen generality claims.
  Our renamed/date-shifted synthetic tests establish specific invariants, not broad adversarial superiority.

Do not add a model zoo, copy a competitor's red-team generator, or invent impressive statistics to close these gaps.
The strongest next investment is a complete, truthful live demonstration with repeatable evidence.
