# WatchTower / Log & Order — 2:35 recorded demo

This is a **click-and-narrate** script for a Devpost video. Record the screen and voice at the
same time, then use the timestamps to align or replace the voice-over in Cursorful. Do not wait
for animations or live replay during capture: each beat is a deliberate 1–3 second hold, except
the short fast-forward noted below.

## Truthful language to keep

- The supplied file is a **historical replay**, not a live attack.
- Say **suspicious**, **observed**, and **possible**; never say “confirmed breach,” “hacker,” or
  “exfiltration.”
- Slack and containment execution are in **preview mode** in this demo; no message or remediation
  request leaves the app.
- Sentry tracing and privacy-filtered structured logging are implemented. Do **not** say Sentry
  delivery is verified unless you have configured a real DSN and checked the events in Sentry.
- TimescaleDB is exercised locally. Do **not** say Tiger Cloud is deployed unless you have actually
  connected the configured deployment to it.

## Before pressing Record (not part of the video)

1. In one terminal start the app: `python tasks.py dev`.
2. Earlier—not while recording—prepare a fresh, paused demo run:

   ```bash
   python tasks.py replay-demo
   ```

   It causally warms August–February, then pauses at March 1. This takes roughly 12–15 minutes;
   leave it to finish before setting up Cursorful.
3. Open the `demo` run in a desktop browser at 100–110% zoom. Collapse the browser bookmarks bar,
   close DevTools, and use a 16:9 window. Make the terminal hidden before recording.
4. In the run console, set speed to **0 / fast-forward**. Keep the incident pages you will use in
   separate tabs if that makes navigation more reliable.
5. Optional, only if you want the AI-validator shot: while the run is still paused, copy its run id
   from the URL and run the following in a terminal **before recording**. Then reload the affected
   incident page once.

   ```bash
   python -m scripts.inject_invalid_claim --run-id <RUN_ID>
   ```

   This is deliberately labelled fault injection. Skip Beat 6 if it does not render cleanly; the
   rest of the demo is complete without it.

## Recording map

| Time | What to click / show | Say this |
| --- | --- | --- |
| 0:00–0:10 | Start on the run console header. Point at **historical replay**, the model/integration status, then the normal event feed. | “This is WatchTower: an evidence-first security investigation console for HTTP access logs. It replays events in causal order, so every finding uses only what was known at that moment.” |
| 0:10–0:22 | Press **Resume** at fast-forward. Let the feed advance briefly; pause once incidents appear, or use the suspicious filter. | “Instead of treating a filename or a large download as proof, WatchTower compares each event with its own prior history and groups related signals into incidents.” |
| 0:22–0:42 | Open the unfamiliar-source failed-login incident—R1, later escalated by R4. Show its headline, qualifier, and the facts/unknowns panel. | “Here, four failed logins from an unfamiliar source trigger R1. Notice the wording: these are attempts, not proof of who entered credentials. The console keeps the evidence and the unknowns together.” |
| 0:42–1:08 | Open the high-risk access-change incident, R2/R5. Open the fact for **77 prior denials**, then **Show evidence** / proof drawer. Keep it still for 2 seconds. | “The key event is an account’s seventy-eighth request for a confidential file becoming its first success after seventy-seven denials. The fact is not just a label: this proof recomputes the count from the recorded log lines.” |
| 1:08–1:24 | Show the related context or investigation brief. Point at the forum view and first admin request; show a qualifier/unknown. | “WatchTower links nearby context—such as a forum view and a first-time admin request—but it does not invent causality. An approved access change could look identical in an access log.” |
| 1:24–1:44 | Scroll to **Containment actions**. Open one action, then click **Dry run**. Show fact-bound parameters and the verification preview. Do not execute unless you have rehearsed it. | “When a response is appropriate, the action is bound by code from proven facts. We dry-run it first, show the exact parameters and verification query, and record every approval, execution, verification, and rollback step.” |
| 1:44–1:53 | Show **Response packet** and Slack status/preview, if visible. | “The response packet creates one handoff with evidence, unknowns, playbooks, and the action log. Slack is preview-only here, so nothing leaves the application during this replay.” |
| 1:53–2:08 | Go to **Execution Overview** / activity chart, open **Data and query details**, then **Measure query performance**. Hold on the raw versus aggregate results. | “For time-series analytics, we use TimescaleDB hypertables and continuous aggregates. On the full 180,800-event dataset, the aggregate returns identical results while reducing this five-minute query from 716 to 402 milliseconds.” |
| 2:08–2:20 | Return to the header/status or settings area that shows Sentry. Do not show a disabled badge as though it proves external telemetry. | “Sentry is instrumented across the React console, API, and workers for traces and privacy-filtered structured logs. Raw evidence, account names, IPs, request bodies, and AI prompts are excluded from telemetry.” |
| 2:20–2:31 | **Optional:** Open the injected incident’s AI assistance panel, showing **AI proposal rejected by validator** and its fault-injection label. | “Our AI review layer can select evidence, but it cannot invent a verdict. This labelled test submits an invalid proposal; the validator rejects it and the deterministic investigation remains unchanged.” |
| 2:31–2:35 | Return to the incident overview or response packet; hold still for the ending title. | “WatchTower turns logs into a reproducible investigation—and gives responders a safe, evidence-backed next step.” |

## Cursorful-friendly capture notes

- Record at 2:35–2:45. In editing, remove pauses between clicks and retain the narration timestamps above; this should
  finish close to 2:35.
- Use slow, direct cursor moves only at the start of each beat. Keep the pointer still while the viewer reads evidence.
- If one UI panel loads slowly, freeze that frame for the spoken line instead of recording a spinner. The spoken script
  does not rely on a particular animation completing.
- Do not show secrets, terminal output, raw API tokens, a real Sentry DSN, or a production Slack webhook.

## One-sentence fallback ending

If time is short, cut Beat 6 (AI) first, then shorten Beat 5 (containment). Keep Beats 3, 4, 7, and 8: they show the
CSE investigation, evidence proof, Tiger Data use, and Sentry privacy design.
