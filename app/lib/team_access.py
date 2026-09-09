"""Resolving a team link into a team and its members. Every student-facing
route enters through here, which keeps "what does holding this link entitle
you to" in one auditable place.
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from typing import List, Optional

from app.db import get_db


@dataclass
class TeamContext:
    team: sqlite3.Row
    assignment: sqlite3.Row
    members: List[sqlite3.Row]


def get_team_by_token(token: str) -> Optional[TeamContext]:
    """Look up a team by the token in its URL. Returns None for an unknown
    token."""
    if not token:
        return None
    conn = get_db()
    team = conn.execute("SELECT * FROM teams WHERE access_token = ?", (token,)).fetchone()
    if not team:
        return None
    assignment = conn.execute(
        "SELECT * FROM assignments WHERE id = ?", (team["assignment_id"],)
    ).fetchone()
    return TeamContext(team=team, assignment=assignment, members=get_team_members(team["id"]))


def get_team_by_short_code(code: str) -> Optional[sqlite3.Row]:
    """Look up a team by the code a student typed on the landing page."""
    if not code:
        return None
    conn = get_db()
    return conn.execute("SELECT * FROM teams WHERE short_code = ?", (code,)).fetchone()


def get_team_members(team_id: int) -> List[sqlite3.Row]:
    conn = get_db()
    return conn.execute(
        """
        SELECT students.* FROM team_members
        JOIN students ON students.id = team_members.student_id
        WHERE team_members.team_id = ?
        ORDER BY students.name
        """,
        (team_id,),
    ).fetchall()


def assert_membership(team_id: int, student_id: int) -> bool:
    """Confirm a student is actually on the team whose link was used.

    The "Submitted by" dropdown only ever offers team members, but this
    endpoint is reachable by direct POST, so the server re-checks rather
    than trusting the submitted id.
    """
    conn = get_db()
    row = conn.execute(
        "SELECT 1 FROM team_members WHERE team_id = ? AND student_id = ?",
        (team_id, student_id),
    ).fetchone()
    return row is not None


def get_unassigned_students(assignment_id: int) -> List[sqlite3.Row]:
    """Students not yet grouped **for this assignment**, for the /join
    dropdown and the admin panel's "not in a team" list.
    """
    conn = get_db()
    return conn.execute(
        """
        SELECT students.* FROM students
        LEFT JOIN team_members
          ON team_members.student_id = students.id
         AND team_members.assignment_id = ?
        WHERE team_members.id IS NULL AND students.active = 1
        ORDER BY students.name
        """,
        (assignment_id,),
    ).fetchall()


def get_open_assignments() -> List[sqlite3.Row]:
    """Published assignments a student can still self-form a team for.

    Only `grouping = 'students'` assignments qualify -- self-service team
    creation is opt-in per assignment, set by the admin in the assignment
    form. For `admin` or `copy` grouping, teams are placed by the admin and
    this flow is not offered.
    """
    conn = get_db()
    return conn.execute(
        "SELECT * FROM assignments WHERE published_at IS NOT NULL AND grouping = 'students' "
        "ORDER BY due_at"
    ).fetchall()


def get_submission(
    assignment_id: int, team_id: int, student_id: Optional[int]
) -> Optional[sqlite3.Row]:
    """The team's submission for one assignment.

    For a team assignment pass `student_id=None` to get the single shared
    row; for a solo assignment pass the member's id to get theirs. This
    mirrors the two partial unique indexes on the table.
    """
    conn = get_db()
    if student_id is None:
        return conn.execute(
            "SELECT * FROM submissions WHERE assignment_id = ? AND team_id = ? "
            "AND student_id IS NULL",
            (assignment_id, team_id),
        ).fetchone()
    return conn.execute(
        "SELECT * FROM submissions WHERE assignment_id = ? AND team_id = ? "
        "AND student_id = ?",
        (assignment_id, team_id, student_id),
    ).fetchone()


def get_submission_files(submission_id: int) -> List[sqlite3.Row]:
    conn = get_db()
    return conn.execute(
        "SELECT * FROM submission_files WHERE submission_id = ? ORDER BY id",
        (submission_id,),
    ).fetchall()
