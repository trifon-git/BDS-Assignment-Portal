# BDS Assignment Portal

A small self-hosted web app where students on the **Business Data Science**
master's at Aalborg University deliver their weekly assignments, and the course
responsible sees at a glance who has delivered and who hasn't.

Students hand in code archives, PDFs and a Panopto link, as a team or
individually. The admin panel defines the assignments, watches the deliveries,
reviews the files, and chases whoever is missing.

Deployment instructions for the university server are in
[DEPLOYMENT.md](./DEPLOYMENT.md).

---

## The idea in one paragraph

Students do not have accounts. Each team has a private link — `/t/<token>` — and
that link is the credential; they bookmark it once and use it all semester. The
class roster is imported by the admin, so every "who is submitting this?"
dropdown offers real people and the delivery counts always add up against a
known denominator. Because identity comes from the roster rather than from a
login, one team link covers individual assignments too: a solo assignment shows
one row per member inside the team page.

The design constraint behind all of it: **friction for students must be near
zero**. No account, no password, no verification email — nothing to remember
except one bookmarked URL.

### For students

1. Open the site and type the team code (`BDS-7K2P`), or use the bookmarked link.
2. The dashboard lists every published assignment with its status.
3. Open one, pick your name from *Submitted by*, attach the files, paste the
   Panopto link if the assignment asks for a video, and deliver.
4. A delivery can be replaced any time until the deadline.

### For the course responsible

Sign in at `/admin/login`. An assignment stays invisible to students until
*Published* is ticked, so a half-written brief is never exposed by a guessed URL.

---

## Tech stack

| Layer | Choice | Version | Why |
|---|---|---|---|
| Framework | Next.js (App Router) | 16.3.4 | Server Components for the data-heavy admin screens; Route Handlers for the streaming upload path |
| Runtime | React | 19.2.8 | |
| Language | TypeScript | 5.9 | `strict`, with Next's generated `PageProps` / `RouteContext` route types |
| Database | SQLite via better-sqlite3 | 13.0.3 | One file. The whole app is one container plus one directory |
| Query layer | Drizzle ORM + drizzle-kit | 0.45.2 / 0.31.10 | Typed schema, SQL-shaped queries, versioned migrations |
| Styling | Tailwind CSS | 4.3.3 | `@theme inline` tokens, OKLCH colour ramp derived from the AAU logo |
| Components | shadcn/ui on Base UI | @base-ui/react 1.7.0 | Base UI, **not** Radix — composition uses `render={...}`, not `asChild` |
| Icons | lucide-react | 1.39.0 | |
| Uploads | busboy | 1.6.0 | Streams multipart straight to disk instead of buffering it |
| Bulk download | archiver | 8.0.0 | v8 exports classes (`new ZipArchive()`); the callable form was removed |
| Passwords | bcryptjs | 3.0.3 | Cost 12, admin accounts only |
| Validation | zod | 4.5.4 | |
| Tests | vitest | 4.1.11 | Plus HTTP-level suites in `scripts/` |
| Packaging | Docker + Compose | — | `output: "standalone"`, one bind-mounted `/data` volume |

**Why SQLite over Postgres.** This is sized for one course — a few dozen teams
writing once a week. SQLite makes the deployment a single container and a single
directory, and a backup a copy of that directory, which matters a great deal when
handing the thing to university IT. Drizzle keeps the door open to Postgres later
as a configuration change rather than a rewrite.

---

## Architecture

```
Browser
  │
  ├── /                     landing: type a team code
  ├── /join                 self-organise into a team
  ├── /t/<token>            team dashboard — every published assignment
  ├── /t/<token>/a/<id>     the delivery form
  │        │
  │        └── POST /api/submit/<token>/<id>   ← Route Handler, streams to disk
  │
  └── /admin/*              password-protected, Server Actions for every mutation
                                   │
                            src/lib/*  ← all rules live here
                                   │
                            Drizzle → SQLite  (/data/app.db)
                                    → uploads (/data/uploads/<uuid>)
```

Two deliberate splits:

- **Mutations are Server Actions; uploads are a Route Handler.** Server Actions
  cap the request body at a couple of megabytes, and students deliver ZIPs two
  orders of magnitude larger. The upload route also keeps the delivery form
  working with JavaScript disabled.
- **Rules live in `src/lib`, not in pages.** `submit.ts` holds every acceptance
  rule, so the upload route is a thin wrapper — which matters because that route
  is reachable by direct POST and cannot assume the form was honest.

---

## Modules

### Data layer — `src/db/`

| File | What it is |
|---|---|
| `schema.ts` | **The spine.** 11 tables: students, teams, team_members, assignments, submissions, submission_files, deadline_extensions, admins, admin_sessions, audit_log, settings. Timestamps are epoch-ms integers. The two *partial* unique indexes on `submissions` are what keep one team (or one student) to a single live delivery per assignment. `team_members` has a unique index on `student_id` — a student is on exactly one team at a time. |
| `index.ts` | The connection: SQLite with WAL, `foreign_keys = ON` and a busy timeout, cached on `globalThis`. That cache is load-bearing in production, not a dev nicety — a built Next app evaluates this module once per bundler layer, and without it each layer opens its own connection. Also exports `runMigrations()`. |
| `seed.ts` | A plausible fake cohort: 16 students, 4 teams, 5 assignments, 12 submissions in a mix of states. Refuses to touch a database that already has students unless `RESEED=1`. |

### Domain logic — `src/lib/`

| File | What it is |
|---|---|
| `deadline.ts` | Pure and unit-tested. Resolves the effective deadline (assignment due date, overridden by any per-team extension) and derives every status in the app: `pending / missing / delivered / late / approved / rework`. |
| `submit.ts` | **Every rule that decides whether a delivery is accepted**: membership re-check, deadline, required files, required video, sharing confirmation. Replaces a previous submission transactionally, clears its review status, and deletes the old bytes only after the transaction commits. |
| `storage.ts` | The single filesystem choke point. Files are stored under UUID names, never a name the student chose. `resolveStoredPath()` refuses anything that is not a bare UUID; `sanitizeFilename()` filters by code point rather than by regex. |
| `multipart.ts` | busboy wrapper. Streams each part to disk against the assignment's own size and extension limits, and cleans up orphaned bytes when a request fails part-way. |
| `team-access.ts` | Turns a team link or short code into a team. **Every student route enters here**, which keeps "what does holding this link entitle you to" in one auditable place. |
| `auth.ts` | Admin only. bcrypt verification against a dummy hash so a wrong email costs the same as a wrong password; opaque session tokens; `HttpOnly` / `SameSite=Lax` cookies; session pruning; `recordAudit()`. |
| `admin-actions.ts` | `"use server"`. Every admin mutation — assignments, review, extensions, roster, students, teams, settings — each one starting with `requireAdmin()`. |
| `admin-data.ts` | The read side. `getDeliveryMatrix()` is the query this app exists for; `getRoster()` and `getRosterWithTeams()` back the student and team screens. Returns `now` to its callers so pages never call `Date.now()` during render. |
| `dashboard.ts` | Builds every assignment card for a team from three bulk queries rather than per-row lookups. |
| `format.ts` | Europe/Copenhagen formatting and **strict** `datetime-local` parsing — a regex, not `new Date()`, so a typo cannot silently become a valid deadline in the year 2000. Handles the DST boundaries. |
| `roster.ts` | Parses a pasted class list: CSV, semicolon-CSV, `Name <email>`, or bare addresses. Lowercases, de-dupes, transliterates Nordic characters. Separate from `admin-actions.ts` because a `"use server"` module may only export async functions. |
| `settings.ts` | Admin-editable settings read through a defaults map, so a missing row never breaks a page and adding a setting never needs a migration. Also holds the video-host check. |
| `config.ts` | Everything environment-derived, resolved once: `DATA_DIR`, upload ceiling, timezone, session lifetime, setting defaults. |
| `ids.ts` | Team access tokens (128-bit) and human-typable short codes (`BDS-7K2P`). |
| `web-stream.ts` | Wraps `ReadableStream.from` in one place — `Readable.toWeb()` throws an *uncaught* exception on client disconnect, which would take the server process down. |

### Routes — `src/app/`

**Student-facing** — no authentication; the team token is the credential.

| Route | Purpose |
|---|---|
| `/` | Landing. Type a team code, plus instructions on why that code matters and who to email if it is lost. |
| `/join` | Self-organise: pick your name from the roster, name the team, add teammates. |
| `/t/[token]` | Team dashboard: members, the bookmark card, and every published assignment split into open and past. Solo assignments expand to one row per member. |
| `/t/[token]/a/[id]` | The delivery form: requirements restated, file picker, Panopto field, "Submitted by" dropdown. |

**Admin** — email + password.

| Route | Purpose |
|---|---|
| `/admin/login` | |
| `/admin` | This week at a glance: progress, who is outstanding, recent activity. |
| `/admin/assignments`, `.../new`, `.../[id]/edit` | Create and edit; every requirement is a toggle — team or solo, files and/or video, allowed extensions, size cap, deadline, whether late is accepted, draft or published. |
| `/admin/assignments/[id]` | **The delivery matrix** — the "who delivered and who didn't" screen. Filter to outstanding, copy the chase list, approve / needs-rework with a comment, extend one team's deadline, download everything. |
| `/admin/teams` | Create teams from anyone in the class, move members between them, copy or rotate a team's link. |
| `/admin/students` | Bulk import, add one, edit, deactivate, remove. |
| `/admin/settings` | Semester name, student contact address, recognised video hosts, default size cap. |

**API**

| Route | Purpose |
|---|---|
| `POST /api/submit/[token]/[assignmentId]` | The upload endpoint. Streams multipart to disk, applies `submit.ts`, and redirects back with a **relative** `Location` — an absolute one built from the server's own hostname resolves to `0.0.0.0` inside a container. |
| `GET /api/files/[storedName]` | Serves one file to an admin, or to a holder of the owning team's token. `Cache-Control: private, no-store`. |
| `GET /api/admin/assignments/[id]/download` | Streams a whole assignment as one ZIP, foldered per team, with a `submissions.csv` index that includes the teams who did *not* deliver. |
| `GET /api/health` | Touches the database, so a 200 means it can actually serve a request. Used as the container healthcheck. |

`src/instrumentation.ts` runs at boot: it applies migrations and creates the
first admin from `ADMIN_EMAIL` / `ADMIN_PASSWORD`, so the container can be handed
over as "docker compose up" with no separate setup step to forget.

### Components — `src/components/`

`ui/` is shadcn/ui on Base UI. Everything above it is application-specific:
`site-shell` (the student frame), `admin-nav`, `submission-form`, `join-form`,
`team-card`, `new-team-form`, `student-list`, `add-student-form`,
`roster-import`, `assignment-form`, `review-controls`, `extension-control`,
`chase-list`, `status-badge`, `team-link-card`, `brand/aau-logo`.

Status is **never signalled by colour alone** — always an icon plus a label, so
it survives colour-blindness and printing.

### Scripts — `scripts/`

| Script | |
|---|---|
| `smoke-test.mjs` | 37 end-to-end checks against a running dev server: real multipart uploads, replacement, download, and the access-control boundaries. Reads the SQLite file directly, so it must run where that file is. |
| `verify-deployment.mjs` | The same core loop over **HTTP only**, so it can be pointed at the university server from a laptop. Delivers a file, checks the app's own page lists it, downloads it back byte-for-byte, and optionally restarts the container to prove the volume survives. |
| `login-test.mjs` | Drives the real login form the way a browser with JavaScript disabled would, and checks every admin route turns away a session-less request. |
| `admin-session.mjs` | Mints an admin session directly into the database, for testing admin pages without the login form. |

---

## Data model

```
students ──┬──< team_members >── teams ──< submissions >── assignments
           │                       │           │
           │                       │           └──< submission_files
           │                       └──< deadline_extensions >── assignments
           └───────────────────────────< submissions  (solo: student_id set)

admins ──< admin_sessions          settings          audit_log
```

`submissions.student_id` is `NULL` for a team delivery and set for a solo one,
which is exactly what the two partial unique indexes key on:

```sql
CREATE UNIQUE INDEX submissions_team_unique
  ON submissions (assignment_id, team_id)     WHERE student_id IS NULL;
CREATE UNIQUE INDEX submissions_student_unique
  ON submissions (assignment_id, student_id)  WHERE student_id IS NOT NULL;
```

That null is load-bearing, and it is why removing a student deletes their solo
submissions explicitly rather than letting the `ON DELETE SET NULL` foreign key
quietly turn one into a team delivery.

---

## Development

```bash
npm install
npm run db:seed      # fake cohort; prints working team links
npm run dev
```

The seed prints team links and the admin credentials (`admin@aau.dk` /
`changeme123`). `RESEED=1 npm run db:seed` wipes and starts over. Local data
lives in `./.data` (`DATA_DIR` overrides it).

| Command | |
|---|---|
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build and run |
| `npm test` | Unit tests — deadlines, timezone handling, roster parsing |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run db:generate` | Regenerate migrations after editing `src/db/schema.ts` |
| `npm run db:seed` | Seed a fake cohort |
| `npm run smoke` | End-to-end checks against a running dev server |
| `npm run verify` | End-to-end checks against a deployed instance, over HTTP only |
| `npm run test:auth` | Admin login and route protection |

### Testing

```bash
npm test                 # unit tests
npm run dev              # in one terminal
npm run smoke            # in another — real uploads over real HTTP
```

The smoke suite asserts the boundaries that matter: one team cannot download
another's files, a non-member cannot submit, an unpublished draft rejects
deliveries, and a replaced file's bytes are removed from disk.

To check something already deployed, where you have a URL and nothing else:

```bash
npm run verify -- https://delivery.example.aau.dk <teamToken> \
  --size 50000000 --restart-cmd "docker compose restart app"
```

`--size` proves the reverse proxy accepts large uploads (it names a 413 as
`client_max_body_size` explicitly); `--restart-cmd` proves the volume is mounted
where the app actually writes.

> Use `verify`, not `smoke`, against a container. `smoke` reads `app.db` from the
> host while the container has it open, and SQLite's locking does not reliably
> cross a bind mount.

---

## Deployment

```bash
cp .env.example .env      # set ADMIN_EMAIL and a strong ADMIN_PASSWORD
docker compose up -d --build
```

The database and every uploaded file live in `./data`, mounted into the container
at `/data`. That directory is entirely separate from the image, so rebuilding
replaces the application and never the data; migrations apply themselves at boot.
A backup is a copy of `data/` taken with the container stopped.

Full instructions — reverse proxy configuration, backup and restore, upgrades,
environment variables, security notes and known limitations — are in
[DEPLOYMENT.md](./DEPLOYMENT.md).

---

## Security posture

- **Students are not authenticated.** A team link is a 128-bit random token and
  is the only thing protecting that team's submissions. This was a deliberate
  trade for zero-friction delivery; the mitigations are the audit log and the
  one-click **Regenerate** in the admin panel. The student pages say so plainly.
- Admin passwords are bcrypt (cost 12). Sessions are opaque random tokens in an
  `HttpOnly`, `SameSite=Lax` cookie, `Secure` in production.
- Uploads are stored under UUID names and served only to an admin or to a holder
  of the owning team's token.
- The app makes no outbound network requests. Video links are stored as text and
  only ever rendered as links for a human to click.
- The container runs as an unprivileged user and writes only to `/data`.

## Known limitations

- Single instance only — SQLite plus a local uploads directory means no
  horizontal scaling. Sized for one course, not the faculty.
- A student belongs to exactly one team at a time. Teams can be re-cut between
  assignments, but not held simultaneously for different ones.
- No email is sent by the app; chasing is done by copying addresses out of the
  admin panel.
- An admin password can only be changed by an operator from the host.
