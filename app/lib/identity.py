"""A student's personal link and the cookie that carries it.

Mirrors `team_access.py`'s "every student-facing route enters through one
auditable place" idea, but for a *person* rather than a team. Holding a
personal link is worth exactly as much as holding a team link already was --
this is not a stronger security boundary, just a way to skip the "pick your
name" dropdown when the browser already knows who it's looking at.
"""

from __future__ import annotations

import sqlite3
from typing import Optional

from fastapi import Request

from app.config import IS_PRODUCTION
from app.db import get_db

STUDENT_IDENTITY_COOKIE = "aau_student_id"
STUDENT_IDENTITY_DAYS = 365


def get_student_by_token(token: str) -> Optional[sqlite3.Row]:
    """Look up a student by their personal link token."""
    if not token:
        return None
    conn = get_db()
    return conn.execute(
        "SELECT * FROM students WHERE access_token = ? AND active = 1", (token,)
    ).fetchone()


def get_current_student(request: Request) -> Optional[sqlite3.Row]:
    """Resolve the identity cookie, if any, to a student row.

    Returns None for a missing or stale cookie -- callers fall back to the
    old "pick your name" dropdown in that case, they never fail closed.
    """
    token = request.cookies.get(STUDENT_IDENTITY_COOKIE)
    return get_student_by_token(token) if token else None


def set_identity_cookie(response, token: str) -> None:
    response.set_cookie(
        STUDENT_IDENTITY_COOKIE,
        token,
        httponly=True,
        samesite="lax",
        secure=IS_PRODUCTION,
        path="/",
        max_age=STUDENT_IDENTITY_DAYS * 24 * 60 * 60,
    )
