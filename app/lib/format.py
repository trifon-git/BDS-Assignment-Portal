"""Date rendering. Everything is stored as epoch milliseconds and displayed
in the university's timezone, so a deadline reads the same for a student on
a laptop in Aalborg and one visiting family abroad.
"""

from __future__ import annotations

import re
from datetime import datetime
from typing import Optional
from zoneinfo import ZoneInfo

from app.config import TIMEZONE

_TZ = ZoneInfo(TIMEZONE)
_MONTHS = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
]
_WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


def _local(ms: int) -> datetime:
    return datetime.fromtimestamp(ms / 1000, tz=_TZ)


def format_deadline(ms: int) -> str:
    d = _local(ms)
    return f"{_WEEKDAYS[d.weekday()]}, {d.day} {_MONTHS[d.month - 1]}, {d:%H:%M}"


def format_date(ms: int) -> str:
    d = _local(ms)
    return f"{d.day} {_MONTHS[d.month - 1]} {d.year}"


def format_time(ms: int) -> str:
    return f"{_local(ms):%H:%M}"


def to_date_time_local(ms: int) -> str:
    """For <input type="datetime-local">, which wants local wall-clock time."""
    return f"{_local(ms):%Y-%m-%dT%H:%M}"


_DATETIME_LOCAL_RE = re.compile(r"^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$")


def from_date_time_local(value: str) -> Optional[int]:
    """Parse a datetime-local value as a wall-clock time in the university's
    timezone. Returns None (the NaN-equivalent) for anything that doesn't
    parse to a real calendar date/time.
    """
    match = _DATETIME_LOCAL_RE.match(value.strip())
    if not match:
        return None

    y, mo, d, h, mi = (int(x) for x in match.groups())
    if not (1 <= mo <= 12 and 1 <= d <= 31 and h <= 23 and mi <= 59):
        return None

    try:
        dt = datetime(y, mo, d, h, mi, tzinfo=_TZ)
    except ValueError:
        # Rejects rollovers, e.g. 31 February.
        return None

    return int(dt.timestamp() * 1000)
