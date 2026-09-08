"""Admin authentication.

Students have no login at all -- a team link is their credential -- but the
admin panel holds every submission for the whole class, so it gets a real
password, a server-side session, and an audit trail.
"""

from __future__ import annotations

import sqlite3
import time
from typing import Optional

import bcrypt

from app.config import ADMIN_SESSION_DAYS
from app.db import db_lock, get_db
from app.lib.ids import generate_session_id

SESSION_MS = ADMIN_SESSION_DAYS * 24 * 60 * 60 * 1000


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt(12)).decode()


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode(), password_hash.encode())
    except ValueError:
        return False


# When the email is unknown we still run a bcrypt comparison against a dummy
# hash. Returning early would make "no such account" measurably faster than
# "wrong password" and turn the login form into an account enumerator.
_DUMMY_HASH = bcrypt.hashpw(b"not-a-real-password", bcrypt.gensalt(12)).decode()


def authenticate(email: str, password: str) -> Optional[sqlite3.Row]:
    conn = get_db()
    admin = conn.execute(
        "SELECT * FROM admins WHERE email = ?", (email.strip().lower(),)
    ).fetchone()

    ok = verify_password(password, admin["password_hash"] if admin else _DUMMY_HASH)
    return admin if (ok and admin) else None


def create_session(admin_id: int) -> str:
    session_id = generate_session_id()
    with db_lock() as conn:
        conn.execute(
            "INSERT INTO admin_sessions (id, admin_id, expires_at) VALUES (?, ?, ?)",
            (session_id, admin_id, int(time.time() * 1000) + SESSION_MS),
        )
        conn.commit()
    return session_id


def destroy_session(session_id: str) -> None:
    with db_lock() as conn:
        conn.execute("DELETE FROM admin_sessions WHERE id = ?", (session_id,))
        conn.commit()


def get_admin_by_session(session_id: Optional[str]) -> Optional[sqlite3.Row]:
    if not session_id:
        return None
    conn = get_db()
    return conn.execute(
        """
        SELECT admins.* FROM admin_sessions
        JOIN admins ON admins.id = admin_sessions.admin_id
        WHERE admin_sessions.id = ? AND admin_sessions.expires_at > ?
        """,
        (session_id, int(time.time() * 1000)),
    ).fetchone()


def prune_sessions() -> None:
    with db_lock() as conn:
        conn.execute(
            "DELETE FROM admin_sessions WHERE expires_at < ?",
            (int(time.time() * 1000),),
        )
        conn.commit()


def record_audit(
    action: str,
    actor_name: Optional[str] = None,
    team_id: Optional[int] = None,
    detail: Optional[str] = None,
    ip: Optional[str] = None,
) -> None:
    """Record an action. This is what makes a shared team link accountable:
    the roster name the student picked, plus the request IP, plus what they
    did.
    """
    with db_lock() as conn:
        conn.execute(
            "INSERT INTO audit_log (team_id, actor_name, action, detail, ip) "
            "VALUES (?, ?, ?, ?, ?)",
            (team_id, actor_name, action, detail, ip),
        )
        conn.commit()


def client_ip(request) -> Optional[str]:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    real_ip = request.headers.get("x-real-ip")
    if real_ip:
        return real_ip
    return request.client.host if request.client else None
