"""One SQLite connection per process, opened on first use and cached at
module level.

**Lazy on purpose.** Nothing should open a database connection just because a
module imported this one -- a test importing a pure-function module must not
require a working DATA_DIR.

**Cached on purpose.** A single `sqlite3.Connection` is reused for the whole
process; FastAPI's default threadpool for sync endpoints means multiple
threads may call in, so the connection is opened with `check_same_thread=False`
and a `threading.Lock` serializes writes the same way SQLite itself would
under WAL with a busy timeout.
"""

from __future__ import annotations

import re
import sqlite3
import threading
from pathlib import Path

from app.config import DATA_DIR, DB_PATH, UPLOADS_DIR

_lock = threading.Lock()
_connection: sqlite3.Connection | None = None

MIGRATIONS_DIR = Path(__file__).resolve().parent.parent / "drizzle"


def _open() -> sqlite3.Connection:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    UPLOADS_DIR.mkdir(parents=True, exist_ok=True)

    conn = sqlite3.connect(str(DB_PATH), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    # First, so every pragma below waits its turn rather than throwing the
    # moment another process holds the lock.
    conn.execute("PRAGMA busy_timeout = 5000")
    # WAL lets the admin panel read while a student's submission is being
    # written, which is the only real concurrency this app ever sees.
    conn.execute("PRAGMA journal_mode = WAL")
    # Without this, ON DELETE CASCADE is silently ignored -- SQLite has
    # foreign keys off by default per connection.
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def get_db() -> sqlite3.Connection:
    global _connection
    if _connection is None:
        with _lock:
            if _connection is None:
                _connection = _open()
    return _connection


class db_lock:
    """Serializes a write transaction across threads in this process."""

    def __enter__(self):
        _lock.acquire()
        return get_db()

    def __exit__(self, *exc):
        _lock.release()


def run_migrations() -> None:
    """Applies any pending migrations from ./drizzle, tracked in a
    schema_migrations table. Called at boot so a fresh container comes up
    with a working database and nobody has to run a migration step by hand.
    """
    conn = get_db()
    conn.execute(
        "CREATE TABLE IF NOT EXISTS schema_migrations "
        "(name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000))"
    )
    conn.commit()

    if not MIGRATIONS_DIR.exists():
        return

    applied = {
        row["name"] for row in conn.execute("SELECT name FROM schema_migrations")
    }

    for path in sorted(MIGRATIONS_DIR.glob("*.sql")):
        if path.name in applied:
            continue

        sql = path.read_text(encoding="utf-8")
        statements = [
            s.strip()
            for s in re.split(r"--> statement-breakpoint", sql)
            if s.strip()
        ]
        # Committed after EVERY statement, not just at the end of the file:
        # a migration may itself flip `PRAGMA foreign_keys`, and SQLite only
        # honours that pragma with no transaction open. Python's sqlite3
        # driver opens an implicit transaction before DML (DELETE/INSERT/
        # UPDATE) and leaves it open until a commit, so a mid-file DELETE
        # followed by `PRAGMA foreign_keys = ON` would otherwise silently
        # no-op the pragma -- leaving cascade deletes broken for the rest of
        # the connection's life without a single error anywhere.
        for statement in statements:
            conn.execute(statement)
            conn.commit()
        conn.execute("INSERT INTO schema_migrations (name) VALUES (?)", (path.name,))
        conn.commit()

    # Belt and braces: whatever the migrations did internally, foreign keys
    # must be on before the app serves a single request, or every ON DELETE
    # CASCADE in the schema silently stops working.
    conn.execute("PRAGMA foreign_keys = ON")
    if conn.execute("PRAGMA foreign_keys").fetchone()[0] != 1:
        raise RuntimeError("Failed to enable PRAGMA foreign_keys after migrations")


def close_db() -> None:
    global _connection
    if _connection is not None:
        _connection.close()
        _connection = None
