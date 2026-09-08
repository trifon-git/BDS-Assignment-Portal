"""Shared FastAPI dependencies: the admin-session guard.

Mirrors `requireAdmin()` from the Next.js app -- reachable from any handler,
redirects to the login page rather than raising when there is no admin,
since a POST here always means a browser form.
"""

from __future__ import annotations

import sqlite3

from fastapi import Request
from fastapi.responses import RedirectResponse

from app.config import ADMIN_SESSION_COOKIE
from app.lib.auth import get_admin_by_session


class RedirectException(Exception):
    """Raised by a dependency or route to short-circuit straight to a
    redirect; caught by the handler registered in main.py."""

    def __init__(self, location: str, status_code: int = 303):
        self.location = location
        self.status_code = status_code
        super().__init__(location)


def get_current_admin(request: Request) -> sqlite3.Row | None:
    session_id = request.cookies.get(ADMIN_SESSION_COOKIE)
    return get_admin_by_session(session_id)


def require_admin(request: Request) -> sqlite3.Row:
    admin = get_current_admin(request)
    if not admin:
        raise RedirectException("/admin/login")
    return admin


def redirect_exception_handler(request: Request, exc: RedirectException) -> RedirectResponse:
    return RedirectResponse(exc.location, status_code=exc.status_code)
