from __future__ import annotations

import csv
import html
import io
import zipfile
from urllib.parse import quote

from fastapi import APIRouter, Depends, Request
from fastapi.responses import FileResponse, JSONResponse, Response, StreamingResponse

from app.db import get_db
from app.deps import get_current_admin, require_admin
from app.lib.format import format_deadline
from app.lib.storage import resolve_stored_path
from app.lib.team_access import get_team_members

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


def _build_index_html(assignment_title: str, rows: list[dict], max_links: int) -> str:
    """A standalone index for graders who'd rather double-click a file than
    open a spreadsheet — same data as summary.csv, but with working links
    (local files relative to this file's own position in the zip, video/code
    links opening in a browser). Each delivered link gets its own column,
    same as summary.csv, rather than being stacked into one cell."""
    title = html.escape(assignment_title)
    link_headers = "".join(f"<th>Link {i}</th>" for i in range(1, max_links + 1))
    body_rows = []
    for row in rows:
        files_html = "<br>".join(
            f'<a href="{html.escape(rel_path)}">{html.escape(name)}</a>' for name, rel_path in row["files"]
        ) or "—"
        members_html = "<br>".join(
            f"{html.escape(m['name'])} &lt;{html.escape(m['email'])}&gt;" for m in row["members"]
        ) or "—"
        code_link_html = (
            f'<a href="{html.escape(row["link_url"])}" target="_blank" rel="noopener">code link</a>'
            if row["link_url"] else "—"
        )
        link_cells = "".join(_link_cell(url, i) for i, url in _padded(row["extra_links"], max_links))
        video_html = (
            f'<a href="{html.escape(row["video_url"])}" target="_blank" rel="noopener">video</a>'
            if row["video_url"] else "—"
        )
        late = " (late)" if row["is_late"] else ""
        body_rows.append(
            "<tr>"
            f"<td>{html.escape(row['team'])}</td>"
            f"<td>{html.escape(row['status'])}{late}</td>"
            f"<td>{html.escape(format_deadline(row['submitted_at']) if row['submitted_at'] else '')}</td>"
            f"<td>{members_html}</td>"
            f"<td>{files_html}</td>"
            f"<td>{code_link_html}</td>"
            f"{link_cells}"
            f"<td>{video_html}</td>"
            f"<td>{html.escape(row['note'] or '')}</td>"
            "</tr>"
        )

    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>{title} — deliverables</title>
<style>
  body {{ font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; margin: 2rem; color: #1a1c29; }}
  h1 {{ font-size: 1.3rem; }}
  table {{ border-collapse: collapse; width: 100%; margin-top: 1rem; }}
  th, td {{ border: 1px solid #dfe2ee; padding: 0.5rem 0.7rem; text-align: left; vertical-align: top; font-size: 0.92rem; }}
  th {{ background: #f6f7fb; }}
  a {{ color: #2c5cf5; }}
</style>
</head>
<body>
<h1>{title} — deliverables</h1>
<p>Open this file straight from the unzipped folder. Local files link relative to here; code/video links open online.</p>
<table>
  <tr><th>Team</th><th>Status</th><th>Submitted</th><th>Members</th><th>Files</th><th>Code link</th>{link_headers}<th>Video</th><th>Note</th></tr>
  {"".join(body_rows) or f'<tr><td colspan="{8 + max_links}">Nothing submitted yet.</td></tr>'}
</table>
</body>
</html>
"""


def _link_cell(url: str, index: int) -> str:
    if not url:
        return "<td>—</td>"
    return f'<td><a href="{html.escape(url)}" target="_blank" rel="noopener">link {index}</a></td>'


def _padded(values: list[str], length: int):
    """Pairs 1-based column indices with values, filling missing slots with
    "" so every row in a table with a variable number of links lines up
    under the same fixed set of columns."""
    return enumerate((values + [""] * length)[:length], 1)


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
        index_rows = []

        for submission in submissions:
            team = team_by_id.get(submission["team_id"])
            team_name = team["name"] if team else str(submission["team_id"])
            members = get_team_members(team["id"]) if team else []
            extra_links = [
                row["url"]
                for row in conn.execute(
                    "SELECT url FROM submission_links WHERE submission_id = ? ORDER BY id",
                    (submission["id"],),
                ).fetchall()
            ]

            file_links = []
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
                    file_links.append((f["original_name"], f"{team_name}/{f['original_name']}"))

            index_rows.append(
                {
                    "team": team_name,
                    "members": members,
                    "status": submission["status"],
                    "is_late": submission["is_late"],
                    "submitted_at": submission["submitted_at"],
                    "video_url": submission["video_url"],
                    "link_url": submission["link_url"],
                    "extra_links": extra_links,
                    "note": submission["note"],
                    "files": file_links,
                }
            )

        max_links = max((len(r["extra_links"]) for r in index_rows), default=0)

        csv_buffer = io.StringIO()
        writer = csv.writer(csv_buffer)
        writer.writerow(
            ["team", "members", "status", "is_late", "submitted_at", "video_url", "code_link"]
            + [f"link_{i}" for i in range(1, max_links + 1)]
            + ["note"]
        )
        for row in index_rows:
            members_str = "; ".join(f"{m['name']} <{m['email']}>" for m in row["members"])
            padded_links = (row["extra_links"] + [""] * max_links)[:max_links]
            writer.writerow(
                [
                    row["team"],
                    members_str,
                    row["status"],
                    row["is_late"],
                    row["submitted_at"],
                    row["video_url"] or "",
                    row["link_url"] or "",
                ]
                + padded_links
                + [row["note"] or ""]
            )

        zf.writestr("summary.csv", csv_buffer.getvalue())
        zf.writestr(
            "index.html",
            _build_index_html(assignment["title"], index_rows, max_links),
        )

    buffer.seek(0)
    filename = f"{assignment['title'].replace('/', '-')}.zip"
    ascii_fallback = filename.encode("ascii", "ignore").decode("ascii") or "assignment.zip"
    return StreamingResponse(
        buffer,
        media_type="application/zip",
        headers={
            "Content-Disposition": (
                f'attachment; filename="{ascii_fallback}"; '
                f"filename*=UTF-8''{quote(filename)}"
            )
        },
    )
