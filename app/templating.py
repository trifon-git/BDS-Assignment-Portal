"""Jinja2 environment + a `render()` helper that injects the settings every
template wants (semester name, support email) without every route having to
remember to pass them.
"""

from __future__ import annotations

from pathlib import Path

from fastapi.templating import Jinja2Templates
from starlette.requests import Request
from starlette.responses import HTMLResponse

from app.lib import deadline as deadline_lib
from app.lib.format import format_date, format_deadline, format_time, to_date_time_local
from app.lib.settings import get_all_settings
from app.lib.storage import format_bytes

templates = Jinja2Templates(directory=str(Path(__file__).parent / "templates"))
templates.env.filters["format_deadline"] = format_deadline
templates.env.filters["format_date"] = format_date
templates.env.filters["format_time"] = format_time
templates.env.filters["to_dt_local"] = to_date_time_local
templates.env.filters["format_bytes"] = format_bytes
templates.env.filters["format_relative"] = deadline_lib.format_relative
templates.env.globals["state_label"] = deadline_lib.STATE_LABEL


def render(request: Request, name: str, status_code: int = 200, **context) -> HTMLResponse:
    settings = get_all_settings()
    ctx = {
        "request": request,
        "semester_name": settings["semester_name"],
        "support_email": settings["support_email"],
        "course_code": settings["course_code"],
        **context,
    }
    return templates.TemplateResponse(name, ctx, status_code=status_code)
