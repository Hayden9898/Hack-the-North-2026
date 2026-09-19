"""The event view the detector works on: one admitted run event joined with its immutable raw record."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any


@dataclass(frozen=True)
class Event:
    run_seq: int
    event_id: str
    event_time: datetime
    phase: str
    username: str
    ip_raw: str
    method: str
    path: str
    raw_target: str
    query_keys: tuple[str, ...]
    route_family: str
    object_id: str | None
    status: int
    response_bytes: int | None
    offset_minutes: int
    line_number: int | None
    raw_line: str

    @property
    def pair_key(self) -> str:
        return f"{self.username}|{self.ip_raw}"

    @property
    def account_path_key(self) -> str:
        return f"{self.username}|{self.path}"

    @property
    def local_time(self) -> datetime:
        return self.event_time.astimezone(timezone(timedelta(minutes=self.offset_minutes)))

    @property
    def is_2xx(self) -> bool:
        return 200 <= self.status < 300

    @classmethod
    def from_row(cls, row: dict[str, Any]) -> Event:
        return cls(
            run_seq=int(row["run_seq"]),
            event_id=row["event_id"],
            event_time=row["event_time"],
            phase=row["phase"],
            username=row["username"],
            ip_raw=row["ip_raw"],
            method=row["method"],
            path=row["path"],
            raw_target=row["raw_target"],
            query_keys=tuple(row.get("query_keys") or ()),
            route_family=row["route_family"],
            object_id=row.get("object_id"),
            status=int(row["status"]),
            response_bytes=row.get("response_bytes"),
            offset_minutes=int(row.get("offset_minutes") or 0),
            line_number=row.get("line_number"),
            raw_line=row.get("raw_line") or "",
        )

    def evidence_ref(self) -> dict[str, Any]:
        return {"event_id": self.event_id, "run_seq": self.run_seq, "line_number": self.line_number, "event_time": self.event_time.isoformat()}
