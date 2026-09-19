"""CLI: import a log file into the configured database. Idempotent; resumable."""
from __future__ import annotations

import argparse
import sys
import time

from app.ingest.importer import import_dataset
from app.observability import sentry
from app.settings import get_settings


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--path", default=None, help="log file (default: DATASET_PATH)")
    ap.add_argument("--database-url", default=None)
    ap.add_argument("--batch-size", type=int, default=5000)
    args = ap.parse_args()
    settings = get_settings()
    sentry.init("import-cli", settings)
    path = args.path or settings.dataset_path
    t0 = time.perf_counter()

    def progress(line: int, _size: int) -> None:
        print(f"\r  imported through line {line:,}", end="", file=sys.stderr, flush=True)

    res = import_dataset(path, args.database_url or settings.database_url, batch_size=args.batch_size, progress_cb=progress)
    dt = time.perf_counter() - t0
    print(file=sys.stderr)
    print(
        f"dataset {res.dataset_id} sha256={res.content_sha256} state={res.import_state} lines={res.total_lines:,} "
        f"valid={res.valid_count:,} rejected={res.rejected_count:,} inserted_now={res.rows_inserted:,} "
        f"range={res.first_event_time}..{res.last_event_time} elapsed={dt:.1f}s"
    )
    sentry.flush()
    return 0 if res.import_state == "ready" else 1


if __name__ == "__main__":
    raise SystemExit(main())
