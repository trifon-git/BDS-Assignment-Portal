"""The single choke point for reading and writing uploaded files.

Nothing else in the app touches the filesystem, so the rules that keep a
student-supplied filename from escaping the uploads directory live in
exactly one place.
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from app.config import MAX_UPLOAD_BYTES, UPLOADS_DIR
from app.lib.ids import generate_stored_name

_STORED_NAME_RE = re.compile(r"^[0-9a-f-]{36}$", re.IGNORECASE)

# Characters that are illegal in a Windows path or confusing in a ZIP entry.
_ILLEGAL_NAME_CHARS = set('<>:"|?*/\\')


@dataclass
class StoredFile:
    stored_name: str
    original_name: str
    size_bytes: int
    mime_type: Optional[str]


class UploadTooLargeError(Exception):
    def __init__(self, actual: int, limit: int):
        self.actual = actual
        self.limit = limit
        super().__init__(
            f"Upload is {actual / 1024 / 1024:.1f} MB, which exceeds the "
            f"{limit / 1024 / 1024:.0f} MB limit"
        )


def resolve_stored_path(stored_name: str) -> Path:
    """Absolute path for a stored file, refusing anything that isn't a bare
    UUID.

    `stored_name` always comes from our own generator, but a download route
    reads it back out of the URL, so it is validated rather than trusted: a
    value like "../../app.db" must never resolve.
    """
    if not _STORED_NAME_RE.match(stored_name):
        raise ValueError(f"Refusing to resolve suspicious stored name: {stored_name}")
    full = (UPLOADS_DIR / stored_name).resolve()
    if full.parent != UPLOADS_DIR.resolve():
        raise ValueError("Resolved path escaped the uploads directory")
    return full


def sanitize_filename(name: str) -> str:
    """Strip a browser-supplied filename down to something safe to show and
    to place inside a ZIP. Keeps it recognisable to the student who uploaded
    it; the name on disk is a UUID regardless.
    """
    base = re.split(r"[\\/]", name)[-1] or "file"

    cleaned = ""
    for ch in base:
        code = ord(ch)
        if code < 0x20 or code == 0x7F:
            continue
        cleaned += "_" if ch in _ILLEGAL_NAME_CHARS else ch

    # Leading dots would hide the file, or produce "." / ".." entries.
    cleaned = re.sub(r"^\.+", "", cleaned).strip()
    return cleaned[:180] or "file"


def store_upload(upload, max_bytes: int = MAX_UPLOAD_BYTES) -> StoredFile:
    """Stream one uploaded file to disk.

    Streaming rather than buffering matters here: a 200 MB ZIP held in
    memory would be a real problem on a shared university VM with several
    teams submitting in the last ten minutes before a Friday deadline.
    `upload` is a FastAPI `UploadFile`, whose `.file` is already a
    `SpooledTemporaryFile` -- reading it in chunks keeps memory flat
    regardless of upload size.
    """
    UPLOADS_DIR.mkdir(parents=True, exist_ok=True)

    stored_name = generate_stored_name()
    destination = UPLOADS_DIR / stored_name

    written = 0
    try:
        with open(destination, "wb") as out:
            while True:
                chunk = upload.file.read(1024 * 1024)
                if not chunk:
                    break
                written += len(chunk)
                if written > max_bytes:
                    raise UploadTooLargeError(written, max_bytes)
                out.write(chunk)
    except Exception:
        destination.unlink(missing_ok=True)
        raise

    return StoredFile(
        stored_name=stored_name,
        original_name=sanitize_filename(upload.filename or "file"),
        size_bytes=written,
        mime_type=upload.content_type or None,
    )


def delete_stored_file(stored_name: str) -> None:
    try:
        resolve_stored_path(stored_name).unlink(missing_ok=True)
    except ValueError:
        pass


def extension_allowed(filename: str, allowed: str) -> bool:
    """Extension check, matching the assignment's allow-list."""
    allow_list = [
        s.strip().lower().lstrip(".") for s in allowed.split(",") if s.strip()
    ]
    if not allow_list:
        return True
    ext = Path(filename).suffix.lstrip(".").lower()
    return ext in allow_list


def format_bytes(n: int) -> str:
    if n < 1024:
        return f"{n} B"
    if n < 1024 * 1024:
        return f"{n / 1024:.0f} KB"
    return f"{n / 1024 / 1024:.1f} MB"
