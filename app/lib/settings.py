"""Admin-editable settings, read through a defaults map so a missing row
never breaks a page and adding a setting never needs a migration.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from app.config import SETTING_DEFAULTS
from app.db import db_lock, get_db


def get_setting(key: str) -> str:
    conn = get_db()
    row = conn.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
    return row["value"] if row else SETTING_DEFAULTS[key]


def get_all_settings() -> dict[str, str]:
    conn = get_db()
    rows = conn.execute("SELECT key, value FROM settings").fetchall()
    stored = {r["key"]: r["value"] for r in rows}
    return {key: stored.get(key, fallback) for key, fallback in SETTING_DEFAULTS.items()}


def set_setting(key: str, value: str) -> None:
    with db_lock() as conn:
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (key, value),
        )
        conn.commit()


@dataclass(frozen=True)
class VideoUrlCheck:
    valid: bool
    host: Optional[str]
    message: Optional[str]


def check_video_url(raw: str) -> VideoUrlCheck:
    """Validate a video link.

    Any host is accepted -- there's no allow-list. The only real
    requirements are that it's a real http(s) link and that the student
    has confirmed they've set sharing on it, which is checked separately
    in `submit.py`.
    """
    from urllib.parse import urlparse

    trimmed = raw.strip()
    if not trimmed:
        return VideoUrlCheck(False, None, "A video link is required for this assignment.")

    parsed = urlparse(trimmed)
    if not parsed.scheme or not parsed.netloc:
        return VideoUrlCheck(
            False,
            None,
            "That does not look like a link. Paste the full address, starting with https://",
        )

    if parsed.scheme not in ("http", "https"):
        return VideoUrlCheck(False, parsed.hostname, "The link must start with https://")

    return VideoUrlCheck(True, parsed.hostname, None)
