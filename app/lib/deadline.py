"""Deadline resolution, kept pure and dependency-free so it can be
unit-tested without a database. Every "is this late / can they still submit
/ what does the badge say" decision in the app routes through here, so there
is exactly one definition of each.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Literal, Optional

DeliveryState = Literal["pending", "missing", "delivered", "late", "approved", "rework"]

STATE_LABEL: dict[str, str] = {
    "pending": "Not delivered yet",
    "missing": "Missing",
    "delivered": "Delivered",
    "late": "Delivered late",
    "approved": "Approved",
    "rework": "Needs rework",
}


def now_ms() -> int:
    return int(time.time() * 1000)


@dataclass(frozen=True)
class DeadlineInfo:
    effective_due_at: int
    extended: bool
    overdue: bool
    can_submit: bool
    would_be_late: bool
    ms_remaining: int


def resolve_deadline(
    due_at: int,
    accept_late: bool,
    extension_due_at: Optional[int],
    now: Optional[int] = None,
) -> DeadlineInfo:
    """Resolve the deadline for one team on one assignment.

    `extension_due_at` wins over the assignment's own date whenever it is
    present -- including when it is *earlier*, so an admin can also pull a
    deadline in for a specific team rather than only pushing it out.
    """
    now = now_ms() if now is None else now
    effective_due_at = extension_due_at if extension_due_at is not None else due_at
    overdue = now > effective_due_at

    return DeadlineInfo(
        effective_due_at=effective_due_at,
        extended=extension_due_at is not None and extension_due_at != due_at,
        overdue=overdue,
        can_submit=(not overdue) or accept_late,
        would_be_late=overdue,
        ms_remaining=effective_due_at - now,
    )


def delivery_state(
    submission: Optional[dict],
    overdue: bool,
) -> DeliveryState:
    """The single status a row in the delivery matrix (or a card on the
    student dashboard) should show.

    Review outcome outranks timing: once a reviewer has approved something,
    that is the useful fact, and lateness is still available separately via
    `is_late` for the admin's "who was late" filter.
    """
    if submission is None:
        return "missing" if overdue else "pending"
    if submission["status"] == "approved":
        return "approved"
    if submission["status"] == "rework":
        return "rework"
    return "late" if submission["is_late"] else "delivered"


def is_outstanding(state: DeliveryState) -> bool:
    """Whether a state should be chased. Drives the admin panel's
    "missing only" filter and the outstanding counts on the dashboard.
    """
    return state in ("missing", "pending", "rework")


def format_relative(ms: int) -> str:
    """Human countdown for the student dashboard: "in 3 days", "in 5 hours",
    "2 days ago". Deliberately coarse -- students need urgency, not
    precision.
    """
    abs_ms = abs(ms)
    minute = 60_000
    hour = 60 * minute
    day = 24 * hour

    if abs_ms < hour:
        value = max(1, round(abs_ms / minute))
        unit = "minute"
    elif abs_ms < day:
        value = round(abs_ms / hour)
        unit = "hour"
    else:
        value = round(abs_ms / day)
        unit = "day"

    plural = unit if value == 1 else f"{unit}s"
    return f"in {value} {plural}" if ms >= 0 else f"{value} {plural} ago"
