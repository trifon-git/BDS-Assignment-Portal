"""Queries behind the admin panel.

The delivery matrix is the screen this app exists for -- "who delivered and
who didn't" -- so it is built to answer that in one pass over a handful of
bulk queries rather than per-row lookups.
"""

from __future__ import annotations

import sqlite3
import time
from typing import Dict, List, Optional

from app.db import get_db
from app.lib.dashboard import get_files_for
from app.lib.deadline import delivery_state, is_outstanding, resolve_deadline

# Events an admin would want a badge for. Deliberately an explicit allowlist
# rather than an actor-name prefix check: `submission.created` (a student
# delivering) and `submission.approved` (an admin reviewing) share the
# `submission.` prefix, so prefix-matching cannot tell them apart.
NOTIFY_ACTIONS = [
    "submission.created",
    "submission.replaced",
    "forum.posted",
    "team.created",
    "change_request.created",
]

NOTIFICATION_LABELS = {
    "submission.created": "New delivery",
    "submission.replaced": "Delivery replaced",
    "forum.posted": "Forum message",
    "team.created": "Team created",
    "change_request.created": "Group change requested",
}


def get_delivery_matrix(assignment: sqlite3.Row, now: Optional[int] = None) -> dict:
    now = now if now is not None else int(time.time() * 1000)
    conn = get_db()

    all_teams = conn.execute(
        "SELECT * FROM teams WHERE assignment_id = ? ORDER BY name", (assignment["id"],)
    ).fetchall()
    memberships = conn.execute(
        """
        SELECT team_members.team_id AS team_id, students.*
        FROM team_members JOIN students ON students.id = team_members.student_id
        WHERE team_members.assignment_id = ? ORDER BY students.name
        """,
        (assignment["id"],),
    ).fetchall()
    all_submissions = conn.execute(
        "SELECT * FROM submissions WHERE assignment_id = ?", (assignment["id"],)
    ).fetchall()
    extensions = conn.execute(
        "SELECT * FROM deadline_extensions WHERE assignment_id = ?", (assignment["id"],)
    ).fetchall()

    files = get_files_for([s["id"] for s in all_submissions])
    name_by_id = {m["id"]: m["name"] for m in memberships}

    members_by_team: Dict[int, list] = {}
    for m in memberships:
        members_by_team.setdefault(m["team_id"], []).append(m)

    extension_for = {e["team_id"]: e["new_due_at"] for e in extensions}

    rows = []

    def build(team, student, submission):
        deadline = resolve_deadline(
            assignment["due_at"], bool(assignment["accept_late"]), extension_for.get(team["id"]), now
        )
        members = members_by_team.get(team["id"], [])
        with_files = None
        if submission is not None:
            with_files = {**dict(submission), "files": files.get(submission["id"], [])}
        state = delivery_state(with_files, deadline.overdue)

        return {
            "key": f"s{student['id']}" if student else f"t{team['id']}",
            "team": team,
            "student": student,
            "members": members,
            "submission": with_files,
            "submitted_by_name": (
                name_by_id.get(submission["submitted_by_student_id"])
                if submission and submission["submitted_by_student_id"]
                else None
            ),
            "state": state,
            "effective_due_at": deadline.effective_due_at,
            "extended": deadline.extended,
            "outstanding": is_outstanding(state),
            "chase_emails": [student["email"]] if student else [m["email"] for m in members],
        }

    for team in all_teams:
        members = members_by_team.get(team["id"], [])
        if assignment["mode"] == "solo":
            for student in members:
                submission = next(
                    (s for s in all_submissions if s["student_id"] == student["id"]), None
                )
                rows.append(build(team, student, submission))
        else:
            submission = next(
                (s for s in all_submissions if s["team_id"] == team["id"] and s["student_id"] is None),
                None,
            )
            rows.append(build(team, None, submission))

    return {
        "assignment": assignment,
        "rows": rows,
        "total": len(rows),
        "delivered": sum(1 for r in rows if not r["outstanding"]),
        "outstanding": sum(1 for r in rows if r["outstanding"]),
        "late": sum(1 for r in rows if r["submission"] and r["submission"]["is_late"]),
    }


def order_published_assignments(assignments: List[sqlite3.Row]) -> List[sqlite3.Row]:
    """Published assignments in a stable chart/column order: by
    `week_number` when both sides have one (nulls sort after numbered
    weeks), falling back to `due_at` ascending.
    """

    def key(a):
        week = a["week_number"]
        return (week is None, week if week is not None else 0, a["due_at"])

    return sorted(assignments, key=key)


def get_overview(now: Optional[int] = None) -> dict:
    now = now if now is not None else int(time.time() * 1000)
    conn = get_db()

    every_assignment = conn.execute(
        "SELECT * FROM assignments ORDER BY due_at DESC"
    ).fetchall()
    published = [a for a in every_assignment if a["published_at"] is not None]

    team_counts = conn.execute(
        "SELECT assignment_id, count(*) AS n FROM teams GROUP BY assignment_id"
    ).fetchall()
    member_counts = conn.execute(
        "SELECT assignment_id, count(*) AS n FROM team_members GROUP BY assignment_id"
    ).fetchall()
    state_counts = conn.execute(
        "SELECT assignment_id, status, is_late, count(*) AS n FROM submissions "
        "GROUP BY assignment_id, status, is_late"
    ).fetchall()
    file_stats = conn.execute(
        """
        SELECT submissions.assignment_id AS assignment_id, count(*) AS files,
               coalesce(sum(submission_files.size_bytes), 0) AS bytes
        FROM submission_files
        JOIN submissions ON submissions.id = submission_files.submission_id
        GROUP BY submissions.assignment_id
        """
    ).fetchall()
    extension_counts = conn.execute(
        "SELECT assignment_id, count(*) AS n FROM deadline_extensions GROUP BY assignment_id"
    ).fetchall()
    roster_count = conn.execute(
        "SELECT count(*) AS n FROM students WHERE active = 1"
    ).fetchone()["n"]
    video_stats = conn.execute(
        """
        SELECT count(*) AS total,
               sum(CASE WHEN submissions.video_share_confirmed THEN 1 ELSE 0 END) AS compliant
        FROM submissions
        JOIN assignments ON assignments.id = submissions.assignment_id
        WHERE assignments.requires_video = 1 AND assignments.published_at IS NOT NULL
        """
    ).fetchone()

    teams_by = {r["assignment_id"]: r["n"] for r in team_counts}
    members_by = {r["assignment_id"]: r["n"] for r in member_counts}
    files_by = {r["assignment_id"]: {"files": r["files"], "bytes": r["bytes"]} for r in file_stats}
    extensions_by = {r["assignment_id"]: r["n"] for r in extension_counts}

    summaries = []
    for assignment in published:
        rows = [r for r in state_counts if r["assignment_id"] == assignment["id"]]

        def s(match):
            return sum(r["n"] for r in rows if match(r))

        total = (
            members_by.get(assignment["id"], 0)
            if assignment["mode"] == "solo"
            else teams_by.get(assignment["id"], 0)
        )
        submitted = s(lambda r: True)
        approved = s(lambda r: r["status"] == "approved")
        rework = s(lambda r: r["status"] == "rework")
        late = s(lambda r: r["is_late"])
        late_delivered = s(lambda r: r["is_late"] and r["status"] != "rework")
        not_delivered = max(0, total - submitted)
        storage = files_by.get(assignment["id"])

        summaries.append(
            {
                "assignment": assignment,
                "total": total,
                "teams": teams_by.get(assignment["id"], 0),
                "grouped_students": members_by.get(assignment["id"], 0),
                "submitted": submitted,
                "approved": approved,
                "rework": rework,
                "late": late,
                "late_delivered": late_delivered,
                "not_delivered": not_delivered,
                "outstanding": not_delivered + rework,
                "delivered": submitted - rework,
                "files": storage["files"] if storage else 0,
                "bytes": storage["bytes"] if storage else 0,
                "extensions": extensions_by.get(assignment["id"], 0),
                "overdue": now > assignment["due_at"],
            }
        )

    current = next((s for s in summaries if s["assignment"]["due_at"] >= now), None)
    focus = current or (summaries[0] if summaries else None)

    weekly_trend = []
    for assignment in order_published_assignments([s["assignment"] for s in summaries]):
        s = next(x for x in summaries if x["assignment"]["id"] == assignment["id"])
        weekly_trend.append(
            {
                "assignment_id": assignment["id"],
                "label": f"W{assignment['week_number']}" if assignment["week_number"] is not None else assignment["title"],
                "on_time": s["delivered"] - s["late_delivered"],
                "late": s["late_delivered"],
                "rework": s["rework"],
                "missing": s["not_delivered"],
            }
        )

    return {
        "summaries": summaries,
        "weekly_trend": weekly_trend,
        "video_compliance": {
            "total": video_stats["total"] or 0,
            "compliant": video_stats["compliant"] or 0,
        },
        "current": focus,
        "team_count": focus["teams"] if focus else 0,
        "student_count": focus["grouped_students"] if focus else 0,
        "roster_count": roster_count,
        "draft_count": len(every_assignment) - len(published),
        "totals": {
            "submitted": sum(s["submitted"] for s in summaries),
            "outstanding": sum(s["outstanding"] for s in summaries),
            "late": sum(s["late"] for s in summaries),
            "rework": sum(s["rework"] for s in summaries),
            "files": sum(s["files"] for s in summaries),
            "bytes": sum(s["bytes"] for s in summaries),
        },
        "now": now,
    }


def get_storage_over_time() -> List[dict]:
    conn = get_db()
    rows = conn.execute(
        """
        SELECT (created_at / 86400000) * 86400000 AS day,
               coalesce(sum(size_bytes), 0) AS bytes
        FROM submission_files
        GROUP BY created_at / 86400000
        ORDER BY created_at / 86400000
        """
    ).fetchall()
    running = 0
    points = []
    for r in rows:
        running += r["bytes"]
        points.append({"day": r["day"], "bytes_added": r["bytes"], "cumulative_bytes": running})
    return points


def get_student_delivery_matrix(now: Optional[int] = None) -> dict:
    now = now if now is not None else int(time.time() * 1000)
    conn = get_db()

    every_assignment = conn.execute(
        "SELECT * FROM assignments ORDER BY due_at DESC"
    ).fetchall()
    active_students = conn.execute(
        "SELECT * FROM students WHERE active = 1 ORDER BY name"
    ).fetchall()
    memberships = conn.execute("SELECT * FROM team_members").fetchall()
    all_subs = conn.execute("SELECT * FROM submissions").fetchall()
    all_extensions = conn.execute("SELECT * FROM deadline_extensions").fetchall()

    columns = order_published_assignments(
        [a for a in every_assignment if a["published_at"] is not None]
    )

    team_id_for = {(m["assignment_id"], m["student_id"]): m["team_id"] for m in memberships}

    solo_submission = {}
    team_submission = {}
    for s in all_subs:
        if s["student_id"] is not None:
            solo_submission[(s["assignment_id"], s["student_id"])] = s
        else:
            team_submission[(s["assignment_id"], s["team_id"])] = s

    extension_for = {(e["assignment_id"], e["team_id"]): e["new_due_at"] for e in all_extensions}

    rows = []
    for student in active_students:
        cells = []
        for assignment in columns:
            team_id = team_id_for.get((assignment["id"], student["id"]))
            ext = extension_for.get((assignment["id"], team_id)) if team_id is not None else None
            deadline = resolve_deadline(
                assignment["due_at"], bool(assignment["accept_late"]), ext, now
            )

            if assignment["mode"] == "solo":
                submission = solo_submission.get((assignment["id"], student["id"]))
            else:
                submission = team_submission.get((assignment["id"], team_id)) if team_id is not None else None

            cells.append(
                {
                    "assignment_id": assignment["id"],
                    "state": delivery_state(submission, deadline.overdue),
                }
            )
        rows.append({"student": student, "cells": cells})

    return {"columns": columns, "rows": rows}


def list_assignments(now: Optional[int] = None) -> dict:
    now = now if now is not None else int(time.time() * 1000)
    conn = get_db()
    rows = conn.execute("SELECT * FROM assignments ORDER BY due_at DESC").fetchall()
    return {"assignments": rows, "now": now}


def get_roster_with_teams(assignment_id: int) -> List[dict]:
    """The whole active roster with each student's current team."""
    conn = get_db()
    rows = conn.execute(
        """
        SELECT students.*, teams.id AS team_id, teams.name AS team_name
        FROM students
        LEFT JOIN team_members
          ON team_members.student_id = students.id AND team_members.assignment_id = ?
        LEFT JOIN teams ON teams.id = team_members.team_id
        WHERE students.active = 1
        ORDER BY students.name
        """,
        (assignment_id,),
    ).fetchall()
    return [
        {
            "student": r,
            "team": {"id": r["team_id"], "name": r["team_name"] or ""} if r["team_id"] is not None else None,
        }
        for r in rows
    ]


def get_teams_with_members(assignment_id: int) -> List[dict]:
    conn = get_db()
    all_teams = conn.execute(
        "SELECT * FROM teams WHERE assignment_id = ? ORDER BY name", (assignment_id,)
    ).fetchall()
    memberships = conn.execute(
        """
        SELECT team_members.team_id AS team_id, students.*
        FROM team_members JOIN students ON students.id = team_members.student_id
        WHERE team_members.assignment_id = ? ORDER BY students.name
        """,
        (assignment_id,),
    ).fetchall()

    by_team: Dict[int, list] = {}
    for m in memberships:
        by_team.setdefault(m["team_id"], []).append(m)

    return [{"team": t, "members": by_team.get(t["id"], [])} for t in all_teams]


def get_roster() -> List[dict]:
    conn = get_db()
    rows = conn.execute("SELECT * FROM students ORDER BY name").fetchall()
    grouped = conn.execute(
        """
        SELECT team_members.student_id AS student_id, count(*) AS n
        FROM team_members JOIN assignments ON assignments.id = team_members.assignment_id
        WHERE assignments.published_at IS NOT NULL
        GROUP BY team_members.student_id
        """
    ).fetchall()
    published_count = conn.execute(
        "SELECT count(*) AS n FROM assignments WHERE published_at IS NOT NULL"
    ).fetchone()["n"]
    solo = conn.execute(
        "SELECT student_id, count(*) AS n FROM submissions WHERE student_id IS NOT NULL "
        "GROUP BY student_id"
    ).fetchall()
    submitted = conn.execute(
        "SELECT submitted_by_student_id AS student_id, count(*) AS n FROM submissions "
        "WHERE student_id IS NULL GROUP BY submitted_by_student_id"
    ).fetchall()

    solo_by = {r["student_id"]: r["n"] for r in solo}
    sent_by = {r["student_id"]: r["n"] for r in submitted}
    grouped_by = {r["student_id"]: r["n"] for r in grouped}

    return [
        {
            "student": student,
            "grouped_for": grouped_by.get(student["id"], 0),
            "published_assignments": published_count,
            "solo_submissions": solo_by.get(student["id"], 0),
            "submitted_by_them": sent_by.get(student["id"], 0),
        }
        for student in rows
    ]


def get_notification_count(seen_at: Optional[int]) -> int:
    """How many notify-worthy events happened after `seen_at`. None means
    the admin has never looked, so everything counts."""
    conn = get_db()
    placeholders = ",".join("?" for _ in NOTIFY_ACTIONS)
    row = conn.execute(
        f"SELECT count(*) AS n FROM audit_log WHERE action IN ({placeholders}) AND created_at > ?",
        (*NOTIFY_ACTIONS, seen_at or 0),
    ).fetchone()
    return row["n"]


def get_notifications(limit: int = 200) -> List[sqlite3.Row]:
    """The persistent notification feed -- every notify-worthy event, newest
    first, kept regardless of whether it's been "seen". Read separately from
    `get_notification_count` so viewing this list is the only thing that
    clears the badge; scrolling past an event on some other page never does.
    """
    conn = get_db()
    placeholders = ",".join("?" for _ in NOTIFY_ACTIONS)
    return conn.execute(
        f"SELECT * FROM audit_log WHERE action IN ({placeholders}) "
        f"ORDER BY created_at DESC LIMIT ?",
        (*NOTIFY_ACTIONS, limit),
    ).fetchall()


def get_recent_activity(limit: int = 20) -> List[sqlite3.Row]:
    conn = get_db()
    return conn.execute(
        "SELECT * FROM audit_log ORDER BY created_at DESC LIMIT ?", (limit,)
    ).fetchall()
