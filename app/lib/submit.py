"""Recording a delivery.

Every rule that decides whether a submission is accepted lives here, and
the upload route is a thin wrapper over it. That matters because the route
is reachable by direct POST -- a student could construct one by hand -- so
none of these checks may live only in the form.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import List, Optional
from urllib.parse import urlparse

from app.db import db_lock, get_db
from app.lib.auth import record_audit
from app.lib.dashboard import get_effective_deadline
from app.lib.settings import check_video_url, get_setting
from app.lib.storage import StoredFile, delete_stored_file
from app.lib.team_access import assert_membership, get_team_by_token


@dataclass
class SubmitInput:
    token: str
    assignment_id: int
    submitted_by_student_id: int
    student_id: Optional[int]
    video_url: str
    video_share_confirmed: bool
    link_url: str
    note: str
    files: List[StoredFile] = field(default_factory=list)
    rejected: List[dict] = field(default_factory=list)
    keep_existing_files: bool = False


@dataclass
class SubmitResult:
    ok: bool
    submission_id: Optional[int] = None
    is_late: bool = False
    error: Optional[str] = None


def _fail(input_: SubmitInput, error: str) -> SubmitResult:
    """Discard anything already written to disk before returning an error,
    so a rejected attempt never leaves orphaned bytes in the uploads
    directory."""
    for f in input_.files:
        delete_stored_file(f.stored_name)
    return SubmitResult(ok=False, error=error)


def submit_delivery(input_: SubmitInput, ip: Optional[str] = None) -> SubmitResult:
    ctx = get_team_by_token(input_.token)
    if not ctx:
        return _fail(input_, "That team link is not valid.")
    team = ctx.team

    conn = get_db()
    assignment = conn.execute(
        "SELECT * FROM assignments WHERE id = ?", (input_.assignment_id,)
    ).fetchone()
    if not assignment:
        return _fail(input_, "That assignment does not exist.")
    if not assignment["published_at"]:
        return _fail(input_, "That assignment has not been published yet.")
    # A team is formed for one assignment. This endpoint is reachable by
    # direct POST, so the pairing is re-checked here and not just in the
    # page that rendered the form -- otherwise one week's code could
    # deliver to another's.
    if assignment["id"] != team["assignment_id"]:
        return _fail(
            input_,
            "That team code belongs to a different assignment. Use the code for this one.",
        )

    # -- who is delivering --------------------------------------------------
    if not assert_membership(team["id"], input_.submitted_by_student_id):
        return _fail(input_, "Choose your name from the list before delivering.")

    student_id = None
    if assignment["mode"] == "solo":
        # A solo delivery must name the person it belongs to, and that
        # person must be on this team -- otherwise one team could deliver
        # on another's behalf.
        student_id = input_.student_id or input_.submitted_by_student_id
        if not assert_membership(team["id"], student_id):
            return _fail(input_, "That person is not a member of this team.")

    # -- is the window open ---------------------------------------------------
    deadline = get_effective_deadline(assignment, team["id"])
    if not deadline.can_submit:
        return _fail(
            input_,
            "The deadline has passed and this assignment does not accept late deliveries.",
        )

    # -- requirements -----------------------------------------------------------
    if student_id is None:
        existing = conn.execute(
            "SELECT * FROM submissions WHERE assignment_id = ? AND team_id = ? "
            "AND student_id IS NULL",
            (assignment["id"], team["id"]),
        ).fetchone()
    else:
        existing = conn.execute(
            "SELECT * FROM submissions WHERE assignment_id = ? AND team_id = ? "
            "AND student_id = ?",
            (assignment["id"], team["id"], student_id),
        ).fetchone()

    existing_files = []
    if existing:
        existing_files = conn.execute(
            "SELECT * FROM submission_files WHERE submission_id = ?", (existing["id"],)
        ).fetchall()

    kept_files = existing_files if input_.keep_existing_files else []
    total_files = len(input_.files) + len(kept_files)

    link_url_raw = input_.link_url.strip()
    link_url = None
    if link_url_raw:
        parsed = urlparse(link_url_raw)
        if parsed.scheme not in ("http", "https") or not parsed.netloc:
            return _fail(
                input_,
                "That does not look like a link. Paste the full address, starting with https://",
            )
        link_url = link_url_raw

    # A link to hosted code (a Colab notebook, a GitHub repo) satisfies
    # "needs files" just as well as an upload does -- a team can give
    # either, or both.
    if assignment["requires_files"] and total_files == 0 and not link_url:
        because = ""
        if input_.rejected:
            because = " (" + "; ".join(
                f"{r['filename']}: {r['reason']}" for r in input_.rejected
            ) + ")"
        return _fail(
            input_,
            f"This assignment needs at least one file, or a link to your code{because}.",
        )

    video_url = input_.video_url.strip() or None
    if assignment["requires_video"]:
        hosts = get_setting("video_hosts")
        check = check_video_url(input_.video_url, hosts)
        if not check.valid:
            return _fail(input_, check.message or "Invalid video link.")
        if not input_.video_share_confirmed:
            return _fail(
                input_,
                "Confirm that you have set the sharing on the video so AAU staff can watch it.",
            )
        video_url = input_.video_url.strip()

    # -- write --------------------------------------------------------------------
    now = int(time.time() * 1000)
    is_late = deadline.would_be_late

    with db_lock() as conn:
        if existing:
            conn.execute(
                """
                UPDATE submissions SET
                  submitted_by_student_id = ?, video_url = ?, video_share_confirmed = ?,
                  link_url = ?, note = ?, submitted_at = ?, is_late = ?,
                  status = 'submitted', review_comment = NULL, reviewed_at = NULL,
                  reviewed_by_admin_id = NULL
                WHERE id = ?
                """,
                (
                    input_.submitted_by_student_id,
                    video_url,
                    input_.video_share_confirmed,
                    link_url,
                    input_.note.strip() or None,
                    now,
                    is_late,
                    existing["id"],
                ),
            )
            submission_id = existing["id"]

            if not input_.keep_existing_files:
                conn.execute(
                    "DELETE FROM submission_files WHERE submission_id = ?",
                    (existing["id"],),
                )
        else:
            cur = conn.execute(
                """
                INSERT INTO submissions
                  (assignment_id, team_id, student_id, submitted_by_student_id,
                   video_url, video_share_confirmed, link_url, note, submitted_at, is_late)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    assignment["id"],
                    team["id"],
                    student_id,
                    input_.submitted_by_student_id,
                    video_url,
                    input_.video_share_confirmed,
                    link_url,
                    input_.note.strip() or None,
                    now,
                    is_late,
                ),
            )
            submission_id = cur.lastrowid

        if input_.files:
            conn.executemany(
                "INSERT INTO submission_files "
                "(submission_id, original_name, stored_name, size_bytes, mime_type) "
                "VALUES (?, ?, ?, ?, ?)",
                [
                    (submission_id, f.original_name, f.stored_name, f.size_bytes, f.mime_type)
                    for f in input_.files
                ],
            )

        conn.commit()

    # Only once the database is consistent do the old bytes go. Doing this
    # earlier would leave files deleted but rows intact on a failure.
    if existing and not input_.keep_existing_files:
        for f in existing_files:
            delete_stored_file(f["stored_name"])

    actor = next((m for m in ctx.members if m["id"] == input_.submitted_by_student_id), None)
    record_audit(
        action="submission.replaced" if existing else "submission.created",
        actor_name=actor["name"] if actor else f"student:{input_.submitted_by_student_id}",
        team_id=team["id"],
        detail=f"{assignment['title']}{' (late)' if is_late else ''} — {total_files} file(s)",
        ip=ip,
    )

    return SubmitResult(ok=True, submission_id=submission_id, is_late=is_late)


def requirement_summary(assignment) -> str:
    """Used by the page to describe what an assignment wants, in one
    sentence."""
    parts = []
    if assignment["requires_files"]:
        exts = [
            e.strip().upper()
            for e in assignment["allowed_extensions"].split(",")
            if e.strip()
        ]
        parts.append(
            f"{' or '.join(exts)} file(s), or a link to your code"
            if exts
            else "one or more files, or a link to your code"
        )
    if assignment["requires_video"]:
        parts.append("a video link")
    if not parts:
        return "Nothing to upload — just confirm below."
    return f"This assignment needs {' and '.join(parts)}."
