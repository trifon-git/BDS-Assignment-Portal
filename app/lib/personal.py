"""What a student sees on their own personal page: one row per published
assignment, with whatever group link applies to it right now."""

from __future__ import annotations

import sqlite3
from typing import List

from app.db import get_db
from app.lib.admin_data import order_published_assignments
from app.lib.change_requests import get_requests_for_student


def get_personal_dashboard(student: sqlite3.Row) -> List[dict]:
    conn = get_db()
    assignments = order_published_assignments(
        conn.execute(
            "SELECT * FROM assignments WHERE published_at IS NOT NULL ORDER BY due_at"
        ).fetchall()
    )
    memberships = {
        row["assignment_id"]: row["team_id"]
        for row in conn.execute(
            "SELECT assignment_id, team_id FROM team_members WHERE student_id = ?",
            (student["id"],),
        ).fetchall()
    }
    requests_by_assignment = get_requests_for_student(student["id"])

    rows = []
    for assignment in assignments:
        team_id = memberships.get(assignment["id"])
        team = (
            conn.execute("SELECT * FROM teams WHERE id = ?", (team_id,)).fetchone()
            if team_id
            else None
        )
        rows.append(
            {
                "assignment": assignment,
                "team": team,
                "can_self_join": team is None and assignment["grouping"] == "students",
                "change_request": requests_by_assignment.get(assignment["id"]),
            }
        )
    return rows
