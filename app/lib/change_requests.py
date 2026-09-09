"""A student asking to move to a different group for one assignment.

Other groups are never shown to the student -- they can only explain why,
not pick where. An admin reads the reason, picks a destination team, and the
actual move reuses `admin_actions.move_student`, the one place membership is
written, so a request approval leaves the exact same trail a manual move
would.
"""

from __future__ import annotations

import sqlite3
import time
from typing import Dict, List, Optional

from app.db import db_lock, get_db
from app.lib.auth import record_audit

MAX_REASON_LENGTH = 2000


def _current_team_id(student_id: int, assignment_id: int) -> Optional[int]:
    conn = get_db()
    row = conn.execute(
        "SELECT team_id FROM team_members WHERE student_id = ? AND assignment_id = ?",
        (student_id, assignment_id),
    ).fetchone()
    return row["team_id"] if row else None


def create_change_request(student_id: int, assignment_id: int, reason: str) -> Optional[str]:
    """Returns an error string, or None on success."""
    reason = reason.strip()[:MAX_REASON_LENGTH]
    if not reason:
        return "Say a little about why you'd like to change groups."

    if _current_team_id(student_id, assignment_id) is None:
        return "You're not in a group for this assignment yet, so there's nothing to change."

    conn = get_db()
    pending = conn.execute(
        "SELECT 1 FROM group_change_requests WHERE student_id = ? AND assignment_id = ? "
        "AND status = 'pending'",
        (student_id, assignment_id),
    ).fetchone()
    if pending:
        return "You already have a pending request for this assignment. Wait for it to be resolved first."

    with db_lock() as conn:
        conn.execute(
            "INSERT INTO group_change_requests (student_id, assignment_id, reason) VALUES (?, ?, ?)",
            (student_id, assignment_id, reason),
        )
        conn.commit()

    student = conn.execute("SELECT * FROM students WHERE id = ?", (student_id,)).fetchone()
    record_audit(
        action="change_request.created",
        actor_name=student["name"] if student else f"student:{student_id}",
        detail=reason,
    )
    return None


def get_requests_for_student(student_id: int) -> Dict[int, sqlite3.Row]:
    """Most recent change request per assignment, for showing status on the
    student's personal page."""
    conn = get_db()
    rows = conn.execute(
        "SELECT * FROM group_change_requests WHERE student_id = ? ORDER BY created_at DESC",
        (student_id,),
    ).fetchall()
    latest: Dict[int, sqlite3.Row] = {}
    for row in rows:
        latest.setdefault(row["assignment_id"], row)
    return latest


def get_pending_count() -> int:
    conn = get_db()
    return conn.execute(
        "SELECT count(*) AS n FROM group_change_requests WHERE status = 'pending'"
    ).fetchone()["n"]


def list_requests(status: Optional[str] = None) -> List[dict]:
    """The admin queue: every request, newest first, with enough context to
    act on it without a second lookup."""
    conn = get_db()
    where = "WHERE group_change_requests.status = ?" if status else ""
    params = (status,) if status else ()
    rows = conn.execute(
        f"""
        SELECT group_change_requests.*, students.name AS student_name,
               students.email AS student_email, assignments.title AS assignment_title,
               assignments.id AS assignment_id_check
        FROM group_change_requests
        JOIN students ON students.id = group_change_requests.student_id
        JOIN assignments ON assignments.id = group_change_requests.assignment_id
        {where}
        ORDER BY group_change_requests.created_at DESC
        """,
        params,
    ).fetchall()

    out = []
    for row in rows:
        team_id = _current_team_id(row["student_id"], row["assignment_id"])
        team = (
            conn.execute("SELECT * FROM teams WHERE id = ?", (team_id,)).fetchone()
            if team_id
            else None
        )
        other_teams = conn.execute(
            "SELECT * FROM teams WHERE assignment_id = ? ORDER BY name", (row["assignment_id"],)
        ).fetchall()
        out.append(
            {
                "request": row,
                "current_team": team,
                "other_teams": [t for t in other_teams if t["id"] != team_id],
            }
        )
    return out


def approve_request(admin, request_id: int, target_team_id: int, note: str) -> None:
    from app.lib.admin_actions import move_student  # avoid a circular import at module load

    conn = get_db()
    req = conn.execute(
        "SELECT * FROM group_change_requests WHERE id = ?", (request_id,)
    ).fetchone()
    if not req or req["status"] != "pending":
        return

    move_student(admin, req["student_id"], req["assignment_id"], target_team_id)

    now = int(time.time() * 1000)
    with db_lock() as conn:
        conn.execute(
            "UPDATE group_change_requests SET status = 'approved', admin_note = ?, "
            "resolved_by_admin_id = ?, resolved_at = ? WHERE id = ?",
            (note.strip() or None, admin["id"], now, request_id),
        )
        conn.commit()

    record_audit(
        action="change_request.approved",
        actor_name=f"admin:{admin['email']}",
        team_id=target_team_id,
        detail=f"student {req['student_id']}, assignment {req['assignment_id']}",
    )


def decline_request(admin, request_id: int, note: str) -> None:
    conn = get_db()
    req = conn.execute(
        "SELECT * FROM group_change_requests WHERE id = ?", (request_id,)
    ).fetchone()
    if not req or req["status"] != "pending":
        return

    now = int(time.time() * 1000)
    with db_lock() as conn:
        conn.execute(
            "UPDATE group_change_requests SET status = 'declined', admin_note = ?, "
            "resolved_by_admin_id = ?, resolved_at = ? WHERE id = ?",
            (note.strip() or None, admin["id"], now, request_id),
        )
        conn.commit()

    record_audit(
        action="change_request.declined",
        actor_name=f"admin:{admin['email']}",
        detail=f"student {req['student_id']}, assignment {req['assignment_id']}",
    )
