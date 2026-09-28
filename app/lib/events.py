"""Upcoming events shown in the student-page sidebar, read from NocoDB.

This is the app's only outbound request, so it is built to never get in the
way of a page load: results are cached in memory, a stale cache is served
while a background thread refreshes it, and any failure (NocoDB down, bad
token, timeout) just means the panel shows the last good list -- or nothing.
"""

from __future__ import annotations

import json
import logging
import threading
import time
import urllib.parse
import urllib.request
from datetime import date, datetime
from zoneinfo import ZoneInfo

from app.config import (
    EVENTS_CACHE_SECONDS,
    EVENTS_MAX_SHOWN,
    NOCODB_EVENTS_TABLE,
    NOCODB_TOKEN,
    NOCODB_URL,
    TIMEZONE,
)

log = logging.getLogger(__name__)

_TZ = ZoneInfo(TIMEZONE)
_TIMEOUT_SECONDS = 4
_RETRY_AFTER_FAILURE_SECONDS = 60
_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
_WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

_lock = threading.Lock()
_events: list[dict] | None = None  # None until the first successful fetch
_fetched_at = 0.0
_failed_at = 0.0
_refreshing = False


def _today() -> date:
    return datetime.now(_TZ).date()


def _fetch(today: date) -> list[dict]:
    # `exactDate` is NocoDB's sub-operator for comparing a Date column.
    query = urllib.parse.urlencode({
        "where": f"(Date,gte,exactDate,{today.isoformat()})",
        "sort": "Date",
        "limit": 50,
        "fields": "Event,Date,Time,Location,Link",
    })
    url = f"{NOCODB_URL}/api/v2/tables/{NOCODB_EVENTS_TABLE}/records?{query}"
    req = urllib.request.Request(url, headers={"xc-token": NOCODB_TOKEN, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=_TIMEOUT_SECONDS) as resp:
        rows = json.load(resp).get("list", [])

    events = []
    for row in rows:
        try:
            day = date.fromisoformat(str(row.get("Date") or ""))
        except ValueError:
            continue  # a row without a usable date can't be "upcoming"
        link = str(row.get("Link") or "").strip()
        events.append({
            "title": str(row.get("Event") or "").strip(),
            "day": day,
            "time": str(row.get("Time") or "").strip(),
            "location": str(row.get("Location") or "").strip(),
            # Only ever rendered as an href, so accept nothing but web links.
            "link": link if link.lower().startswith(("http://", "https://")) else "",
        })
    # Time is free text ("14:00-17:00", "TBA"): digits sort before "TBA".
    events.sort(key=lambda e: (e["day"], e["time"]))
    return events


def _refresh() -> None:
    global _events, _fetched_at, _failed_at, _refreshing
    try:
        events = _fetch(_today())
        with _lock:
            _events, _fetched_at = events, time.monotonic()
    except Exception as exc:  # network, HTTP, JSON: all handled the same way
        log.warning("[events] refresh failed: %s", exc)
        with _lock:
            _failed_at = time.monotonic()
    finally:
        with _lock:
            _refreshing = False


def get_upcoming() -> list[dict]:
    """Future events, soonest first. Empty when unconfigured or unavailable."""
    global _refreshing
    if not (NOCODB_URL and NOCODB_TOKEN):
        return []

    now = time.monotonic()
    with _lock:
        stale = _events is None or now - _fetched_at > EVENTS_CACHE_SECONDS
        backing_off = now - _failed_at < _RETRY_AFTER_FAILURE_SECONDS and _failed_at > _fetched_at
        start = stale and not backing_off and not _refreshing
        first_load = start and _events is None
        if start:
            _refreshing = True

    if first_load:
        _refresh()  # nothing to show yet, so this one request waits (<= 4 s)
    elif start:
        threading.Thread(target=_refresh, daemon=True).start()

    with _lock:
        cached = list(_events or [])
    today = _today()  # the cache can outlive midnight
    return [
        {**e, "date_label": f"{_WEEKDAYS[e['day'].weekday()]} {e['day'].day} {_MONTHS[e['day'].month - 1]}"}
        for e in cached
        if e["day"] >= today
    ][:EVENTS_MAX_SHOWN]
