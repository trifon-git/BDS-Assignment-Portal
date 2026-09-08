from __future__ import annotations

import csv
import io
import zipfile

from fastapi import APIRouter, Depends, Request
from fastapi.responses import FileResponse, JSONResponse, Response, StreamingResponse

from app.db import get_db
from app.deps import get_current_admin, require_admin
from app.lib.storage import resolve_stored_path

router = APIRouter()


@router.get("/api/health")
def health():
    try:
        get_db().execute("SELECT 1").fetchone()
        return JSONResponse({"ok": True})
    except Exception:
        return JSONResponse({"ok": False}, status_code=500)


@router.get("/api/files/{stored_name}")
def serve_file(request: Request, stored_name: str, token: str | None = None):
    """Admin-or-token-authorized file serving."""
    conn = get_db()
    file_ = conn.execute(
        "SELECT * FROM submission_files WHERE stored_name = ?", (stored_name,)
    ).fetchone()
    if not file_:
        return Response(status_code=404)

    admin = get_current_admin(request)
    if not admin:
        if not token:
            return Response(status_code=404)
        submission = conn.execute(
            "SELECT * FROM submissions WHERE id = ?", (file_["submission_id"],)
        ).fetchone()
        team = conn.execute(
            "SELECT * FROM teams WHERE id = ?", (submission["team_id"],)
        ).fetchone() if submission else None
        if not team or team["access_token"] != token:
            return Response(status_code=404)

    try:
        path = resolve_stored_path(stored_name)
    except ValueError:
        return Response(status_code=404)
    if not path.exists():
        return Response(status_code=410)

    return FileResponse(
        path,
        filename=file_["original_name"],
        headers={"Cache-Control": "private, no-store"},
    )


@router.get("/api/admin/assignments/{assignment_id}/download")
def download_assignment(assignment_id: int, admin=Depends(require_admin)):
    conn = get_db()
    assignment = conn.execute("SELECT * FROM assignments WHERE id = ?", (assignment_id,)).fetchone()
    if not assignment:
        return Response(status_code=404)

    teams = conn.execute("SELECT * FROM teams WHERE assignment_id = ?", (assignment_id,)).fetchall()
    submissions = conn.execute(
        "SELECT * FROM submissions WHERE assignment_id = ?", (assignment_id,)
    ).fetchall()
    team_by_id = {t["id"]: t for t in teams}

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        csv_buffer = io.StringIO()
        writer = csv.writer(csv_buffer)
        writer.writerow(["team", "status", "is_late", "submitted_at", "video_url", "link_url", "note"])

        for submission in submissions:
            team = team_by_id.get(submission["team_id"])
            team_name = team["name"] if team else str(submission["team_id"])
            writer.writerow(
                [
                    team_name,
                    submission["status"],
                    submission["is_late"],
                    submission["submitted_at"],
                    submission["video_url"] or "",
                    submission["link_url"] or "",
                    submission["note"] or "",
                ]
            )

            files = conn.execute(
                "SELECT * FROM submission_files WHERE submission_id = ?", (submission["id"],)
            ).fetchall()
            for f in files:
                try:
                    path = resolve_stored_path(f["stored_name"])
                except ValueError:
                    continue
                if path.exists():
                    zf.write(path, arcname=f"{team_name}/{f['original_name']}")

        zf.writestr("summary.csv", csv_buffer.getvalue())

    buffer.seek(0)
    filename = f"{assignment['title'].replace('/', '-')}.zip"
    return StreamingResponse(
        buffer,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
