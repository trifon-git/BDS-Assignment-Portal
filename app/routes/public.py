from __future__ import annotations

from fastapi import APIRouter, Form, Request
from fastapi.responses import RedirectResponse

from app.db import db_lock, get_db
from app.lib.auth import record_audit
from app.lib.ids import generate_access_token, generate_short_code, normalize_short_code
from app.lib.team_access import get_open_assignments, get_team_by_short_code, get_unassigned_students
from app.templating import render

router = APIRouter()


@router.get("/")
def landing(request: Request, error: str | None = None):
    return render(request, "index.html", error=error)


@router.post("/")
def open_team(request: Request, code: str = Form("")):
    if not code.strip():
        return RedirectResponse("/?error=empty", status_code=303)

    team = get_team_by_short_code(normalize_short_code(code))
    if not team:
        return RedirectResponse("/?error=notfound", status_code=303)

    return RedirectResponse(f"/t/{team['access_token']}", status_code=303)


@router.get("/join")
def join(request: Request, assignment: int | None = None, error: str | None = None):
    if assignment is None:
        open_assignments = get_open_assignments()
        return render(request, "join_pick.html", assignments=open_assignments)

    conn = get_db()
    row = conn.execute("SELECT * FROM assignments WHERE id = ?", (assignment,)).fetchone()
    if not row or not row["published_at"]:
        return render(request, "404.html", status_code=404)

    available = get_unassigned_students(assignment)
    return render(request, "join_form.html", assignment=row, students=available, error=error)


@router.post("/join")
def create_team(
    request: Request,
    assignmentId: int = Form(...),
    name: str = Form(""),
    members: list[int] = Form([]),
):
    back = f"/join?assignment={assignmentId}"

    def fail(message: str) -> RedirectResponse:
        from urllib.parse import quote

        return RedirectResponse(f"{back}&error={quote(message)}", status_code=303)

    name = name.strip()
    ids = [m for m in members if isinstance(m, int)]

    if not name:
        return fail("Give your team a name.")
    if not ids:
        return fail("Choose at least one member.")

    still_free = {s["id"] for s in get_unassigned_students(assignmentId)}
    if any(i not in still_free for i in ids):
        return fail(
            "Someone you picked has just joined another team for this assignment. "
            "Check the list and try again."
        )

    # Retry on the astronomically unlikely short-code collision rather than
    # showing a student a database error.
    access_token = None
    for attempt in range(5):
        try:
            with db_lock() as conn:
                access_token = generate_access_token()
                cur = conn.execute(
                    "INSERT INTO teams (assignment_id, name, access_token, short_code) "
                    "VALUES (?, ?, ?, ?)",
                    (assignmentId, name, access_token, generate_short_code()),
                )
                team_id = cur.lastrowid
                conn.executemany(
                    "INSERT INTO team_members (team_id, assignment_id, student_id) VALUES (?, ?, ?)",
                    [(team_id, assignmentId, sid) for sid in ids],
                )
                conn.commit()
            break
        except Exception:
            if attempt == 4:
                raise

    record_audit(
        action="team.created",
        actor_name="student (self-service)",
        detail=f"{name} — {len(ids)} member(s), assignment {assignmentId}",
        ip=request.client.host if request.client else None,
    )

    return RedirectResponse(f"/t/{access_token}?new=1", status_code=303)
