"""Ordered detector: one owner per run, one transaction per bounded microbatch (architecture.md §5).

Per event: lock run → read next contiguous run_seq → prior stats + bounded history → features → model score (if any)
→ independent rules → policy → incidents/facts/outbox → detection + processed_events → stats → cursor + ui update →
commit. Failure rolls everything back; bounded retries then a visibly blocked run.
"""
from __future__ import annotations

import logging
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

import psycopg

from app.config import DetectionConfig, get_config
from app.db.engine import connect_direct, jsonb
from app.detection import policy
from app.detection.model import LoadedModel, ModelLoadError, load_model
from app.detection.rules import RuleContext, evaluate_rules
from app.features import history
from app.features.events import Event
from app.features.history import StatsStore, window_counts
from app.features.reference import Reference
from app.features.vector import FEATURE_NAMES, FEATURE_VERSION, compute_features
from app.incidents.correlate import apply_matches
from app.notifications import outbox
from app.observability import sentry
from app.settings import get_settings
from app.workers import runs as runs_mod

log = logging.getLogger("logorder.detector")

FaultHook = Callable[[str, Event | None], None]  # (stage, event) -> may raise; used only by tests


class PoisonRecord(RuntimeError):
    """A failure raised while processing ONE event, carrying that event's run_seq so the blame (attempt counter,
    `failed` state, blocked_seq) lands on the poison record instead of on the first event of its microbatch."""

    def __init__(self, seq: int, cause: BaseException) -> None:
        super().__init__(f"run_seq {seq}: {type(cause).__name__}: {str(cause)[:500]}")
        self.seq = seq
        self.cause = cause


@dataclass
class BatchResult:
    processed: int = 0
    last_seq: int = 0
    classes: dict[str, int] = field(default_factory=dict)
    incidents: list[dict[str, Any]] = field(default_factory=list)
    duration_ms: float = 0.0


@dataclass
class RunModel:
    model: LoadedModel | None
    health: str  # active | rules_only | degraded | shadow
    detail: str = ""


@dataclass
class _WriteBuffers:
    feature_snapshots: list[tuple[Any, ...]] = field(default_factory=list)
    detections: list[tuple[Any, ...]] = field(default_factory=list)
    processed_seqs: list[int] = field(default_factory=list)


class Detector:
    def __init__(self, database_url: str | None = None, cfg: DetectionConfig | None = None, fault_hook: FaultHook | None = None) -> None:
        self.settings = get_settings()
        self.database_url = database_url or self.settings.database_url
        self.cfg = cfg or get_config()
        history.configure(tuple(sorted(self.cfg.routes.categories.get("login_families", frozenset()))))
        self.fault_hook = fault_hook
        self._models: dict[str, RunModel] = {}
        self._references: dict[str, Reference] = {}

    # ---------------------------------------------------------------------------------------------- model / reference

    def _run_model(self, conn: psycopg.Connection[Any], run: dict[str, Any]) -> RunModel:
        rid = run["run_id"]
        rm = self._models.get(rid)
        if rm is None:
            rm = self._load_run_model(conn, run)
            self._models[rid] = rm
        # Reconcile the persisted health on EVERY batch, not only on the cache miss: the run row is re-read (and
        # locked) per batch, and if the batch that loaded the model rolled back, the cache keeps the model while the
        # UPDATE was lost — `pending_load` would otherwise stay forever.
        if run.get("model_health") != rm.health:
            with conn.cursor() as cur:
                cur.execute("UPDATE runs SET model_health=%s, updated_at=now() WHERE run_id=%s", (rm.health, rid))
        return rm

    def _load_run_model(self, conn: psycopg.Connection[Any], run: dict[str, Any]) -> RunModel:
        rid = run["run_id"]
        if not run.get("model_id"):
            return RunModel(None, "rules_only", "no model configured for this run")
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM models WHERE model_id=%s", (run["model_id"],))
            mrow = cur.fetchone()
        try:
            if mrow is None:
                raise ModelLoadError("model row missing")
            m = load_model(self.settings.model_dir, run["model_id"], expected_sha256=mrow["artifact_sha256"],
                           expected_reference_hash=(run["config"] or {}).get("reference_hash"), cfg=self.cfg)
            # Only an `active` registration may classify; candidate/shadow/rejected models are scored for visibility
            # but never contribute to the threat class.
            return RunModel(m, "active" if mrow["status"] == "active" else "shadow", f"loaded {m.artifact_sha256[:12]}")
        except (ModelLoadError, OSError, ValueError) as exc:
            sentry.log_event("model_degraded", "warning", run_id=rid, reason=str(exc)[:200])
            return RunModel(None, "degraded", f"{type(exc).__name__}: {exc}")

    def _reference(self, run: dict[str, Any]) -> Reference:
        rid = run["run_id"]
        if rid not in self._references:
            self._references[rid] = Reference.from_dict((run["config"] or {}).get("reference") or {})
        return self._references[rid]

    # ---------------------------------------------------------------------------------------------- batch processing

    def process_batch(self, conn: psycopg.Connection[Any], run_id: str, batch_size: int | None = None) -> BatchResult:
        """Process up to `batch_size` admitted events in ONE transaction. Caller owns commit/rollback."""
        t0 = time.perf_counter()
        batch_size = batch_size or int(self.cfg.policy["replay"]["microbatch"])
        result = BatchResult()
        run = runs_mod.get_run(conn, run_id, lock=True)
        if run is None or run["state"] in ("created", "completed", "blocked"):
            return result
        rm = self._run_model(conn, run)
        ref = self._reference(run)
        with conn.cursor() as cur:
            cur.execute(
                """SELECT re.run_seq, re.event_id, re.event_time, re.phase, re.attempts, r.username, r.ip_raw, r.method, r.path, r.raw_target,
                          r.query_keys, r.route_family, r.object_id, r.status, r.response_bytes, r.offset_minutes, r.raw_line, e.line_number
                   FROM run_events re
                   JOIN raw_events r ON r.event_id = re.event_id AND r.event_time = re.event_time
                   LEFT JOIN event_registry e ON e.event_id = re.event_id
                   WHERE re.run_id = %s AND re.run_seq > %s AND re.run_seq <= %s AND re.processing_state = 'admitted'
                   ORDER BY re.run_seq""",
                (run_id, int(run["processed_seq"]), int(run["processed_seq"]) + batch_size),
            )
            rows = [dict(r) for r in cur.fetchall()]
        if not rows:
            return result
        expected = int(run["processed_seq"]) + 1
        for r in rows:
            if int(r["run_seq"]) != expected:
                raise RuntimeError(f"non-contiguous run_seq: expected {expected} got {r['run_seq']}")
            expected += 1
        stats = StatsStore(conn, run_id)
        trace = sentry.current_trace_context()
        last_time: datetime | None = None
        buffers = _WriteBuffers()
        with sentry.span("detector.batch", run_id=run_id, size=len(rows)):
            for row in rows:
                ev = Event.from_row(row)
                try:
                    self._process_event(conn, run, rm, ref, stats, ev, result, trace, buffers)
                except (PoisonRecord, psycopg.OperationalError):
                    raise  # connection loss is not the record's fault; the caller reconnects
                except Exception as exc:
                    raise PoisonRecord(int(ev.run_seq), exc) from exc
                last_time = ev.event_time
            with conn.cursor() as cur:
                if buffers.feature_snapshots:
                    cur.executemany(
                        """INSERT INTO feature_snapshots (run_id, run_seq, event_id, event_time, feature_version, history_count, numeric_vector, observed_context, reference_hash)
                           VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                        buffers.feature_snapshots,
                    )
                if buffers.detections:
                    cur.executemany(
                        """INSERT INTO detections (run_id, run_seq, event_id, event_time, phase, threat_class, processing_status, model_id, model_health,
                               model_score, anomaly_percentile, model_flagged, reason_codes, rule_ids, top_deviations)
                           VALUES (%s, %s, %s, %s, %s, %s, 'processed', %s, %s, %s, %s, %s, %s, %s, %s)""",
                        buffers.detections,
                    )
                if buffers.processed_seqs:
                    cur.execute(
                        "UPDATE run_events SET processing_state='processed', processed_at=now() WHERE run_id=%s AND run_seq = ANY(%s)",
                        (run_id, buffers.processed_seqs),
                    )
            stats.flush()
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE runs SET processed_seq=%s, last_processed_time=%s, updated_at=now() WHERE run_id=%s",
                    (result.last_seq, last_time, run_id),
                )
                if run["phase"] == "visible":
                    outbox.promote_ready(conn, run_id, last_time, live=(run["mode"] == "live"))
                payload = {
                    "processed_seq": result.last_seq,
                    "admitted_seq": int(run["admitted_seq"]),
                    "last_event_time": last_time.isoformat() if last_time else None,
                    "phase": run["phase"],
                    "state": run["state"],
                    "batch_classes": result.classes,
                    "model_health": rm.health,
                    "incidents": [{k: v for k, v in i.items() if k != "summary"} for i in result.incidents],
                }
                cur.execute(
                    "INSERT INTO ui_updates (run_id, update_seq, type, payload) VALUES (%s, %s, 'progress', %s)",
                    (run_id, outbox.next_update_seq(conn, run_id), jsonb(payload)),
                )
        if self.fault_hook:
            self.fault_hook("before_commit", None)
        result.duration_ms = (time.perf_counter() - t0) * 1000
        return result

    def _process_event(
        self,
        conn: psycopg.Connection[Any],
        run: dict[str, Any],
        rm: RunModel,
        ref: Reference,
        stats: StatsStore,
        ev: Event,
        result: BatchResult,
        trace: dict[str, Any] | None,
        buffers: _WriteBuffers,
    ) -> None:
        run_id = run["run_id"]
        if self.fault_hook:
            self.fault_hook("event", ev)
        windows = self.cfg.policy["features"]["windows_seconds"]
        with sentry.span("features", run_seq=ev.run_seq):
            win = window_counts(conn, run_id, ev, windows, int(self.cfg.policy["rules"]["R1"]["window_seconds"]))
            acct = stats.get("account", ev.username)
            pair = stats.get("pair", ev.pair_key)
            ap = stats.get("account_path", ev.account_path_key)
            fr = compute_features(ev, win, acct, pair, ap, ref, self.cfg)
        score: float | None = None
        pct: float | None = None
        threshold: float | None = None
        if rm.model is not None:
            with sentry.span("model.score"):
                try:
                    score = rm.model.score(fr.vector)
                    pct = rm.model.percentile(score)
                    threshold = rm.model.threshold if rm.health == "active" else None  # shadow: scored, never classifies
                except Exception as exc:  # noqa: BLE001 - degrade visibly, keep rules
                    rm.model, rm.health, rm.detail = None, "degraded", f"scoring failed: {type(exc).__name__}"
                    sentry.log_event("model_degraded", "warning", run_id=run_id, reason=rm.detail)
                    with conn.cursor() as cur:
                        cur.execute("UPDATE runs SET model_health='degraded', updated_at=now() WHERE run_id=%s", (run_id,))
        with sentry.span("rules.evaluate"):
            ctx = RuleContext(conn=conn, run_id=run_id, ev=ev, win=win, stats=stats, ref=ref, cfg=self.cfg)
            matches = evaluate_rules(ctx)
        decision = policy.classify(matches, score, threshold)
        side_effects = ev.phase == "visible"
        with sentry.span("correlate", matches=len(matches)):
            changes = apply_matches(
                conn, run=run, ev=ev, matches=matches, observed=fr.observed, cfg=self.cfg, reference_hash=ref.hash,
                app_base_url=self.settings.app_base_url, side_effects=side_effects, trace_context=trace,
            )
        deviations = _top_deviations(fr.observed)
        buffers.feature_snapshots.append(
            (run_id, ev.run_seq, ev.event_id, ev.event_time, FEATURE_VERSION, fr.history_count, fr.vector, jsonb(fr.observed), ref.hash)
        )
        buffers.detections.append(
            (run_id, ev.run_seq, ev.event_id, ev.event_time, ev.phase, decision.threat_class, run.get("model_id"), rm.health, score, pct,
             decision.model_flagged, decision.reason_codes, decision.rule_ids, jsonb(deviations))
        )
        buffers.processed_seqs.append(ev.run_seq)
        with conn.cursor() as cur:
            cur.execute(
                """INSERT INTO processed_events (event_time, run_id, run_seq, event_id, username, ip_raw, method, path, route_family, object_id,
                       status, response_bytes, threat_class, phase)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                (ev.event_time, run_id, ev.run_seq, ev.event_id, ev.username, ev.ip_raw, ev.method, ev.path, ev.route_family, ev.object_id,
                 ev.status, ev.response_bytes, decision.threat_class, ev.phase),
            )
        stats.apply_event(ev)
        result.processed += 1
        result.last_seq = ev.run_seq
        result.classes[decision.threat_class] = result.classes.get(decision.threat_class, 0) + 1
        for ch in changes:
            result.incidents.append({
                "incident_id": ch.incident_id, "version": ch.version, "class": ch.threat_class, "previous_class": ch.previous_class,
                "rule_ids": ch.rule_ids, "run_seq": ev.run_seq, "event_time": ev.event_time.isoformat(), "account": ev.username,
                "ip": ev.ip_raw, "phase": ev.phase, "notification": ch.notification, "summary": ch.summary,
            })

    # ---------------------------------------------------------------------------------------------- worker loop

    def step(self, conn: psycopg.Connection[Any], run_id: str) -> BatchResult:
        """One admission + one microbatch, each in its own transaction, with retry/blocking semantics."""
        try:
            runs_mod.admit_replay(conn, run_id, self.cfg)
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        try:
            res = self.process_batch(conn, run_id)
            conn.commit()
        except PoisonRecord as poison:
            conn.rollback()
            blocked = self._record_failure(conn, run_id, poison.cause, seq=poison.seq)
            return BatchResult() if blocked else self._commit_healthy_prefix(conn, run_id, poison.seq)
        except Exception as exc:  # noqa: BLE001
            conn.rollback()
            self._record_failure(conn, run_id, exc)
            return BatchResult()
        if res.processed == 0:
            runs_mod.maybe_complete(conn, run_id)
            # Live runs get no microbatch during silence; the digest window closes on wall time regardless.
            outbox.promote_ready_if_live(conn, run_id)
            conn.commit()
        return res

    def _commit_healthy_prefix(self, conn: psycopg.Connection[Any], run_id: str, poison_seq: int) -> BatchResult:
        """After a poisoned microbatch rolled back, process only the events before the poison in a smaller batch so
        they commit and the blocked sequence is exactly the failing record."""
        run = runs_mod.get_run(conn, run_id)
        conn.commit()
        size = poison_seq - int(run["processed_seq"]) - 1 if run else 0
        if size <= 0:
            return BatchResult()
        try:
            res = self.process_batch(conn, run_id, batch_size=size)
            conn.commit()
            return res
        except PoisonRecord as poison:  # a second poison inside the prefix carries its own blame
            conn.rollback()
            self._record_failure(conn, run_id, poison.cause, seq=poison.seq)
        except Exception as exc:  # noqa: BLE001
            conn.rollback()
            self._record_failure(conn, run_id, exc)
        return BatchResult()

    def _record_failure(self, conn: psycopg.Connection[Any], run_id: str, exc: BaseException, seq: int | None = None) -> bool:
        """Bounded retry bookkeeping in its own transaction; the failed batch itself was rolled back.

        `seq` is the run_seq to blame (the poison record). Without it — a failure outside per-event processing —
        the head of the batch is blamed. Returns True when the run is now blocked."""
        max_attempts = int(self.cfg.policy["replay"]["max_attempts"])
        blocked = False
        with conn.cursor() as cur:
            cur.execute("SELECT processed_seq FROM runs WHERE run_id=%s FOR UPDATE", (run_id,))
            row = cur.fetchone()
            if row is None:
                conn.commit()
                return False
            if seq is None or seq <= int(row["processed_seq"]):
                seq = int(row["processed_seq"]) + 1
            cur.execute(
                "UPDATE run_events SET attempts = attempts + 1, last_error=%s WHERE run_id=%s AND run_seq=%s RETURNING attempts",
                (f"{type(exc).__name__}: {str(exc)[:500]}", run_id, seq),
            )
            r = cur.fetchone()
            attempts = int(r["attempts"]) if r else max_attempts
            if attempts >= max_attempts:
                blocked = True
                cur.execute(
                    "UPDATE runs SET state='blocked', block_reason=%s, blocked_seq=%s, updated_at=now() WHERE run_id=%s",
                    (f"{type(exc).__name__} after {attempts} attempts at run_seq {seq}", seq, run_id),
                )
                cur.execute("UPDATE run_events SET processing_state='failed' WHERE run_id=%s AND run_seq=%s", (run_id, seq))
                cur.execute(
                    "INSERT INTO ui_updates (run_id, update_seq, type, payload) VALUES (%s, %s, 'run_state', %s)",
                    (run_id, outbox.next_update_seq(conn, run_id), jsonb({"state": "blocked", "blocked_seq": seq, "reason": type(exc).__name__})),
                )
                sentry.log_event("run_blocked", "error", run_id=run_id, run_seq=seq, error=type(exc).__name__)
                sentry.capture_exception(exc, run_id=run_id)
            else:
                log.warning("run %s: attempt %d failed at seq %d: %s", run_id, attempts, seq, type(exc).__name__)
        conn.commit()
        return blocked

    def run_forever(self, poll_seconds: float = 0.25, stop: Callable[[], bool] | None = None) -> None:
        sentry.init("detector", self.settings)
        conn = connect_direct(self.database_url)
        log.info("detector started features=%s/%d", FEATURE_VERSION, len(FEATURE_NAMES))
        try:
            while not (stop and stop()):
                with conn.cursor() as cur:
                    cur.execute("SELECT run_id FROM runs WHERE state IN ('warming','running','paused') ORDER BY updated_at")
                    ids = [r["run_id"] for r in cur.fetchall()]
                conn.commit()
                busy = False
                for rid in ids:
                    try:
                        res = self.step(conn, rid)
                        busy = busy or res.processed > 0
                    except psycopg.OperationalError:
                        log.exception("database error; reconnecting")
                        conn.close()
                        time.sleep(2)
                        conn = connect_direct(self.database_url)
                    except Exception:  # noqa: BLE001
                        log.exception("unexpected error in detector step")
                        conn.rollback()
                if not busy:
                    time.sleep(poll_seconds)
        finally:
            conn.close()
            sentry.flush()


def _top_deviations(observed: dict[str, Any]) -> list[dict[str, Any]]:
    """Measured baseline differences shown to analysts. Not a model attribution."""
    out: list[dict[str, Any]] = []
    if observed.get("familiarity") == "unfamiliar":
        out.append({"code": "unfamiliar_source", "detail": "account/source pair absent from frozen login reference"})
    if observed.get("acct_path_denials", 0) > 0 and observed.get("acct_path_prior_200", 0) == 0:
        out.append({"code": "first_success_after_denials", "detail": f"{observed['acct_path_denials']} prior 403s, 0 prior 200s"})
    if observed.get("unusual_query_keys"):
        out.append({"code": "unusual_query_keys", "detail": ",".join(observed["unusual_query_keys"])})
    if observed.get("pair_401_5m", 0) >= 2:
        out.append({"code": "recent_login_failures", "detail": f"{observed['pair_401_5m']} pair 401s in 5m"})
    n = observed.get("acct_count") or 0
    if n >= 100 and (observed.get("acct_hour_count") or 0) / n < 0.005:
        out.append({"code": "rare_hour_for_account", "detail": f"{observed.get('acct_hour_count')} of {n} prior events at hour {observed.get('local_hour')}"})
    if observed.get("cold_start"):
        out.append({"code": "cold_start", "detail": f"only {n} prior events for account"})
    return out


def main() -> None:
    Detector().run_forever()


if __name__ == "__main__":
    main()
