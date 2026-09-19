"""Parser contract: strict format, forensic preservation, explicit rejects, deterministic evidence ids."""
from datetime import UTC, datetime, timedelta, timezone

import pytest

from app.ingest.parser import PARSE_VERSION, ParseError, file_event_id, parse_line

LINE = '10.0.8.45 - david_m [15/Mar/2026:11:26:59 -0400] "GET /finance/reports/q1_draft_CONFIDENTIAL.zip HTTP/1.1" 200 8459200'


def test_parses_all_fields_and_preserves_raw_line():
    ev = parse_line(LINE)
    assert ev.ip_raw == "10.0.8.45"
    assert ev.username == "david_m"
    assert ev.method == "GET"
    assert ev.path == "/finance/reports/q1_draft_CONFIDENTIAL.zip"
    assert ev.raw_target == "/finance/reports/q1_draft_CONFIDENTIAL.zip"
    assert ev.http_version == "HTTP/1.1"
    assert ev.status == 200
    assert ev.response_bytes == 8459200
    assert ev.raw_line == LINE
    assert ev.original_time == "15/Mar/2026:11:26:59 -0400"
    assert ev.offset_minutes == -240
    # UTC normalisation keeps the instant: 11:26:59 -0400 == 15:26:59Z
    assert ev.event_time == datetime(2026, 3, 15, 15, 26, 59, tzinfo=UTC)
    assert ev.event_time.astimezone(timezone(timedelta(minutes=-240))).hour == 11
    assert PARSE_VERSION


def test_leading_zero_ip_is_preserved_not_rejected():
    ev = parse_line('10.0.9.05 - nicole_h [01/Aug/2025:08:10:00 -0400] "GET /dashboard HTTP/1.1" 200 2048')
    assert ev.ip_raw == "10.0.9.05"


def test_query_is_split_without_destroying_evidence():
    ev = parse_line(
        '10.0.8.45 - david_m [15/Mar/2026:09:42:35 -0400] "POST /intranet/forum/new?topic=q1_updates&action=csrf_role_update HTTP/1.1" 400 512'
    )
    assert ev.path == "/intranet/forum/new"
    assert ev.raw_target == "/intranet/forum/new?topic=q1_updates&action=csrf_role_update"
    assert ev.query_raw == "topic=q1_updates&action=csrf_role_update"
    assert ev.query_keys == ["topic", "action"]
    assert ev.route_family == "forum_new"


def test_single_bounded_decode_pass_no_recursive_decoding():
    ev = parse_line(
        '10.0.8.45 - david_m [15/Mar/2026:09:42:35 -0400] "GET /x?q=%253Cscript%253E HTTP/1.1" 200 1'
    )
    # One decode: %25 -> %, leaving %3C literal. Never decoded again into '<'.
    assert ev.query_decoded == "q=%3Cscript%3E"
    assert ev.query_raw == "q=%253Cscript%253E"


def test_object_id_extracted_for_forum_objects():
    ev = parse_line('10.0.5.12 - sarah_j [15/Mar/2026:11:07:56 -0400] "GET /intranet/forum/view/1042 HTTP/1.1" 200 3105')
    assert ev.route_family == "forum_view"
    assert ev.object_id == "1042"


def test_dash_bytes_becomes_null_not_zero():
    ev = parse_line('10.0.5.12 - sarah_j [15/Mar/2026:11:07:56 -0400] "GET /logout HTTP/1.1" 302 -')
    assert ev.response_bytes is None


@pytest.mark.parametrize(
    "bad",
    [
        "",
        "garbage",
        '10.0.5.12 sarah_j [15/Mar/2026:11:07:56 -0400] "GET /logout HTTP/1.1" 302 0',  # missing dash ident
        '10.0.5.12 - sarah_j [15/Mar/2026:11:07:56] "GET /logout HTTP/1.1" 302 0',  # missing offset
        '10.0.5.12 - sarah_j [31/Feb/2026:11:07:56 -0400] "GET /logout HTTP/1.1" 302 0',  # impossible date
        '10.0.5.12 - sarah_j [15/Mar/2026:11:07:56 -0400] "GET /logout" 302 0',  # no http version
        '10.0.5.12 - sarah_j [15/Mar/2026:11:07:56 -0400] "GET /logout HTTP/1.1" 3o2 0',  # non-numeric status
        '10.0.5.12 - sarah_j [15/Mar/2026:11:07:56 -0400] "GET /logout HTTP/1.1" 302 abc',  # non-numeric bytes
        'not.an.ip.at.all - sarah_j [15/Mar/2026:11:07:56 -0400] "GET /logout HTTP/1.1" 302 0',
    ],
)
def test_malformed_lines_are_rejected_with_reason(bad):
    with pytest.raises(ParseError) as exc:
        parse_line(bad)
    assert exc.value.reason


def test_oversize_line_rejected():
    with pytest.raises(ParseError) as exc:
        parse_line('10.0.5.12 - sarah_j [15/Mar/2026:11:07:56 -0400] "GET /' + "a" * 70000 + ' HTTP/1.1" 200 1')
    assert "oversize" in exc.value.reason


def test_file_event_ids_are_distinct_for_identical_lines_at_different_offsets():
    digest = "9f77" * 16
    a = file_event_id(digest, 10)
    b = file_event_id(digest, 11)
    assert a != b and len(a) == 64
    assert file_event_id(digest, 10) == a  # deterministic
    assert file_event_id("0" * 64, 10) != a  # dataset identity participates
