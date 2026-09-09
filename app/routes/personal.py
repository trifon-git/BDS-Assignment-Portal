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
