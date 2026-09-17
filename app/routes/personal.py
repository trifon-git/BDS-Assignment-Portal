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
from app.lib.settings import get_setting
from app.lib.team_shuffle import QUESTIONS, get_answers, save_response
from app.templating import render

router = APIRouter(prefix="/s/{token}")


@router.get("")
def personal_dashboard(request: Request, token: str, error: str | None = None, requested: str | None = None):
    student = get_student_by_token(token)
    if not student:
        return render(request, "404.html", status_code=404)

    rows = get_personal_dashboard(student)
    team_shuffle_enabled = get_setting("team_shuffle_enabled") == "1"
    response = render(
        request,
        "personal.html",
        student=student,
        token=token,
        rows=rows,
        error=error,
        requested=bool(requested),
        team_shuffle_enabled=team_shuffle_enabled,
        team_shuffle_questions=QUESTIONS,
        team_shuffle_answers=get_answers(student["id"]) if team_shuffle_enabled else None,
        team_shuffle_saved=bool(request.query_params.get("shuffleSaved")),
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


@router.post("/team-shuffle")
async def team_shuffle_submit(request: Request, token: str):
    student = get_student_by_token(token)
    if not student:
        return render(request, "404.html", status_code=404)

    if get_setting("team_shuffle_enabled") != "1":
        return RedirectResponse(f"/s/{token}", status_code=303)

    form = await request.form()
    answers = {}
    for q in QUESTIONS:
        raw = form.get(q["key"])
        try:
            value = int(raw)
        except (TypeError, ValueError):
            return RedirectResponse(
                f"/s/{token}?error={quote('Please answer every question before submitting.')}",
                status_code=303,
            )
        if not (0 <= value < len(q["options"])):
            return RedirectResponse(
                f"/s/{token}?error={quote('Please answer every question before submitting.')}",
                status_code=303,
            )
        answers[q["key"]] = value

    save_response(student["id"], answers)
    return RedirectResponse(f"/s/{token}?shuffleSaved=1", status_code=303)
