from __future__ import annotations

from typing import Optional
from urllib.parse import quote

from fastapi import APIRouter, Depends, Form, Request
from fastapi.responses import RedirectResponse, Response

from app.config import ADMIN_SESSION_COOKIE, ADMIN_SESSION_DAYS, IS_PRODUCTION
from app.db import get_db
from app.deps import get_current_admin, require_admin
from app.lib import admin_actions as actions
from app.lib import admin_data
from app.lib.auth import authenticate, create_session, destroy_session, prune_sessions, record_audit
from app.lib.forum import get_team_forum
from app.lib.change_requests import list_requests as list_change_requests
from app.lib.change_requests import approve_request as approve_change_request
from app.lib.change_requests import decline_request as decline_change_request
from app.lib.change_requests import get_pending_count as get_pending_change_request_count
from app.lib.mailto import change_request_outcome_email, feedback_email, mailto_href, personal_link_email, team_link_email
from app.lib.settings import get_all_settings
from app.lib.team_access import get_team_members
from app.lib.teams import count_protected_teams
from app.templating import render

router = APIRouter(prefix="/admin")


# -----------------------------------------------------------------------------
# Auth
# -----------------------------------------------------------------------------


@router.get("/login")
def login_page(request: Request, error: Optional[str] = None):
    if get_current_admin(request):
        return RedirectResponse("/admin", status_code=303)
    return render(request, "admin/login.html", error=error)


@router.post("/login")
def login_submit(request: Request, email: str = Form(...), password: str = Form(...)):
    prune_sessions()
    admin = authenticate(email, password)
    if not admin:
        return RedirectResponse(
            "/admin/login?error=" + quote("Incorrect email or password."), status_code=303
        )

    session_id = create_session(admin["id"])
    response = RedirectResponse("/admin", status_code=303)
    response.set_cookie(
        ADMIN_SESSION_COOKIE,
        session_id,
        httponly=True,
        samesite="lax",
        secure=IS_PRODUCTION,
        path="/",
        max_age=ADMIN_SESSION_DAYS * 24 * 60 * 60,
    )
    return response


@router.post("/logout")
def logout(request: Request):
    session_id = request.cookies.get(ADMIN_SESSION_COOKIE)
    if session_id:
        destroy_session(session_id)
    response = RedirectResponse("/admin/login", status_code=303)
    response.delete_cookie(ADMIN_SESSION_COOKIE, path="/")
    return response


def _admin_ctx(admin) -> dict:
    seen_at = admin["notifications_seen_at"]
    return {
        "admin": admin,
        "notification_count": admin_data.get_notification_count(seen_at),
        "pending_change_requests": get_pending_change_request_count(),
    }


# -----------------------------------------------------------------------------
# Overview
# -----------------------------------------------------------------------------


@router.get("")
def overview(request: Request, admin=Depends(require_admin)):
    data = admin_data.get_overview()
    storage = admin_data.get_storage_over_time()
    matrix = admin_data.get_student_delivery_matrix()
    recent = admin_data.get_recent_activity()
    return render(
        request,
        "admin/overview.html",
        **_admin_ctx(admin),
        data=data,
        storage=storage,
        matrix=matrix,
        recent=recent,
    )


@router.post("/notifications/seen")
def notifications_seen(admin=Depends(require_admin)):
    actions.mark_notifications_seen(admin["id"])
    return Response(status_code=204)


# -----------------------------------------------------------------------------
# Assignments
# -----------------------------------------------------------------------------


@router.get("/assignments")
def assignments_list(request: Request, admin=Depends(require_admin)):
    data = admin_data.list_assignments()
    return render(request, "admin/assignments_list.html", **_admin_ctx(admin), **data)


@router.get("/assignments/new")
def assignment_new(request: Request, admin=Depends(require_admin), error: Optional[str] = None):
    return render(request, "admin/assignment_form.html", **_admin_ctx(admin), assignment=None, error=error)


@router.get("/assignments/{assignment_id}/edit")
def assignment_edit(
    request: Request, assignment_id: int, admin=Depends(require_admin), error: Optional[str] = None
):
    row = get_db().execute("SELECT * FROM assignments WHERE id = ?", (assignment_id,)).fetchone()
    if not row:
        return render(request, "404.html", status_code=404)
    return render(request, "admin/assignment_form.html", **_admin_ctx(admin), assignment=row, error=error)


@router.post("/assignments")
async def assignment_save(request: Request, admin=Depends(require_admin)):
    form = dict((await request.form()).items())
    assignment_id = actions.save_assignment(admin, form)
    return RedirectResponse(f"/admin/assignments/{assignment_id}", status_code=303)


@router.post("/assignments/{assignment_id}/delete")
def assignment_delete(assignment_id: int, admin=Depends(require_admin)):
    actions.delete_assignment(admin, assignment_id)
    return RedirectResponse("/admin/assignments", status_code=303)


@router.get("/assignments/{assignment_id}")
def assignment_detail(
    request: Request,
    assignment_id: int,
    admin=Depends(require_admin),
    missingOnly: Optional[str] = None,
):
    conn = get_db()
    assignment = conn.execute("SELECT * FROM assignments WHERE id = ?", (assignment_id,)).fetchone()
    if not assignment:
        return render(request, "404.html", status_code=404)

    matrix = admin_data.get_delivery_matrix(assignment)
    other_assignments = conn.execute(
        "SELECT * FROM assignments WHERE id != ? ORDER BY due_at DESC", (assignment_id,)
    ).fetchall()
    settings = get_all_settings()

    rows = matrix["rows"]
    if missingOnly:
        rows = [r for r in rows if r["outstanding"]]

    return render(
        request,
        "admin/assignment_detail.html",
        **_admin_ctx(admin),
        assignment=assignment,
        matrix=matrix,
        rows=rows,
        missing_only=bool(missingOnly),
        other_assignments=other_assignments,
        course_code=settings["course_code"],
        feedback_email=feedback_email,
        mailto_href=mailto_href,
    )


@router.post("/review")
async def review(request: Request, admin=Depends(require_admin)):
    form = await request.form()
    submission_id = int(form.get("submissionId"))
    status = form.get("status") or None
    comment = str(form.get("reviewComment") or "")
    actions.review_submission(admin, submission_id, status, comment)

    referer = request.headers.get("referer") or "/admin"
    return RedirectResponse(referer, status_code=303)


@router.post("/extension")
async def extension(request: Request, admin=Depends(require_admin)):
    form = await request.form()
    assignment_id = int(form.get("assignmentId"))
    team_id = int(form.get("teamId"))
    actions.set_extension(admin, assignment_id, team_id, str(form.get("newDueAt") or ""), str(form.get("reason") or ""))
    return RedirectResponse(f"/admin/assignments/{assignment_id}", status_code=303)


# -----------------------------------------------------------------------------
# Students
# -----------------------------------------------------------------------------


@router.get("/students")
def students_page(
    request: Request,
    admin=Depends(require_admin),
    error: Optional[str] = None,
    added: Optional[str] = None,
    skipped: Optional[str] = None,
    single: Optional[str] = None,
):
    roster = admin_data.get_roster()
    settings = get_all_settings()
    return render(
        request,
        "admin/students.html",
        **_admin_ctx(admin),
        roster=roster,
        error=error,
        added=added,
        skipped=skipped,
        single=bool(single),
        course_code=settings["course_code"],
        personal_link_email=personal_link_email,
        mailto_href=mailto_href,
    )


@router.post("/students/import")
async def students_import(request: Request, admin=Depends(require_admin)):
    form = await request.form()
    added, skipped = actions.import_roster(admin, str(form.get("roster") or ""))
    return RedirectResponse(f"/admin/students?added={added}&skipped={skipped}", status_code=303)


@router.post("/students/add")
async def students_add(request: Request, admin=Depends(require_admin)):
    form = await request.form()
    actions.add_student(admin, str(form.get("name") or ""), str(form.get("email") or ""))
    return RedirectResponse("/admin/students?added=1&single=1", status_code=303)


@router.post("/students/update")
async def students_update(request: Request, admin=Depends(require_admin)):
    form = await request.form()
    actions.update_student(
        admin, int(form.get("studentId")), str(form.get("name") or ""), str(form.get("email") or "")
    )
    return RedirectResponse("/admin/students", status_code=303)


@router.post("/students/delete")
async def students_delete(request: Request, admin=Depends(require_admin)):
    form = await request.form()
    actions.delete_student(admin, int(form.get("studentId")))
    return RedirectResponse("/admin/students", status_code=303)


@router.post("/students/active")
async def students_active(request: Request, admin=Depends(require_admin)):
    form = await request.form()
    actions.set_student_active(admin, int(form.get("studentId")), form.get("active") == "on")
    return RedirectResponse("/admin/students", status_code=303)


@router.post("/students/{student_id}/link-sent")
def students_link_sent(student_id: int, admin=Depends(require_admin)):
    actions.mark_link_sent(student_id)
    return Response(status_code=204)


# -----------------------------------------------------------------------------
# Group-change requests
# -----------------------------------------------------------------------------


@router.get("/change-requests")
def change_requests_page(request: Request, admin=Depends(require_admin), status: Optional[str] = None):
    settings = get_all_settings()
    requests_ = list_change_requests(status)
    return render(
        request,
        "admin/change_requests.html",
        **_admin_ctx(admin),
        requests=requests_,
        status_filter=status or "pending",
        course_code=settings["course_code"],
        change_request_outcome_email=change_request_outcome_email,
        mailto_href=mailto_href,
    )


@router.post("/change-requests/{request_id}/approve")
async def change_request_approve(request: Request, request_id: int, admin=Depends(require_admin)):
    form = await request.form()
    target_team_id = int(form.get("targetTeamId"))
    approve_change_request(admin, request_id, target_team_id, str(form.get("note") or ""))
    return RedirectResponse("/admin/change-requests", status_code=303)


@router.post("/change-requests/{request_id}/decline")
async def change_request_decline(request: Request, request_id: int, admin=Depends(require_admin)):
    form = await request.form()
    decline_change_request(admin, request_id, str(form.get("note") or ""))
    return RedirectResponse("/admin/change-requests", status_code=303)


# -----------------------------------------------------------------------------
# Teams
# -----------------------------------------------------------------------------


@router.get("/teams")
def teams_page(
    request: Request,
    admin=Depends(require_admin),
    assignment: Optional[int] = None,
    shuffled: Optional[str] = None,
    created: Optional[str] = None,
    placed: Optional[str] = None,
    deleted: Optional[str] = None,
    protectedTeams: Optional[str] = None,
):
    conn = get_db()
    all_assignments = conn.execute("SELECT * FROM assignments ORDER BY due_at DESC").fetchall()
    if assignment is None and all_assignments:
        assignment = all_assignments[0]["id"]

    teams_with_members = []
    roster = []
    protected = 0
    current_assignment = None
    if assignment is not None:
        current_assignment = next((a for a in all_assignments if a["id"] == assignment), None)
        teams_with_members = admin_data.get_teams_with_members(assignment)
        roster = admin_data.get_roster_with_teams(assignment)
        protected = count_protected_teams(assignment)

    settings = get_all_settings()

    return render(
        request,
        "admin/teams.html",
        **_admin_ctx(admin),
        all_assignments=all_assignments,
        assignment=current_assignment,
        assignment_id=assignment,
        teams=teams_with_members,
        roster=roster,
        protected_count=protected,
        shuffled=bool(shuffled),
        created=created,
        placed=placed,
        deleted=deleted,
        protected_teams=protectedTeams,
        course_code=settings["course_code"],
        team_link_email=team_link_email,
        mailto_href=mailto_href,
    )


@router.post("/teams/create")
async def teams_create(request: Request, admin=Depends(require_admin)):
    form = await request.form()
    assignment_id = int(form.get("assignmentId"))
    member_ids = [int(v) for v in form.getlist("members") if str(v).strip()]
    actions.create_team_as_admin(admin, str(form.get("name") or ""), assignment_id, member_ids)
    return RedirectResponse(f"/admin/teams?assignment={assignment_id}", status_code=303)


@router.post("/teams/copy")
async def teams_copy(request: Request, admin=Depends(require_admin)):
    form = await request.form()
    to_id = int(form.get("assignmentId"))
    actions.copy_teams_from_assignment(admin, int(form.get("fromAssignmentId")), to_id)
    return RedirectResponse(f"/admin/teams?assignment={to_id}", status_code=303)


@router.post("/teams/shuffle")
async def teams_shuffle(request: Request, admin=Depends(require_admin)):
    form = await request.form()
    assignment_id = int(form.get("assignmentId"))
    mode = str(form.get("mode") or "fill")
    preferred_raw = form.get("preferred")
    preferred = int(preferred_raw) if preferred_raw else None
    result = actions.shuffle_teams_action(admin, assignment_id, mode, preferred)
    return RedirectResponse(
        f"/admin/teams?assignment={assignment_id}&shuffled=1&created={result.created}"
        f"&placed={result.placed}&deleted={result.deleted}&protectedTeams={result.protected_teams}",
        status_code=303,
    )


@router.post("/teams/rename")
async def teams_rename(request: Request, admin=Depends(require_admin)):
    form = await request.form()
    team_id = int(form.get("teamId"))
    actions.rename_team(team_id, str(form.get("name") or ""))
    team = get_db().execute("SELECT assignment_id FROM teams WHERE id = ?", (team_id,)).fetchone()
    return RedirectResponse(
        f"/admin/teams?assignment={team['assignment_id'] if team else ''}", status_code=303
    )


@router.post("/teams/regenerate")
async def teams_regenerate(request: Request, admin=Depends(require_admin)):
    form = await request.form()
    team_id = int(form.get("teamId"))
    actions.regenerate_team_link(admin, team_id)
    team = get_db().execute("SELECT assignment_id FROM teams WHERE id = ?", (team_id,)).fetchone()
    return RedirectResponse(
        f"/admin/teams?assignment={team['assignment_id'] if team else ''}", status_code=303
    )


@router.post("/teams/add-member")
async def teams_add_member(request: Request, admin=Depends(require_admin)):
    form = await request.form()
    team_id = int(form.get("teamId"))
    actions.add_team_member(team_id, int(form.get("studentId")))
    team = get_db().execute("SELECT assignment_id FROM teams WHERE id = ?", (team_id,)).fetchone()
    return RedirectResponse(
        f"/admin/teams?assignment={team['assignment_id'] if team else ''}", status_code=303
    )


@router.post("/teams/move")
async def teams_move(request: Request, admin=Depends(require_admin)):
    form = await request.form()
    assignment_id = int(form.get("assignmentId"))
    team_id_raw = form.get("teamId")
    actions.move_student(
        admin, int(form.get("studentId")), assignment_id, int(team_id_raw) if team_id_raw else None
    )
    return RedirectResponse(f"/admin/teams?assignment={assignment_id}", status_code=303)


@router.post("/teams/remove-member")
async def teams_remove_member(request: Request, admin=Depends(require_admin)):
    form = await request.form()
    assignment_id = int(form.get("assignmentId"))
    actions.remove_team_member(int(form.get("studentId")), assignment_id)
    return RedirectResponse(f"/admin/teams?assignment={assignment_id}", status_code=303)


@router.post("/teams/delete")
async def teams_delete(request: Request, admin=Depends(require_admin)):
    form = await request.form()
    team_id = int(form.get("teamId"))
    team = get_db().execute("SELECT assignment_id FROM teams WHERE id = ?", (team_id,)).fetchone()
    actions.delete_team(admin, team_id)
    return RedirectResponse(
        f"/admin/teams?assignment={team['assignment_id'] if team else ''}", status_code=303
    )


@router.get("/teams/{team_id}/forum")
def team_forum_admin(request: Request, team_id: int, admin=Depends(require_admin)):
    conn = get_db()
    team = conn.execute("SELECT * FROM teams WHERE id = ?", (team_id,)).fetchone()
    if not team:
        return render(request, "404.html", status_code=404)
    assignment = conn.execute(
        "SELECT * FROM assignments WHERE id = ?", (team["assignment_id"],)
    ).fetchone()
    members = get_team_members(team_id)
    forum = get_team_forum(team_id)
    return render(
        request,
        "admin/team_forum.html",
        **_admin_ctx(admin),
        team=team,
        assignment=assignment,
        members=members,
        forum=forum,
    )


# -----------------------------------------------------------------------------
# Settings
# -----------------------------------------------------------------------------


@router.get("/settings")
def settings_page(
    request: Request,
    admin=Depends(require_admin),
    emailError: Optional[str] = None,
    emailChanged: Optional[str] = None,
    adminError: Optional[str] = None,
    adminAdded: Optional[str] = None,
):
    settings = get_all_settings()
    admins = get_db().execute("SELECT * FROM admins ORDER BY name").fetchall()
    return render(
        request,
        "admin/settings.html",
        **_admin_ctx(admin),
        settings=settings,
        admins=admins,
        email_error=emailError,
        email_changed=bool(emailChanged),
        admin_error=adminError,
        admin_added=bool(adminAdded),
    )


@router.post("/settings")
async def settings_save(request: Request, admin=Depends(require_admin)):
    form = dict((await request.form()).items())
    actions.save_settings(form)
    return RedirectResponse("/admin/settings", status_code=303)


@router.post("/settings/email")
async def settings_email(request: Request, admin=Depends(require_admin)):
    form = await request.form()
    actions.update_admin_email(admin, str(form.get("email") or ""))
    return RedirectResponse("/admin/settings?emailChanged=1", status_code=303)


@router.post("/settings/admins/create")
async def settings_admin_create(request: Request, admin=Depends(require_admin)):
    form = await request.form()
    actions.create_admin(
        admin, str(form.get("name") or ""), str(form.get("email") or ""), str(form.get("password") or "")
    )
    return RedirectResponse("/admin/settings?adminAdded=1", status_code=303)


@router.post("/settings/admins/delete")
async def settings_admin_delete(request: Request, admin=Depends(require_admin)):
    form = await request.form()
    actions.delete_admin(admin, int(form.get("id")))
    return RedirectResponse("/admin/settings", status_code=303)


@router.post("/files/{file_id}/delete")
def file_delete(request: Request, file_id: int, admin=Depends(require_admin)):
    actions.delete_submission_file(admin, file_id)
    referer = request.headers.get("referer") or "/admin"
    return RedirectResponse(referer, status_code=303)
