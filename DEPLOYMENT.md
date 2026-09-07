# Deployment

Written for whoever runs this on an AAU server. The application is a single
container plus a single directory. There is no database server, no message
queue, and no external service to configure.

## What it is

A web app where BDS students deliver weekly assignments and the course
responsible sees who has and hasn't. Students have **no accounts** — each team
gets a private link that acts as its credential. The admin panel is
password-protected.

## Requirements

- Docker with the Compose plugin.
- One writable directory on the host for the data volume.
- A reverse proxy terminating TLS (the university's nginx or Apache).
- ~1 GB RAM. Disk depends on the class: budget roughly
  *teams x weeks x assignment size*, so a 12-team course with 200 MB weekly
  ZIPs over 14 weeks needs about 35 GB.

No outbound internet access is required at runtime.

## First run

```bash
cp .env.example .env
# Edit .env: set ADMIN_EMAIL and a strong ADMIN_PASSWORD.
docker compose up -d --build
docker compose logs -f app        # watch for "[startup] database ready"
```

On first boot the app creates `./data/app.db`, applies its migrations, and
creates the admin account from `ADMIN_EMAIL` / `ADMIN_PASSWORD`. Those variables
are read **only when no admin exists**; afterwards they are ignored.

Then sign in at `https://<host>/admin/login` and:

1. **Students** — paste the class list.
2. **Teams** — create the groups, or let students self-organise at `/join`.
3. **Assignments** — create the first assignment and tick *Published*.
4. Give each team its link (Teams → Copy link) or its short code.

## Verify the deployment

Before handing links to students, prove the whole loop works through the real
URL — including the reverse proxy, which is where deployments actually break:

```bash
# Use a throwaway team's link; this creates a real delivery.
npm run verify -- https://delivery.example.aau.dk <teamToken>   --size 50000000   --restart-cmd "docker compose restart app"
```

It reads the "Submitted by" dropdown, uploads a file of the size you ask for,
checks the app's own page lists it, downloads it and compares every byte,
confirms the file is *not* readable without the team link, then restarts the
container and checks the delivery is still there.

Two failures worth knowing by sight:

- **413 on the upload** — `client_max_body_size` in nginx is below
  `MAX_UPLOAD_MB`. The check names this explicitly.
- **The delivery does not survive the restart** — the volume is not mounted
  where the app writes. Fix this before term starts, not after.

The script only needs the URL, so it can be run from your laptop against the
server.

## Reverse proxy

The container listens on `127.0.0.1:3000`. Students upload large ZIPs, so the
proxy's body limit and timeouts matter more than anything else here.

```nginx
server {
    listen 443 ssl http2;
    server_name delivery.example.aau.dk;

    # Must be at least as large as MAX_UPLOAD_MB, or uploads fail at the proxy
    # with a 413 before the app ever sees them.
    client_max_body_size 300M;

    # A 200 MB upload on a slow connection takes minutes.
    proxy_read_timeout 600s;
    proxy_send_timeout 600s;
    proxy_request_buffering off;   # stream to the app rather than buffering

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

`X-Forwarded-For` is what the audit log records as the source of a delivery, so
it is worth getting right.

## Environment variables

| Variable | Default | Notes |
|---|---|---|
| `ADMIN_EMAIL` | — | First admin account. Only used on an empty database. |
| `ADMIN_PASSWORD` | — | Same. Use something long; this account reads every submission. |
| `ADMIN_NAME` | `Course responsible` | Display name. |
| `DATA_DIR` | `/data` | Database and uploads. Must match the volume mount. |
| `MAX_UPLOAD_MB` | `250` | Hard ceiling per file, whatever an assignment asks for. Keep `client_max_body_size` above it. |
| `TIMEZONE` | `Europe/Copenhagen` | How deadlines are displayed and interpreted. |

## Backup

Everything is in one directory:

```
data/
  app.db          # SQLite: roster, teams, assignments, submissions, audit log
  app.db-wal      # write-ahead log
  app.db-shm
  uploads/        # every uploaded file, named by UUID
```

A backup is a copy of `data/`. Because SQLite is in WAL mode, take it with the
container stopped, or use the online backup so the copy is consistent:

```bash
# Consistent copy without stopping the app
docker compose exec app node -e "
  const D = require('better-sqlite3');
  new D('/data/app.db').backup('/data/backup-' + Date.now() + '.db')
    .then(() => process.exit(0));
"

# Or the simple version
docker compose stop app
tar czf aau-delivery-$(date +%F).tar.gz data/
docker compose start app
```

Restoring is the reverse: stop the container, put `data/` back, start it. The
uploaded files and the database rows that point at them must be restored
**together** — a database restored without its `uploads/` shows submissions
whose downloads return "no longer on the server".

## Upgrades

```bash
git pull
docker compose up -d --build
```

Migrations run automatically at startup. Take a backup first.

## Health

`GET /api/health` returns `{"ok":true}` and touches the database, so a 200 means
the app can actually serve a request. Compose already uses it as a healthcheck:

```bash
docker compose ps          # look for "healthy"
docker compose logs -f app
```

## Security notes for the reviewer

- **Students are not authenticated.** A team link is a 128-bit random token and
  is the only thing protecting that team's submissions. Anyone holding it can
  submit and replace files for that team until the deadline. This was a
  deliberate trade for zero-friction delivery; the mitigations are the audit log
  and the one-click **Regenerate** in the admin panel.
- Admin passwords are bcrypt hashed (cost 12). Sessions are opaque random
  tokens in an `HttpOnly`, `SameSite=Lax` cookie, `Secure` in production.
- Uploaded files are stored under UUID names, never under a name the student
  chose, and are served only to an admin or to a holder of the owning team's
  token. Downloads are `Cache-Control: private, no-store`.
- The app makes no outbound network requests. Video links are stored as text and
  only ever rendered as links for a human to click.
- The container runs as an unprivileged user and writes only to `/data`.
- There is no rate limiting on the admin login beyond bcrypt's cost. If the
  admin panel is reachable from the public internet rather than the campus
  network, consider a proxy-level limit on `/admin/login`.

## Known limitations

- Single instance only. SQLite plus a local uploads directory means you cannot
  run two replicas against the same volume. This is sized for one course, not
  the whole faculty.
- **Do not open `data/app.db` from the host while the container is running.**
  The bind mount means the file is reachable from both sides, and SQLite's
  locking does not reliably span that boundary — two writers, or a host tool
  reading while the container writes, can see stale data or lose writes. This
  is the one way to corrupt an otherwise very robust setup, and it is easy to
  do by accident (a `sqlite3` session, a seed script, a backup copy). Stop the
  container first, or use the online backup below, which runs *inside* it.
- No email is sent by the app. Chasing students is done by copying addresses out
  of the admin panel into your own mail client.
- An admin password can only be changed by an operator, from the host:

  ```bash
  docker compose exec app node -e "
    const D = require('better-sqlite3');
    const bcrypt = require('bcryptjs');
    const db = new D('/data/app.db');
    db.prepare('update admins set password_hash = ? where email = ?')
      .run(bcrypt.hashSync('NEW-PASSWORD-HERE', 12), 'your.name@aau.dk');
    console.log('updated');
  "
  ```
