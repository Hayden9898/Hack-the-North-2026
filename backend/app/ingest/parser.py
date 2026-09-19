"""Strict parser for the observed access-log format.

Forensic preservation rules (architecture.md §3): keep raw_line, raw target, original timestamp text and offset;
split path/query without decoding away evidence; exactly one bounded decode pass; never strict-validate IPv4 in a way
that rejects the supplied leading-zero address.
"""
from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from datetime import UTC, datetime
from urllib.parse import unquote

from app.config import RouteConfig, get_config

PARSE_VERSION = "1"
MAX_LINE_BYTES = 64 * 1024

_LINE_RE = re.compile(
    r"^(?P<ip>\S+) - (?P<user>\S+) \[(?P<ts>\d{2}/[A-Za-z]{3}/\d{4}:\d{2}:\d{2}:\d{2} [+-]\d{4})\] "
    r'"(?P<method>[A-Z]{3,10}) (?P<target>\S+) (?P<ver>HTTP/\d(?:\.\d)?)" (?P<status>\d{3}) (?P<bytes>\d+|-)$'
)
# Lenient on purpose: dotted quad with 1-3 digits per octet (leading zeros allowed), or an IPv6-looking token.
_IPV4_RE = re.compile(r"^\d{1,3}(?:\.\d{1,3}){3}$")
_IPV6_RE = re.compile(r"^[0-9A-Fa-f:.]{2,45}$")


class ParseError(ValueError):
    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


@dataclass(frozen=True)
class ParsedEvent:
    ip_raw: str
    username: str
    event_time: datetime  # UTC
    original_time: str
    offset_minutes: int
    method: str
    raw_target: str
    path: str
    query_raw: str | None
    query_decoded: str | None
    query_keys: list[str]
    route_family: str
    object_id: str | None
    http_version: str
    status: int
    response_bytes: int | None
    raw_line: str

    @property
    def payload_hash(self) -> str:
        return payload_hash(self.raw_line)


def payload_hash(raw_line: str) -> str:
    return hashlib.sha256(raw_line.encode("utf-8", "surrogateescape")).hexdigest()


def file_event_id(dataset_sha256: str, line_number: int) -> str:
    """Stable evidence id: SHA-256(dataset digest + ':' + one-based line number)."""
    return hashlib.sha256(f"{dataset_sha256}:{line_number}".encode("ascii")).hexdigest()


def parse_line(line: str, routes: RouteConfig | None = None) -> ParsedEvent:
    if len(line) > MAX_LINE_BYTES:
        raise ParseError(f"oversize line ({len(line)} chars > {MAX_LINE_BYTES})")
    line = line.rstrip("\r\n")
    if not line:
        raise ParseError("empty line")
    m = _LINE_RE.match(line)
    if not m:
        raise ParseError("does not match access-log format")
    ip = m.group("ip")
    if not (_IPV4_RE.match(ip) or (":" in ip and _IPV6_RE.match(ip))):
        raise ParseError("invalid source address token")
    try:
        ts = datetime.strptime(m.group("ts"), "%d/%b/%Y:%H:%M:%S %z")
    except ValueError as exc:
        raise ParseError(f"invalid timestamp: {exc}") from exc
    offset = ts.utcoffset()
    offset_minutes = int(offset.total_seconds() // 60) if offset is not None else 0
    target = m.group("target")
    path, sep, query = target.partition("?")
    if not path.startswith("/"):
        raise ParseError("request target must be an absolute path")
    query_raw = query if sep else None
    query_decoded = unquote(query_raw) if query_raw is not None else None  # exactly one pass
    keys = [kv.split("=", 1)[0] for kv in query_raw.split("&")] if query_raw else []
    routes = routes or get_config().routes
    family, object_id = routes.classify(path)
    raw_bytes = m.group("bytes")
    return ParsedEvent(
        ip_raw=ip,
        username=m.group("user"),
        event_time=ts.astimezone(UTC),
        original_time=m.group("ts"),
        offset_minutes=offset_minutes,
        method=m.group("method"),
        raw_target=target,
        path=path,
        query_raw=query_raw,
        query_decoded=query_decoded,
        query_keys=keys,
        route_family=family,
        object_id=object_id,
        http_version=m.group("ver"),
        status=int(m.group("status")),
        response_bytes=None if raw_bytes == "-" else int(raw_bytes),
        raw_line=line,
    )
