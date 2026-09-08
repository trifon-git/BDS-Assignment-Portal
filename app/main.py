from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import RedirectResponse

from app.config import DATA_DIR, SEED_ADMIN_EMAIL, SEED_ADMIN_NAME, SEED_ADMIN_PASSWORD
from app.db import get_db, run_migrations
from app.deps import RedirectException, redirect_exception_handler
from app.lib.admin_actions import AdminActionError
from app.lib.auth import hash_password

app = FastAPI(title="AAU Assignment Portal")

app.mount("/static", StaticFiles(directory=str(Path(__file__).parent / "static")), name="static")

app.add_exception_handler(RedirectException, redirect_exception_handler)
app.add_exception_handler(
    AdminActionError, lambda request, exc: RedirectResponse(exc.redirect_to, status_code=303)
)


@app.on_event("startup")
def on_startup() -> None:
    """Runs once when the server starts, before the first request. This is
    what lets the container be handed to university IT as "docker compose
    up": migrations apply themselves and the first admin account exists,
    with no separate setup step for someone to forget.
    """
    run_migrations()
    print(f"[startup] database ready in {DATA_DIR}")

    conn = get_db()
    existing = conn.execute("SELECT count(*) AS n FROM admins").fetchone()["n"]
    if existing > 0:
        return

    if not SEED_ADMIN_EMAIL or not SEED_ADMIN_PASSWORD:
        print(
            "[startup] No admin account exists and ADMIN_EMAIL / ADMIN_PASSWORD are "
            "not set. Set them and restart, or nobody can sign in to the admin panel."
        )
        return

    if len(SEED_ADMIN_PASSWORD) < 12:
        print(
            "[startup] ADMIN_PASSWORD is shorter than 12 characters. This account "
            "can read every submission in the course — please use a longer one."
        )

    conn.execute(
        "INSERT INTO admins (name, email, password_hash) VALUES (?, ?, ?)",
        (SEED_ADMIN_NAME, SEED_ADMIN_EMAIL.strip().lower(), hash_password(SEED_ADMIN_PASSWORD)),
    )
    conn.commit()
    print(f"[startup] created first admin account: {SEED_ADMIN_EMAIL}")


from app.routes import admin, api, public, student  # noqa: E402

app.include_router(public.router)
app.include_router(student.router)
app.include_router(admin.router)
app.include_router(api.router)
