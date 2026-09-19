# Performance — measured, not estimated

All figures below were measured on the development machine (Windows 11 laptop, Docker Desktop, TimescaleDB
2.30.1 on PostgreSQL 17.11, single detector process) by `python -m scripts.benchmark`
(`reports/performance_data.json`) and the replay CLI. They are single-machine observations, not capacity promises.
Targets from `plan.md` §6 are listed next to what was observed.

## Import

| Target | Observed |
|---|---|
| Full 180,800-row import < 5 min | **22.3 s** (batch 5,000; `scripts.import_dataset`), re-import 0 rows in < 1 s |

## Causal replay throughput (rules + features + facts + outbox, no ML)

| Target | Observed |
|---|---|
| ≥ 100 scored events/s sustained in accelerated replay | **215.6 events/s** over the whole file (180,800 events, 838.8 s wall, run `rules-only-full`) |

Per-event stage timings replayed over the last 300 events of that run:

| Stage | p50 | p95 |
|---|---|---|
| bounded window query (`processed_events`, run-scoped, 1 h span) | 0.92 ms | 1.21 ms |
| entity counter read (uncached, 3 keys) | 0.005 ms (cached) | 0.66 ms |
| feature vector (pure Python) | 0.033 ms | 0.047 ms |

The remainder of the ~4.6 ms/event budget is the per-event inserts (feature_snapshots, detections, processed_events,
run_events update) and per-batch commit. The second full replay with the model active ran concurrently with the test
suite and was slower (~100 events/s while tests competed for the database); its own timing is recorded in
`PROGRESS.md` once it completes.

## Events page query (the slow query the frontend review found)

Unfiltered newest-100 page for the 180,800-event run:

| Form | median (7 runs) |
|---|---|
| join detections ⋈ processed_events, then ORDER BY/LIMIT (original) | **79.7 ms** server-side (≈0.9 s end-to-end cold, as reported by the UI review) |
| LIMIT the detections page first (PK backward scan), then join | **2.9 ms** |

Plan before: parallel hash join with sequential scans of every hypertable chunk. Plan after: index scan backward on
`detections_pkey` + 100 index lookups. This is a real bug found during review, not injected.

## Tiger continuous aggregate vs raw GROUP BY (identical results asserted)

`processed_events_5m` (5-minute buckets per run/account) refreshed explicitly over the run's range (no wall-clock policy
— replay data is 2025/2026).

| Query | rows | raw GROUP BY | aggregate | identical |
|---|---|---|---|---|
| all 5-minute buckets for the run | 128,380 | 716 ms | 402 ms | ✓ |
| daily totals for the run (dashboard shape) | 243 | 72 ms | 37 ms | ✓ |

The aggregate is used only for charts; historical/as-of views and everything the detector touches use raw processed
records with a `run_seq` cutoff (test `test_a01_a02_aggregate_matches_raw_and_pinned_views_never_leak`).

## Not measured / not claimed

- p95 admission-to-verdict latency at 10 events/s live (no live source was available; the live path is exercised only
  by the ingestion tests).
- SSE visibility latency under load (verified functionally in the browser, not timed).
- Real Slack delivery latency, real LLM latency (no credentials).
