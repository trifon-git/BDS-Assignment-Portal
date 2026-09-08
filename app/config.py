"""Everything the app needs to know about its environment, resolved once.

DATA_DIR is the single directory the container mounts as a volume. Both the
database and the uploads live inside it, so "back up the app" means "copy one
directory" -- which is the whole reason SQLite was chosen over a separate
database server for a university-hosted deployment.
"""

import os
from pathlib import Path

DATA_DIR = Path(os.environ.get("DATA_DIR") or (Path.cwd() / ".data"))
DB_PATH = DATA_DIR / "app.db"
UPLOADS_DIR = DATA_DIR / "uploads"

# Hard ceiling on a single uploaded file, independent of the per-assignment
# cap an admin sets. Guards the disk even if an assignment is misconfigured.
MAX_UPLOAD_BYTES = int(os.environ.get("MAX_UPLOAD_MB") or 250) * 1024 * 1024

# How long an admin stays signed in.
ADMIN_SESSION_DAYS = 14
ADMIN_SESSION_COOKIE = "aau_admin_session"

# Seeded on first boot when no admin exists yet.
SEED_ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL") or ""
SEED_ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD") or ""
SEED_ADMIN_NAME = os.environ.get("ADMIN_NAME") or "Course responsible"

TIMEZONE = os.environ.get("TIMEZONE") or "Europe/Copenhagen"

IS_PRODUCTION = os.environ.get("ENVIRONMENT", "production") == "production"

# Defaults for the settings table; admin-editable at /admin/settings.
SETTING_DEFAULTS = {
    "semester_name": "BDS — Autumn 2026",
    # Short prefix for emails an admin sends by hand, e.g. "BDS · Week 4 ·
    # Group 2 - ...". Kept separate from semester_name, which is too long for
    # a subject line.
    "course_code": "BDS",
    # Hosts we consider a legitimate place to put a screencast. Panopto
    # first: it is the tool AAU supports and the one we point students at.
    "video_hosts": (
        "panopto.eu,panopto.com,aau.dk,sharepoint.com,onedrive.live.com,"
        "1drv.ms,teams.microsoft.com,youtube.com,youtu.be,vimeo.com"
    ),
    "default_max_file_size_mb": "200",
    # Who a student writes to when their link stops working. There is no
    # password reset in a system with no passwords, so this address is the
    # entire recovery path and it appears on every student-facing page.
    "support_email": "trka@business.aau.dk",
}
