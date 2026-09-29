"""A student's personal page: one permanent link, reused all semester,
listing whatever group link applies to each assignment they're in. Visiting
it also sets the identity cookie that lets the group page (`/t/{token}`)
skip the "pick your name" dropdown for its owner.
"""

from __future__ import annotations

from urllib.parse import quote

from fastapi import APIRouter, Form, Request
from fastapi.responses import RedirectResponse

from app.lib.change_requests import create_change_request
from app.lib.identity import get_student_by_token, set_identity_cookie
from app.lib.personal import get_personal_dashboard
from app.db import get_db
from app.lib import team_matching as matching
from app.lib.team_access import get_unassigned_students
from app.lib.team_matching import get_answers, save_response
from app.templating import render

router = APIRouter(prefix="/s/{token}")


@router.get("")
def personal_dashboard(request: Request, token: str, error: str | None = None, requested: str | None = None):
    student = get_student_by_token(token)
    if not student:
        return render(request, "404.html", status_code=404)

    rows = get_personal_dashboard(student)
    response = render(
        request,
        "personal.html",
        student=student,
        token=token,
        rows=rows,
        error=error,
        requested=bool(requested),
        match_saved=request.query_params.get("matchSaved"),
    )
    set_identity_cookie(response, token)
    return response


@router.post("/request-change")
async def request_change(request: Request, token: str):
    student = get_student_by_token(token)
    if not student:
        return render(request, "404.html", status_code=404)

    form = await request.form()
    try:
        assignment_id = int(form.get("assignmentId"))
    except (TypeError, ValueError):
        return RedirectResponse(f"/s/{token}?error={quote('Something went wrong.')}", status_code=303)

    error = create_change_request(student["id"], assignment_id, str(form.get("reason") or ""))
    if error:
        return RedirectResponse(f"/s/{token}?error={quote(error)}", status_code=303)
    return RedirectResponse(f"/s/{token}?requested=1", status_code=303)


def _findable_assignment(student, assignment_id: int):
    """The assignment, if this student may fill in its "find a team" form:
    published, open to self-forming, and they have no team for it yet."""
    conn = get_db()
    assignment = conn.execute("SELECT * FROM assignments WHERE id = ?", (assignment_id,)).fetchone()
    if not assignment or not assignment["published_at"] or assignment["grouping"] != "students":
        return None
    return assignment


def _has_team(student_id: int, assignment_id: int) -> bool:
    return get_db().execute(
        "SELECT 1 FROM team_members WHERE student_id = ? AND assignment_id = ?",
        (student_id, assignment_id),
    ).fetchone() is not None


@router.get("/find-team/{assignment_id}")
def find_team_form(request: Request, token: str, assignment_id: int, error: str | None = None):
    student = get_student_by_token(token)
    if not student:
        return render(request, "404.html", status_code=404)
    assignment = _findable_assignment(student, assignment_id)
    if not assignment:
        return render(request, "404.html", status_code=404)
    if _has_team(student["id"], assignment_id):
        return RedirectResponse(
            f"/s/{token}?error={quote('You already have a team for this assignment, so there is nothing to fill in.')}",
            status_code=303,
        )

    return render(
        request,
        "find_team.html",
        student=student,
        token=token,
        assignment=assignment,
        answers=get_answers(assignment_id, student["id"]) or {},
        candidates=[s for s in get_unassigned_students(assignment_id) if s["id"] != student["id"]],
        error=error,
        m=matching,
    )


@router.post("/find-team/{assignment_id}")
async def find_team_submit(request: Request, token: str, assignment_id: int):
    student = get_student_by_token(token)
    if not student:
        return render(request, "404.html", status_code=404)
    assignment = _findable_assignment(student, assignment_id)
    if not assignment:
        return render(request, "404.html", status_code=404)
    if _has_team(student["id"], assignment_id):
        return RedirectResponse(
            f"/s/{token}?error={quote('You already have a team for this assignment, so there is nothing to fill in.')}",
            status_code=303,
        )

    allowed = {s["id"] for s in get_unassigned_students(assignment_id)} - {student["id"]}
    answers, error = matching.parse_answers(await request.form(), allowed)
    if error:
        return RedirectResponse(
            f"/s/{token}/find-team/{assignment_id}?error={quote(error)}", status_code=303
        )

    save_response(assignment_id, student["id"], answers)
    return RedirectResponse(f"/s/{token}?matchSaved={assignment_id}", status_code=303)
