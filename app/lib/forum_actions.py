"""Team forum writes.

**Not a security boundary.** The only real check below is `assert_membership`
-- it confirms the claimed author is on the team the token unlocks, nothing
more. Anyone holding a team's link can already see every member's name, so
they can post, edit, or delete as any one of them; "remember my name" in the
browser is a convenience for an honest student, not an identity check. Do
not read the membership check here as authorization -- it stops a UI
accident, not a determined teammate. Real accountability is the audit log
(actor name + IP on every write) and regenerating a team's link to rotate a
leaked one.
"""

from __future__ import annotations

import time
from typing import Optional

from app.db import db_lock, get_db
from app.lib.auth import record_audit
from app.lib.team_access import TeamContext, assert_membership

MAX_BODY_LENGTH = 4000
DUPLICATE_WINDOW_MS = 60_000
MAX_MESSAGES_PER_TEAM = 500


def post_message(
    ctx: TeamContext, author_student_id: int, body: str, parent_id: Optional[int], ip: Optional[str]
) -> Optional[str]:
    """Returns an error string, or None on success."""
    member = next((m for m in ctx.members if m["id"] == author_student_id), None)
    if not member or not assert_membership(ctx.team["id"], author_student_id):
        return "Pick your name from the list before posting."

    body = body.strip()[:MAX_BODY_LENGTH]
    if not body:
        return "Write something before sending."

    conn = get_db()

    # A reply to a reply is flattened onto the top-level message it replies
    # to -- one level deep is all the UI needs, and it keeps every query a
    # single pass with no recursion.
    resolved_parent_id = None
    if parent_id is not None:
        parent = conn.execute(
            "SELECT * FROM forum_messages WHERE id = ? AND team_id = ?",
            (parent_id, ctx.team["id"]),
        ).fetchone()
        if parent:
            resolved_parent_id = parent["parent_id"] or parent["id"]

    recent_duplicate = conn.execute(
        "SELECT 1 FROM forum_messages WHERE team_id = ? AND author_student_id = ? "
        "AND body = ? AND created_at > ?",
        (ctx.team["id"], author_student_id, body, int(time.time() * 1000) - DUPLICATE_WINDOW_MS),
    ).fetchone()
    if recent_duplicate:
        return "That looks like the message you just sent."

    count = conn.execute(
        "SELECT count(*) AS n FROM forum_messages WHERE team_id = ?", (ctx.team["id"],)
    ).fetchone()["n"]
    if count >= MAX_MESSAGES_PER_TEAM:
        return "This team's board is full. Ask your course responsible for help."

    with db_lock() as conn:
        conn.execute(
            "INSERT INTO forum_messages (team_id, parent_id, author_student_id, author_name, body) "
            "VALUES (?, ?, ?, ?, ?)",
            (ctx.team["id"], resolved_parent_id, author_student_id, member["name"], body),
        )
        conn.commit()

    record_audit(
        action="forum.posted",
        actor_name=member["name"],
        team_id=ctx.team["id"],
        # The comment itself, not just "reply"/"new thread" -- so an admin
        # reading the notifications list sees what was actually said without
        # having to open the team's forum separately.
        detail=f"{'Reply' if resolved_parent_id else 'New thread'}: {body}",
        ip=ip,
    )
    return None


def edit_message(ctx: TeamContext, message_id: int, body: str) -> tuple[bool, Optional[str]]:
    """Returns (found, error)."""
    conn = get_db()
    message = conn.execute(
        "SELECT * FROM forum_messages WHERE id = ? AND team_id = ?",
        (message_id, ctx.team["id"]),
    ).fetchone()
    if not message or message["deleted_at"]:
        return False, None

    body = body.strip()[:MAX_BODY_LENGTH]
    if not body:
        return True, "A message can't be edited down to nothing."

    with db_lock() as conn:
        conn.execute(
            "UPDATE forum_messages SET body = ?, edited_at = ? WHERE id = ?",
            (body, int(time.time() * 1000), message_id),
        )
        conn.commit()

    record_audit(action="forum.edited", actor_name=message["author_name"], team_id=ctx.team["id"])
    return True, None


def delete_message(ctx: TeamContext, message_id: int) -> bool:
    """Returns whether the message existed."""
    conn = get_db()
    message = conn.execute(
        "SELECT * FROM forum_messages WHERE id = ? AND team_id = ?",
        (message_id, ctx.team["id"]),
    ).fetchone()
    if not message or message["deleted_at"]:
        return False

    with db_lock() as conn:
        conn.execute(
            "UPDATE forum_messages SET deleted_at = ? WHERE id = ?",
            (int(time.time() * 1000), message_id),
        )
        conn.commit()

    record_audit(action="forum.deleted", actor_name=message["author_name"], team_id=ctx.team["id"])
    return True
