"""Every admin mutation.

All of them take the signed-in admin row as a parameter -- the route layer
is responsible for calling `require_admin` first, since these are plain
functions rather than routes reachable on their own.
"""

from __future__ import annotations

import time
from typing import Optional
from urllib.parse import quote

from app.config import SETTING_DEFAULTS
from app.db import db_lock, get_db
from app.lib.auth import hash_password, record_audit
from app.lib.format import from_date_time_local
from app.lib.ids import generate_access_token, generate_short_code
from app.lib.roster import is_emailish, parse_roster
from app.lib.settings import set_setting
from app.lib.storage import delete_stored_file
from app.lib.teams import copy_teams, shuffle_teams


class AdminActionError(Exception):
    """Carries a redirect target + error message, mirroring the TypeScript
    admin actions' `redirect(...)` calls that abort the function."""

    def __init__(self, redirect_to: str):
        self.redirect_to = redirect_to
        super().__init__(redirect_to)


def _err_url(base: str, param: str, message: str) -> str:
    return f"{base}?{param}={quote(message)}"


def _normalise_extensions(raw: str) -> str:
    """"ZIP, .pdf" -> "zip,pdf" """
    import re

    parts = [p.strip().lower().lstrip(".") for p in re.split(r"[,\s]+", raw) if p.strip()]
    return ",".join(parts)


# -----------------------------------------------------------------------------
# Assignments
# -----------------------------------------------------------------------------


def save_assignment(admin, form: dict) -> int:
    conn = get_db()
    id_ = int(form["id"]) if form.get("id") else None
    title = (form.get("title") or "").strip()
    due_at = from_date_time_local((form.get("dueAt") or "").strip())

    back = f"/admin/assignments/{id_}/edit" if id_ else "/admin/assignments/new"

    if not title:
        raise AdminActionError(_err_url(back, "error", "Give the assignment a title."))
    if due_at is None:
        raise AdminActionError(
            _err_url(back, "error", "That deadline is not a valid date and time.")
        )

    requires_files = form.get("requiresFiles") == "on"
    requires_video = form.get("requiresVideo") == "on"
    if not requires_files and not requires_video:
        raise AdminActionError(
            _err_url(back, "error", "An assignment must ask for files, a video, or both.")
        )

    week_raw = (form.get("weekNumber") or "").strip()
    mode = "solo" if (form.get("mode") or "").strip() == "solo" else "team"
    grouping = (form.get("grouping") or "").strip()
    if grouping not in ("copy", "students", "admin"):
        grouping = "copy"

    max_file_size_mb = max(1, min(2000, int(form.get("maxFileSizeMb") or 0) or 200))
    published = form.get("published") == "on"

    values = dict(
        title=title,
        description=form.get("description") or "",
        week_number=int(week_raw) if week_raw else None,
        mode=mode,
        grouping=grouping,
        due_at=due_at,
        accept_late=form.get("acceptLate") == "on",
        requires_files=requires_files,
        requires_video=requires_video,
        allowed_extensions=_normalise_extensions(form.get("allowedExtensions") or ""),
        max_file_size_mb=max_file_size_mb,
    )

    with db_lock() as conn:
        if id_:
            existing = conn.execute(
                "SELECT published_at FROM assignments WHERE id = ?", (id_,)
            ).fetchone()
            published_at = (existing["published_at"] or int(time.time() * 1000)) if published else None
            conn.execute(
                """
                UPDATE assignments SET title=?, description=?, week_number=?, mode=?,
                  grouping=?, due_at=?, accept_late=?, requires_files=?, requires_video=?,
                  allowed_extensions=?, max_file_size_mb=?, published_at=?
                WHERE id = ?
                """,
                (*values.values(), published_at, id_),
            )
            assignment_id = id_
        else:
            published_at = int(time.time() * 1000) if published else None
            cur = conn.execute(
                """
                INSERT INTO assignments
                  (title, description, week_number, mode, grouping, due_at, accept_late,
                   requires_files, requires_video, allowed_extensions, max_file_size_mb, published_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (*values.values(), published_at),
            )
            assignment_id = cur.lastrowid
        conn.commit()

    record_audit(
        action="assignment.updated" if id_ else "assignment.created",
        actor_name=f"admin:{admin['email']}",
        detail=title,
    )
    return assignment_id


def delete_assignment(admin, assignment_id: int) -> None:
    conn = get_db()
    assignment = conn.execute(
        "SELECT * FROM assignments WHERE id = ?", (assignment_id,)
    ).fetchone()
    if not assignment:
        return

    submissions = conn.execute(
        "SELECT * FROM submissions WHERE assignment_id = ?", (assignment_id,)
    ).fetchall()
    for s in submissions:
        for f in conn.execute(
            "SELECT * FROM submission_files WHERE submission_id = ?", (s["id"],)
        ).fetchall():
            delete_stored_file(f["stored_name"])

    with db_lock() as conn:
        conn.execute("DELETE FROM assignments WHERE id = ?", (assignment_id,))
        conn.commit()

    record_audit(
        action="assignment.deleted",
        actor_name=f"admin:{admin['email']}",
        detail=f"{assignment['title']} ({len(submissions)} submission(s))",
    )


# -----------------------------------------------------------------------------
# Review
# -----------------------------------------------------------------------------


def review_submission(admin, submission_id: int, status: Optional[str], comment: str) -> None:
    """`status` is optional: when it is None (the "Save feedback" button) the
    comment is written without touching the review status at all, for a
    delivery that is fine as-is but still worth a note.
    """
    if status and status not in ("submitted", "approved", "rework"):
        return

    comment = (comment or "").strip()
    now = int(time.time() * 1000)

    with db_lock() as conn:
        if status:
            conn.execute(
                "UPDATE submissions SET status=?, review_comment=?, reviewed_at=?, "
                "reviewed_by_admin_id=? WHERE id = ?",
                (status, comment or None, now, admin["id"], submission_id),
            )
        else:
            conn.execute(
                "UPDATE submissions SET review_comment=?, reviewed_at=?, reviewed_by_admin_id=? "
                "WHERE id = ?",
                (comment or None, now, admin["id"], submission_id),
            )
        conn.commit()

    submission = get_db().execute(
        "SELECT * FROM submissions WHERE id = ?", (submission_id,)
    ).fetchone()
    assignment = get_db().execute(
        "SELECT * FROM assignments WHERE id = ?", (submission["assignment_id"],)
    ).fetchone() if submission else None
    team = get_db().execute(
        "SELECT * FROM teams WHERE id = ?", (submission["team_id"],)
    ).fetchone() if submission else None

    record_audit(
        action=f"submission.{status}" if status else "submission.commented",
        actor_name=f"admin:{admin['email']}",
        team_id=submission["team_id"] if submission else None,
        detail=f"{assignment['title'] if assignment else ''} — {team['name'] if team else ''}",
    )


# -----------------------------------------------------------------------------
# Deadline extensions
# -----------------------------------------------------------------------------


def set_extension(admin, assignment_id: int, team_id: int, raw: str, reason: str) -> None:
    raw = (raw or "").strip()
    if not raw:
        # An empty date clears the extension and restores the shared deadline.
        with db_lock() as conn:
            conn.execute(
                "DELETE FROM deadline_extensions WHERE assignment_id = ? AND team_id = ?",
                (assignment_id, team_id),
            )
            conn.commit()
        record_audit(action="extension.cleared", actor_name=f"admin:{admin['email']}", team_id=team_id)
        return

    new_due_at = from_date_time_local(raw)
    if new_due_at is None:
        return

    with db_lock() as conn:
        conn.execute(
            """
            INSERT INTO deadline_extensions (assignment_id, team_id, new_due_at, reason)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(assignment_id, team_id)
            DO UPDATE SET new_due_at = excluded.new_due_at, reason = excluded.reason
            """,
            (assignment_id, team_id, new_due_at, reason or None),
        )
        conn.commit()

    record_audit(action="extension.set", actor_name=f"admin:{admin['email']}", team_id=team_id, detail=raw)


# -----------------------------------------------------------------------------
# Roster
# -----------------------------------------------------------------------------


def import_roster(admin, raw: str) -> tuple[int, int]:
    """Returns (added, skipped)."""
    parsed = parse_roster(raw)
    if not parsed:
        raise AdminActionError(
            _err_url("/admin/students", "error", "No names with email addresses found in that text.")
        )

    conn = get_db()
    existing = {
        r["email"].lower() for r in conn.execute("SELECT email FROM students").fetchall()
    }
    fresh = [p for p in parsed if p.email not in existing]

    if fresh:
        with db_lock() as conn:
            conn.executemany(
                "INSERT INTO students (name, email, access_token) VALUES (?, ?, ?)",
                [(p.name, p.email, generate_access_token()) for p in fresh],
            )
            conn.commit()

    record_audit(
        action="roster.imported",
        actor_name=f"admin:{admin['email']}",
        detail=f"{len(fresh)} added, {len(parsed) - len(fresh)} already present",
    )
    return len(fresh), len(parsed) - len(fresh)


def add_student(admin, name: str, email: str) -> None:
    name = (name or "").strip()
    email = (email or "").strip().lower()

    if not name:
        raise AdminActionError(_err_url("/admin/students", "error", "A name is required."))
    if not is_emailish(email):
        raise AdminActionError(
            _err_url("/admin/students", "error", f'"{email}" is not an email address.')
        )

    conn = get_db()
    clash = conn.execute("SELECT * FROM students WHERE email = ?", (email,)).fetchone()
    if clash:
        raise AdminActionError(
            _err_url(
                "/admin/students", "error", f"{email} is already on the list ({clash['name']})."
            )
        )

    with db_lock() as conn:
        conn.execute(
            "INSERT INTO students (name, email, access_token) VALUES (?, ?, ?)",
            (name, email, generate_access_token()),
        )
        conn.commit()

    record_audit(action="student.added", actor_name=f"admin:{admin['email']}", detail=f"{name} <{email}>")


def update_student(admin, student_id: int, name: str, email: str) -> None:
    name = (name or "").strip()
    email = (email or "").strip().lower()

    if not name:
        raise AdminActionError(_err_url("/admin/students", "error", "A name is required."))
    if not is_emailish(email):
        raise AdminActionError(
            _err_url("/admin/students", "error", f'"{email}" is not an email address.')
        )

    conn = get_db()
    clash = conn.execute(
        "SELECT * FROM students WHERE email = ? AND id != ?", (email, student_id)
    ).fetchone()
    if clash:
        raise AdminActionError(
            _err_url("/admin/students", "error", f"{email} already belongs to {clash['name']}.")
        )

    with db_lock() as conn:
        conn.execute(
            "UPDATE students SET name = ?, email = ? WHERE id = ?", (name, email, student_id)
        )
        conn.commit()

    record_audit(
        action="student.updated", actor_name=f"admin:{admin['email']}", detail=f"{name} <{email}>"
    )


def delete_student(admin, student_id: int) -> None:
    """Remove a student from the class list for good.

    Their solo deliveries are deleted with them, files included, because a
    solo submission whose owner is gone is not a submission any more. Team
    deliveries they happened to hand in are left alone; those belong to the
    team, and only the "submitted by" name clears.
    """
    conn = get_db()
    student = conn.execute("SELECT * FROM students WHERE id = ?", (student_id,)).fetchone()
    if not student:
        return

    solo = conn.execute(
        "SELECT * FROM submissions WHERE student_id = ?", (student_id,)
    ).fetchall()

    with db_lock() as conn:
        for submission in solo:
            for f in conn.execute(
                "SELECT * FROM submission_files WHERE submission_id = ?", (submission["id"],)
            ).fetchall():
                delete_stored_file(f["stored_name"])
            conn.execute("DELETE FROM submissions WHERE id = ?", (submission["id"],))

        # team_members cascades; submitted_by on team rows becomes null via FK.
        conn.execute("DELETE FROM students WHERE id = ?", (student_id,))
        conn.commit()

    record_audit(
        action="student.deleted",
        actor_name=f"admin:{admin['email']}",
        detail=f"{student['name']} <{student['email']}> ({len(solo)} solo delivery/deliveries removed)",
    )


def mark_link_sent(student_id: int) -> None:
    """Fired by the "Email link" button the moment it's clicked, not when
    the mail actually goes anywhere -- the app can't see past its own
    mailto: link, so this records intent to send, same honesty as every
    other mailto action in the app."""
    with db_lock() as conn:
        conn.execute(
            "UPDATE students SET link_sent_at = ? WHERE id = ?",
            (int(time.time() * 1000), student_id),
        )
        conn.commit()


def set_student_active(admin, student_id: int, active: bool) -> None:
    with db_lock() as conn:
        conn.execute("UPDATE students SET active = ? WHERE id = ?", (active, student_id))
        conn.commit()
    record_audit(
        action="student.reactivated" if active else "student.deactivated",
        actor_name=f"admin:{admin['email']}",
        detail=str(student_id),
    )


# -----------------------------------------------------------------------------
# Teams
# -----------------------------------------------------------------------------


def create_team_as_admin(admin, name: str, assignment_id: int, member_ids: list[int]) -> None:
    name = (name or "").strip()
    if not name:
        return

    with db_lock() as conn:
        cur = conn.execute(
            "INSERT INTO teams (assignment_id, name, access_token, short_code) VALUES (?, ?, ?, ?)",
            (assignment_id, name, generate_access_token(), generate_short_code()),
        )
        team_id = cur.lastrowid

        for student_id in member_ids:
            conn.execute(
                "DELETE FROM team_members WHERE student_id = ? AND assignment_id = ?",
                (student_id, assignment_id),
            )
        if member_ids:
            conn.executemany(
                "INSERT INTO team_members (team_id, assignment_id, student_id) VALUES (?, ?, ?)",
                [(team_id, assignment_id, sid) for sid in member_ids],
            )
        conn.commit()

    record_audit(
        action="team.created_by_admin",
        actor_name=f"admin:{admin['email']}",
        detail=f"{name} (assignment {assignment_id})",
    )


def copy_teams_from_assignment(admin, from_id: int, to_id: int) -> None:
    if from_id == to_id:
        return
    copied = copy_teams(from_id, to_id)
    record_audit(
        action="teams.copied",
        actor_name=f"admin:{admin['email']}",
        detail=f"{copied} team(s) from assignment {from_id} to {to_id}",
    )


def shuffle_teams_action(admin, assignment_id: int, mode: str, preferred_raw: Optional[int]):
    mode = "reshuffle" if mode == "reshuffle" else "fill"
    # Reachable by direct POST, so clamp rather than trust the submitted
    # number -- a group size of 0 or 1000 is not a real request.
    preferred = min(10, max(2, preferred_raw)) if preferred_raw else 4

    result = shuffle_teams(assignment_id, mode=mode, preferred=preferred)

    record_audit(
        action="team.shuffled",
        actor_name=f"admin:{admin['email']}",
        detail=(
            f"{mode} · created {result.created} · placed {result.placed} · "
            f"deleted {result.deleted} · protected {result.protected_teams}"
        ),
    )
    return result


def rename_team(team_id: int, name: str) -> None:
    name = (name or "").strip()
    if not name:
        return
    with db_lock() as conn:
        conn.execute("UPDATE teams SET name = ? WHERE id = ?", (name, team_id))
        conn.commit()


def regenerate_team_link(admin, team_id: int) -> None:
    with db_lock() as conn:
        conn.execute(
            "UPDATE teams SET access_token = ?, short_code = ? WHERE id = ?",
            (generate_access_token(), generate_short_code(), team_id),
        )
        conn.commit()
    record_audit(action="team.link_regenerated", actor_name=f"admin:{admin['email']}", team_id=team_id)


def _place_student(student_id: int, assignment_id: int, team_id: Optional[int]) -> None:
    """The one place membership is written.

    A student holds at most one team per assignment, so every placement is
    a delete-then-insert scoped to that assignment.
    """
    with db_lock() as conn:
        conn.execute(
            "DELETE FROM team_members WHERE student_id = ? AND assignment_id = ?",
            (student_id, assignment_id),
        )
        if team_id is not None:
            conn.execute(
                "INSERT INTO team_members (team_id, assignment_id, student_id) VALUES (?, ?, ?)",
                (team_id, assignment_id, student_id),
            )
        conn.commit()


def add_team_member(team_id: int, student_id: int) -> None:
    team = get_db().execute("SELECT * FROM teams WHERE id = ?", (team_id,)).fetchone()
    if not team:
        return
    _place_student(student_id, team["assignment_id"], team_id)


def move_student(admin, student_id: int, assignment_id: int, team_id: Optional[int]) -> None:
    _place_student(student_id, assignment_id, team_id)
    record_audit(
        action="team.member_removed" if team_id is None else "team.member_moved",
        actor_name=f"admin:{admin['email']}",
        team_id=team_id,
        detail=f"student {student_id}, assignment {assignment_id}",
    )


def remove_team_member(student_id: int, assignment_id: int) -> None:
    _place_student(student_id, assignment_id, None)


def delete_team(admin, team_id: int) -> None:
    conn = get_db()
    team = conn.execute("SELECT * FROM teams WHERE id = ?", (team_id,)).fetchone()
    if not team:
        return

    submissions = conn.execute(
        "SELECT * FROM submissions WHERE team_id = ?", (team_id,)
    ).fetchall()

    with db_lock() as conn:
        for s in submissions:
            for f in conn.execute(
                "SELECT * FROM submission_files WHERE submission_id = ?", (s["id"],)
            ).fetchall():
                delete_stored_file(f["stored_name"])
        conn.execute("DELETE FROM teams WHERE id = ?", (team_id,))
        conn.commit()

    record_audit(
        action="team.deleted",
        actor_name=f"admin:{admin['email']}",
        detail=f"{team['name']} ({len(submissions)} submission(s) removed)",
    )


# -----------------------------------------------------------------------------
# Settings and files
# -----------------------------------------------------------------------------


def save_settings(form: dict) -> None:
    for key in SETTING_DEFAULTS:
        if key in form and form[key] is not None:
            set_setting(key, str(form[key]).strip())


def update_admin_email(admin, email: str) -> None:
    email = (email or "").strip().lower()
    back = "/admin/settings"

    if not is_emailish(email):
        raise AdminActionError(_err_url(back, "emailError", "Enter a valid email address."))

    conn = get_db()
    clash = conn.execute("SELECT * FROM admins WHERE email = ?", (email,)).fetchone()
    if clash and clash["id"] != admin["id"]:
        raise AdminActionError(
            _err_url(back, "emailError", "Another admin account already uses that email.")
        )

    with db_lock() as conn:
        conn.execute("UPDATE admins SET email = ? WHERE id = ?", (email, admin["id"]))
        conn.commit()

    record_audit(
        action="admin.email_changed",
        actor_name=f"admin:{admin['email']}",
        detail=f"{admin['email']} -> {email}",
    )


def mark_notifications_seen(admin_id: int) -> None:
    """Clear the signed-in admin's notification badge.

    Called by a tiny fetch() the page fires once after paint, not during
    server render -- writing the seen-at timestamp during render would risk
    erasing the "new" markers before they were ever shown.
    """
    with db_lock() as conn:
        conn.execute(
            "UPDATE admins SET notifications_seen_at = ? WHERE id = ?",
            (int(time.time() * 1000), admin_id),
        )
        conn.commit()


def create_admin(admin, name: str, email: str, password: str) -> None:
    name = (name or "").strip()
    email = (email or "").strip().lower()
    back = "/admin/settings"

    if not name:
        raise AdminActionError(_err_url(back, "adminError", "Give the new admin a name."))
    if not is_emailish(email):
        raise AdminActionError(_err_url(back, "adminError", "Enter a valid email address."))
    if len(password) < 12:
        raise AdminActionError(
            _err_url(back, "adminError", "Use a password of at least 12 characters.")
        )

    conn = get_db()
    existing = conn.execute("SELECT * FROM admins WHERE email = ?", (email,)).fetchone()
    if existing:
        raise AdminActionError(_err_url(back, "adminError", "An admin with that email already exists."))

    with db_lock() as conn:
        conn.execute(
            "INSERT INTO admins (name, email, password_hash) VALUES (?, ?, ?)",
            (name, email, hash_password(password)),
        )
        conn.commit()

    record_audit(action="admin.created", actor_name=f"admin:{admin['email']}", detail=email)


def delete_admin(admin, target_id: int) -> None:
    back = "/admin/settings"
    if target_id == admin["id"]:
        raise AdminActionError(
            _err_url(back, "adminError", "You can't remove your own account. Ask another admin.")
        )

    conn = get_db()
    target = conn.execute("SELECT * FROM admins WHERE id = ?", (target_id,)).fetchone()
    if not target:
        return

    count = conn.execute("SELECT count(*) AS n FROM admins").fetchone()["n"]
    if count <= 1:
        raise AdminActionError(_err_url(back, "adminError", "Can't remove the last admin account."))

    with db_lock() as conn:
        conn.execute("DELETE FROM admins WHERE id = ?", (target_id,))
        conn.commit()

    record_audit(action="admin.removed", actor_name=f"admin:{admin['email']}", detail=target["email"])


def delete_submission_file(admin, file_id: int) -> None:
    conn = get_db()
    file_ = conn.execute(
        "SELECT * FROM submission_files WHERE id = ?", (file_id,)
    ).fetchone()
    if not file_:
        return

    with db_lock() as conn:
        conn.execute("DELETE FROM submission_files WHERE id = ?", (file_id,))
        conn.commit()
    delete_stored_file(file_["stored_name"])

    record_audit(
        action="file.deleted", actor_name=f"admin:{admin['email']}", detail=file_["original_name"]
    )
