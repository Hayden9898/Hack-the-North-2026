# Versioned investigation brief

Open an incident's **Overview & timeline** tab. The brief uses deterministic facts already stored for the selected
evidence version. Each measured condition opens the same proof drawer as the Facts & evidence tab. Context and
counterevidence remain separately available; unknowns are not hidden behind an AI review. AI hypotheses and analyst
actions are in **Review & response**, leaving the overview focused on the evidence brief, timeline and baseline.

**Download evidence brief (.json)** creates a file locally in the browser. It does not call a provider or send a report
to a server. It includes sensitive account, IP, request, and dataset identifiers; share only with authorized reviewers.

## Export contract: `logorder.case-brief.v1`

- Selected incident/version, classification, trigger, and evidence cutoff.
- Source dataset ID/SHA-256 (null for live sources), source ID, configuration/reference hashes, feature version, model ID.
- Deterministic summary, evidence strength, complete stored fact packet and packet fingerprint.
- Version-bounded timeline and rule matches, plus explicit limitations.
- No mutable current disposition, analyst identity/review, notification delivery, AI proposal, later relationship state,
  or final per-event classifications that might combine rules from a later version at the same sequence.

The fingerprint covers the embedded packet, **not the entire export**. It is not a digital signature or proof that a
source is authentic. Raw log lines and freshly recomputed aggregate results are not bundled. Use the original
source and `/api/v1/runs/{run}/facts/{fact}?incident_id={incident}&version={version}` for those checks.
Missing packets disable download. `packet.completeness.listing_truncated` remains true if the packet listing was capped.

## Snapshot boundaries

`evidence_cutoff_seq` identifies the selected version's processing cutoff; `cutoff_seq` still identifies the current
execution's progress. A single event can create R2 version 1 and R5 version 2. Timeline memberships therefore require
both `run_seq <= evidence_cutoff_seq` and `added_version <= selected_version`; matches also require membership in
the selected version's rule set.

Related incidents show only relationships established by that cutoff. On an R3 incident whose last version predates
a subsequent R5 relationship, the relationship is intentionally absent. Open the later R2/R5 incident to inspect it.
Current disposition and the version chooser are operational metadata, explicitly separate from the evidence snapshot.
Reviews and deliveries shown for a version may have occurred later in wall-clock time, but never belong to a later
evidence version. The JSON brief excludes both, so they cannot be mistaken for contemporaneous evidence.

## Upgrade and verify

Run `python3 tasks.py migrate` before starting the updated API/detector. Migration **0004** adds relation creation
sequence and originating incident. Existing R5 links are recovered from their persisted matches in both directions;
unknown legacy provenance is not fabricated. No evidence tables or incident versions are deleted or rewritten.

Run `python3 tasks.py verify`. The regression in `tests/e2e/test_api_flows.py` checks same-event escalation isolation and
the legacy migration; `frontend/e2e/case-brief.spec.ts` checks the rendered brief and downloaded artifact.
