from __future__ import annotations

from typing import List, Optional
from urllib.parse import quote

from fastapi import APIRouter, Form, Request
from fastapi.responses import RedirectResponse
from starlette.datastructures import UploadFile

from app.config import MAX_UPLOAD_BYTES
from app.lib.auth import client_ip
from app.lib.dashboard import get_team_dashboard
from app.lib.forum import get_team_forum
from app.lib.forum_actions import delete_message, edit_message, post_message
from app.lib.identity import get_current_student
from app.lib.storage import UploadTooLargeError, extension_allowed, store_upload
from app.lib.submit import SubmitInput, requirement_summary, submit_delivery
from app.lib.team_access import assert_membership, get_team_by_token
from app.templating import render

router = APIRouter(prefix="/t/{token}")


def _load(token: str):
    ctx = get_team_by_token(token)
    return ctx


def _identity_for(request: Request, ctx):
    """The cookie's student, but only when they actually belong to this
    team -- a link passed to someone outside the team must still fall back
    to the old name-picker, never assume the wrong person."""
    student = get_current_student(request)
    if student and assert_membership(ctx.team["id"], student["id"]):
        return student
    return None


@router.get("")
def dashboard(request: Request, token: str, forumError: Optional[str] = None, new: Optional[str] = None):
    ctx = _load(token)
    if not ctx:
        return render(request, "404.html", status_code=404)

    cards = get_team_dashboard(ctx.team["id"], ctx.members, ctx.assignment["id"])
    forum = get_team_forum(ctx.team["id"])

    return render(
        request,
        "team_dashboard.html",
        team=ctx.team,
        assignment=ctx.assignment,
        members=ctx.members,
        cards=cards,
        forum=forum,
        token=token,
        forum_error=forumError,
        just_created=bool(new),
        current_student=_identity_for(request, ctx),
    )


@router.get("/a/{assignment_id}")
def assignment_detail(request: Request, token: str, assignment_id: int, error: Optional[str] = None):
    ctx = _load(token)
    if not ctx or ctx.assignment["id"] != assignment_id:
        return render(request, "404.html", status_code=404)

    cards = get_team_dashboard(ctx.team["id"], ctx.members, ctx.assignment["id"])
    if not cards:
        return render(request, "404.html", status_code=404)
    card = cards[0]

    return render(
        request,
        "team_assignment.html",
        team=ctx.team,
        assignment=ctx.assignment,
        members=ctx.members,
        card=card,
        token=token,
        error=error,
        requirement_summary=requirement_summary(ctx.assignment),
        current_student=_identity_for(request, ctx),
    )


@router.post("/a/{assignment_id}")
async def submit(request: Request, token: str, assignment_id: int):
    ctx = _load(token)
    back = f"/t/{token}/a/{assignment_id}"

    def fail(message: str) -> RedirectResponse:
        return RedirectResponse(f"{back}?error={quote(message)}", status_code=303)

    if not ctx or ctx.assignment["id"] != assignment_id:
        return render(request, "404.html", status_code=404)

    form = await request.form()
    assignment = ctx.assignment

    identity = _identity_for(request, ctx)
    submitted_by_raw = form.get("submittedBy")
    if identity:
        submitted_by_student_id = identity["id"]
    else:
        try:
            submitted_by_student_id = int(submitted_by_raw)
        except (TypeError, ValueError):
            return fail("Choose your name from the list before delivering.")

    if identity and assignment["mode"] == "solo":
        student_id = identity["id"]
    else:
        student_id_raw = form.get("studentId")
        student_id = int(student_id_raw) if student_id_raw else None

    allowed = assignment["allowed_extensions"]
    max_bytes = min(assignment["max_file_size_mb"] * 1024 * 1024, MAX_UPLOAD_BYTES)

    stored_files = []
    rejected = []
    uploads = form.getlist("files")
    for upload in uploads:
        if not isinstance(upload, UploadFile) or not upload.filename:
            continue
        if not extension_allowed(upload.filename, allowed):
            rejected.append(
                {"filename": upload.filename, "reason": f"only {allowed.replace(',', ', ')} files are accepted"}
            )
            continue
        try:
            stored_files.append(store_upload(upload, max_bytes))
        except UploadTooLargeError:
            rejected.append(
                {
                    "filename": upload.filename,
                    "reason": f"larger than {round(max_bytes / 1024 / 1024)} MB",
                }
            )

    input_ = SubmitInput(
        token=token,
        assignment_id=assignment_id,
        submitted_by_student_id=submitted_by_student_id,
        student_id=student_id,
        video_url=str(form.get("videoUrl") or ""),
        video_share_confirmed=form.get("videoShareConfirmed") == "on",
        link_url=str(form.get("linkUrl") or ""),
        note=str(form.get("note") or ""),
        files=stored_files,
        rejected=rejected,
        keep_existing_files=form.get("keepExistingFiles") == "on",
    )

    result = submit_delivery(input_, ip=client_ip(request))
    if not result.ok:
        return fail(result.error or "Something went wrong.")

    return RedirectResponse(f"{back}?delivered=1", status_code=303)


# -- forum --------------------------------------------------------------------


@router.post("/forum/post")
async def forum_post(request: Request, token: str):
    ctx = _load(token)
    if not ctx:
        return render(request, "404.html", status_code=404)

    form = await request.form()
    identity = _identity_for(request, ctx)
    if identity:
        author_id = identity["id"]
    else:
        try:
            author_id = int(form.get("authorStudentId"))
        except (TypeError, ValueError):
            author_id = -1
    parent_raw = form.get("parentId")
    parent_id = int(parent_raw) if parent_raw else None

    error = post_message(ctx, author_id, str(form.get("body") or ""), parent_id, client_ip(request))
    if error:
        return RedirectResponse(f"/t/{token}?forumError={quote(error)}#forum", status_code=303)
    return RedirectResponse(f"/t/{token}#forum", status_code=303)


@router.post("/forum/edit")
async def forum_edit(request: Request, token: str):
    ctx = _load(token)
    if not ctx:
        return render(request, "404.html", status_code=404)

    form = await request.form()
    message_id = int(form.get("messageId"))
    found, error = edit_message(ctx, message_id, str(form.get("body") or ""))
    if not found:
        return render(request, "404.html", status_code=404)
    if error:
        return RedirectResponse(f"/t/{token}?forumError={quote(error)}#forum", status_code=303)
    return RedirectResponse(f"/t/{token}#forum", status_code=303)


@router.post("/forum/delete")
async def forum_delete(request: Request, token: str):
    ctx = _load(token)
    if not ctx:
        return render(request, "404.html", status_code=404)

    form = await request.form()
    message_id = int(form.get("messageId"))
    found = delete_message(ctx, message_id)
    if not found:
        return render(request, "404.html", status_code=404)
    return RedirectResponse(f"/t/{token}#forum", status_code=303)
