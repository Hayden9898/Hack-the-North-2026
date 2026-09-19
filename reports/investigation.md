# Dataset investigation — `htn_challenge_logs_2026.txt`

**Status of this document.** Everything below is an analyst finding computed from the imported evidence tables by
`python -m scripts.investigate` (raw output: `reports/investigation_data.json`). There is **no organizer-supplied
ground truth** in this dataset. Observations are labelled *observed*; interpretations are labelled *hypothesis* or
*unknown*. Account names and IPs identify recorded actors and sources, not the humans behind them. Line numbers refer
to the original file, one-based. Times are shown at the recorded `-0400` offset.

The March sequence was already known from the design handoff when this system was designed. It therefore informed the
rules and features; it is **not** a blind test of them.

## 1. Dataset identity and import verification (observed)

| Property | Value | How verified |
|---|---|---|
| SHA-256 | `9f773643335352d8aa8cc9f07c5f92614b65c806f84c84790f56e4c652970575` | `sha256_file` at import; matches spec |
| Lines / valid / rejected | 180,800 / 180,800 / 0 | `datasets` row after `import_dataset` |
| Time range (UTC) | 2025-08-01 12:00:57Z → 2026-03-31 22:00:26Z (08:00:57 → 18:00:26 at -04:00) | `min/max(event_time)` |
| Status counts | 200: 140,069 · 302: 34,506 · 403: 5,324 · 401: 899 · 500: 1 · 400: 1 | `GROUP BY status` |
| Accounts / distinct paths | 10 / 187 | `count(distinct username)`, path grouping |
| Ordering | strictly chronological; 2 exact-timestamp ties; 0 out-of-order rows | pre-import scan |
| Leading-zero IP | `10.0.9.05` (nicole_h, 18,164 events) preserved verbatim | `raw_events.ip_raw` |
| Import time (dev DB, this machine) | 22.3 s for 180,800 rows, batch 5,000 | `scripts.import_dataset` output |
| Re-import | inserts 0 rows (dataset already `ready`); partial import resumes from its checkpoint | `tests/integration/test_import.py` |

All 10 accounts use exactly one source IP for the entire eight months, with one exception: `sarah_j` has 17,942
events from `10.0.5.12` and **14 events from `10.0.8.45`**, the IP otherwise used only by `david_m` (18,021 events).

## 2. Anchor sequence, March 13–15 2026 (observed)

| Lines | Time (-0400) | Observed fact | Independent recount |
|---|---|---|---|
| 168311–168314 | Mar 13 23:10:19–23:10:32 | 4 × `POST /api/auth/login` → 401, sarah_j from 10.0.8.45 | burst scan: 4 in 13 s |
| 168321–168326 | Mar 14 22:11:26–22:11:39 | 6 × login 401, same pair | burst scan: 4 in 9 s at 168324, 6 total |
| 168330 | Mar 15 09:20:20 | david_m `POST /intranet/forum/new?topic=lunch_menu&payload=csrf_test` → **500** | one of only 2 non-{200,302,401,403} rows in the file |
| 168331 | Mar 15 09:42:35 | david_m `POST …/forum/new?topic=q1_updates&action=csrf_role_update` → **400** | the other one |
| 168332 | Mar 15 10:18:52 | david_m `POST …/forum/new?topic=parking_issues&script=success` → 302 | unusual key `script` |
| 168333 | Mar 15 10:18:55 | david_m `GET /intranet/forum/view/1042` → 200 | 3 s after the create; the create response does not name the created post |
| 168335 | Mar 15 11:07:56 | sarah_j (10.0.5.12) `GET /intranet/forum/view/1042` → 200 | |
| 168336 | Mar 15 11:07:57 | sarah_j `POST /api/admin/role_update` → 200, 85 bytes | **the only request to any `/api/admin/*` path in 180,800 rows** |
| 168337 | Mar 15 11:07:59 | sarah_j `GET /assets/avatar_1042.png` → 200 | |
| 168338 | Mar 15 11:26:59 | david_m `GET /finance/reports/q1_draft_CONFIDENTIAL.zip` → **200**, 8,459,200 bytes | **77 prior 403s** for david_m on this exact path, 0 prior 200s (causal loop **and** SQL recount agree) |
| 168339 | Mar 15 11:48:01 | david_m `POST /intranet/forum/edit/1042` → 302 | edit contents unavailable |
| 168343 | Mar 15 22:29:43 | sarah_j `POST /api/auth/login` → **200** from 10.0.8.45 | first and only success for this pair (1 × 200, 10 × 401) |
| 168344–168346 | Mar 15 22:29:45–22:33:40 | sarah_j (10.0.8.45) dashboard → confidential ZIP 200 (8,459,200 bytes) → logout | |

Query keys other than `topic` on `/intranet/forum/new` occur exactly three times in the dataset, all at lines
168330–168332. The words `csrf`, `script`, `success` are observed request text only; they do not establish that any
exploit executed.

## 3. Wider search beyond the known sequence (observed)

The following scans covered all accounts and all eight months, not just March.

- **Failed-login bursts (≥4 pair 401s in 60 s):** exactly two in the dataset, both `sarah_j@10.0.8.45` (above).
  Consecutive-401 run lengths for all pairs: 709 runs of 1, 73 of 2, 10 of 3, **1 of 4, 1 of 10**. No familiar pair
  ever exceeds 3 consecutive failures, so a threshold of 4 produces zero benign matches on this data. This is a
  data-driven observation, not proof the threshold generalises.
- **Sensitive-resource access changes (first 200 after ≥5 prior 403s, per account/path):** exactly one, line 168338.
- **Who is normally served each sensitive resource:** each heuristic-sensitive path has an established audience:
  `q1_draft_CONFIDENTIAL.zip` → nicole_h (1,532 × 200) and sarah_j (1,528 × 200); `budget_v2_CONFIDENTIAL.xlsx` →
  sarah_j; `directory_full_CONFIDENTIAL.csv` → michael_t; `board_deck.pptx` → nicole_h; `it/scripts/backup.sh` →
  amanda_l. Every other account receives 403 on these paths (47–80 denials each on the ZIP). david_m's single 200 is
  the only cross-audience success.
- **Response sizes are constant per path** (ZIP always 8,459,200 bytes; `budget_v2` always 45,120). Large byte counts
  are therefore routine for the ZIP's normal audience and carry no signal on their own (R01 in the acceptance matrix).
- **Admin endpoints:** one request total (line 168336).
- **Rare statuses:** 500 and 400 occur once each (lines 168330–168331).
- **Local-hour profile:** 08:00–18:59 carry ≈16,600 events per hour each; every other hour carries ≈30–50, except
  19:00 with 222. Both sarah_j@10.0.8.45 failure bursts (23:10, 22:11) and the later successful login (22:29) fall in
  the sparse off-hours band; david_m's forum/ZIP activity (09:20–11:48) does not.
- **Forum objects:** post 1042 is one of 81 forum objects and has 240 views (median per object ≈226). It was edited
  after line 168339 by matthew_r, amanda_l, jessica_w and nicole_h on later dates, exactly as other posts are; forum
  edits are routine (8,873 in the dataset). Only one admin request follows a forum view by the same account within
  60 s (168335 → 168336), and only one other account (david_m, line 168333) viewed that object in the preceding 60 min.
- **Rare account/IP pairs** (< 1 % of an account's traffic): only `sarah_j@10.0.8.45` (14 events, all listed above).

Nothing else in the dataset resembled these patterns. This does not mean the dataset contains no other incidents;
it means these scans found none, and the detector (rules + anomaly model) is the systematic follow-up.

## 4. Possible mechanisms (hypotheses, not findings)

1. **Possible forum-mediated request (unproven).** david_m posts with unusual parameters (500, 400, then 302), views
   post 1042 seconds later, and sarah_j — who normally has access to the finance ZIP — views 1042 and one second
   later issues the only admin `role_update` in the dataset. Consistent with content in a forum post causing a
   privileged request from the viewer's browser. **Not established:** the post's content, whether 1042 was created
   by line 168332, what `role_update` changed, or whether sarah_j's request was intentional.
2. **Possible privilege/access change (unproven).** 19 minutes after the admin request, david_m's 78th request for the
   ZIP returns 200 instead of 403. **Not established:** that the two events are causally linked, or that any role
   was actually mutated (no role-change contents in the logs). An authorised access grant would look identical.
3. **Possible account misuse (unproven).** Ten failed logins for sarah_j from david_m's IP over two nights, then a
   success and download of the same ZIP. **Not established:** session identity (no session IDs), who typed the
   credentials, or whether 10.0.8.45 is a shared workstation.

Templates such as "confirmed CSRF", "stolen credentials" or "exfiltration" are deliberately not available in this
product: the logs contain no request bodies, user agents, destinations or payloads that could support them.

## 5. Counterevidence and alternative explanations (observed where possible)

- sarah_j is part of the ZIP's normal audience (1,528 prior successes); her 22:30 download is unusual only in source
  IP and hour, not in resource.
- Off-hours activity, while sparse, does exist for every account (≈40 events/hour), so hour alone is weak evidence.
- Forum edits of 1042 by four other accounts afterwards are routine; the object itself is not anomalous.
- The byte counts are the normal size for the ZIP; there is no size anomaly.
- A legitimate, approved access change for david_m on Mar 15 would produce exactly the line-168338 pattern.

## 6. What cannot be established from this data (unknowns)

Destination hosts/ports, request bodies, user agents, session identifiers, the created post's id/content, the
`role_update` payload and target, whether any file left the network, and the identity of the person at any keyboard.

## 7. Evidence references

Every fact above resolves to `event_registry(dataset_id, line_number)` → `raw_events.raw_line`. Line 168338's
stored `raw_line`, status and byte count were asserted equal to the original file line in
`tests/integration/test_import.py::test_full_supplied_dataset_import_matches_overview`.
