"""Assembles what a team sees on its dashboard."""

from __future__ import annotations

import sqlite3
from typing import Dict, List, Optional

from app.db import get_db
from app.lib.deadline import DeadlineInfo, delivery_state, resolve_deadline


def get_files_for(submission_ids: List[int]) -> Dict[int, List[sqlite3.Row]]:
    """Files for a set of submissions, grouped by submission id."""
    grouped: Dict[int, List[sqlite3.Row]] = {}
    if not submission_ids:
        return grouped
    conn = get_db()
    placeholders = ",".join("?" for _ in submission_ids)
    rows = conn.execute(
        f"SELECT * FROM submission_files WHERE submission_id IN ({placeholders}) ORDER BY id",
        submission_ids,
    ).fetchall()
    for row in rows:
        grouped.setdefault(row["submission_id"], []).append(row)
    return grouped


def get_effective_deadline(
    assignment: sqlite3.Row, team_id: int, now: Optional[int] = None
) -> DeadlineInfo:
    """The team's effective deadline for one assignment."""
    conn = get_db()
    extension = conn.execute(
        "SELECT new_due_at FROM deadline_extensions WHERE assignment_id = ? AND team_id = ?",
        (assignment["id"], team_id),
    ).fetchone()
    return resolve_deadline(
        assignment["due_at"],
        bool(assignment["accept_late"]),
        extension["new_due_at"] if extension else None,
        now,
    )


def get_team_dashboard(
    team_id: int,
    members: List[sqlite3.Row],
    assignment_id: int,
    now: Optional[int] = None,
) -> List[dict]:
    """The card for the one assignment this team was formed for.

    A team belongs to a single assignment, so this returns at most one
    card -- it stays a list only because a draft assignment produces none,
    and every caller already renders a collection.
    """
    conn = get_db()
    # A draft is invisible to students even through its own team's link, so
    # a half-written brief is never exposed by a code handed out too early.
    published = conn.execute(
        "SELECT * FROM assignments WHERE id = ? AND published_at IS NOT NULL",
        (assignment_id,),
    ).fetchall()
    if not published:
        return []

    team_submissions = conn.execute(
        "SELECT * FROM submissions WHERE team_id = ?", (team_id,)
    ).fetchall()
    extensions = conn.execute(
        "SELECT * FROM deadline_extensions WHERE team_id = ?", (team_id,)
    ).fetchall()

    files = get_files_for([s["id"] for s in team_submissions])

    def with_files(s: sqlite3.Row) -> dict:
        return {**dict(s), "files": files.get(s["id"], [])}

    extension_for = {e["assignment_id"]: e["new_due_at"] for e in extensions}

    cards = []
    for assignment in published:
        deadline = resolve_deadline(
            assignment["due_at"],
            bool(assignment["accept_late"]),
            extension_for.get(assignment["id"]),
            now,
        )

        if assignment["mode"] == "solo":
            member_rows = []
            for student in members:
                found = next(
                    (
                        s
                        for s in team_submissions
                        if s["assignment_id"] == assignment["id"]
                        and s["student_id"] == student["id"]
                    ),
                    None,
                )
                submission = with_files(found) if found else None
                state = delivery_state(submission, deadline.overdue)
                member_rows.append(
                    {"student": student, "submission": submission, "state": state}
                )

            cards.append(
                {
                    "assignment": assignment,
                    "deadline": deadline,
                    "submission": None,
                    "member_rows": member_rows,
                    "state": _summarise_members(member_rows),
                }
            )
            continue

        found = next(
            (
                s
                for s in team_submissions
                if s["assignment_id"] == assignment["id"] and s["student_id"] is None
            ),
            None,
        )
        submission = with_files(found) if found else None
        cards.append(
            {
                "assignment": assignment,
                "deadline": deadline,
                "submission": submission,
                "member_rows": [],
                "state": delivery_state(submission, deadline.overdue),
            }
        )

    return cards


def _summarise_members(rows: List[dict]) -> str:
    """The headline state for a solo assignment card.

    Anything unresolved wins over anything finished: a card must not read
    "Delivered" while one member of the group still hasn't handed in.
    Rework is surfaced above a plain miss because it is the one the team
    can act on today.
    """
    if not rows:
        return "pending"
    states = [r["state"] for r in rows]
    if "rework" in states:
        return "rework"
    if "missing" in states:
        return "missing"
    if "pending" in states:
        return "pending"
    if "late" in states:
        return "late"
    if all(s == "approved" for s in states):
        return "approved"
    return "delivered"
