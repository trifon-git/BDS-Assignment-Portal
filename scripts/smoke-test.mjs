/**
 * End-to-end smoke test of the student delivery loop against a running dev
 * server. Exercises the real HTTP paths — multipart upload, replacement,
 * validation, and access control — rather than calling the functions directly,
 * because the interesting failures live in the wiring.
 *
 * Usage: node scripts/smoke-test.mjs [baseUrl]
 *
 * DATA_DIR points at the data directory to inspect, for when the server under
 * test does not use the default .data.
 */
import Database from "better-sqlite3";

const BASE = process.argv[2] ?? "http://localhost:3000";
const DATA_DIR = process.env.DATA_DIR ?? ".data";
const DB_FILE = `${DATA_DIR}/app.db`;

/**
 * A fresh connection per statement, so every assertion reads the newest
 * committed state rather than a snapshot taken when the suite started.
 *
 * Point this at the dev server, which owns the file it writes. Pointing it at a
 * container is a trap: the database is then being written from inside the
 * container and read from the host across a bind mount, SQLite's locking does
 * not reliably span that boundary, and the failures you get are the suite's own
 * rather than the app's. Use `npm run verify` for a container — it is HTTP-only.
 */
const db = {
  prepare(sql) {
    const run = (method, args) => {
      const conn = new Database(DB_FILE, { readonly: true });
      try {
        return conn.prepare(sql)[method](...args);
      } finally {
        conn.close();
      }
    };
    return {
      get: (...args) => run("get", args),
      all: (...args) => run("all", args),
    };
  },
};

let failures = 0;
function check(name, condition, detail = "") {
  const mark = condition ? "PASS" : "FAIL";
  if (!condition) failures++;
  console.log(`  ${mark}  ${name}${detail ? ` — ${detail}` : ""}`);
}

/*
 * Teams belong to an assignment, so the fixtures are picked assignment-first:
 * find the assignment, then a team that was formed for it. A token from one
 * assignment is meaningless on another, which is itself one of the boundaries
 * this suite checks.
 */
const teamAssignment = db
  .prepare(
    `select * from assignments
     where mode='team' and published_at is not null and due_at > ? limit 1`,
  )
  .get(Date.now());
const soloAssignment = db
  .prepare(
    "select * from assignments where mode='solo' and published_at is not null limit 1",
  )
  .get();
const draft = db
  .prepare("select * from assignments where published_at is null limit 1")
  .get();

const teamFor = (assignmentId) =>
  db
    .prepare(
      "select id, name, access_token, short_code from teams where assignment_id = ? order by id limit 1",
    )
    .get(assignmentId);

const team = teamFor(teamAssignment.id);
const soloTeam = teamFor(soloAssignment.id);
const members = db
  .prepare(
    `select s.id, s.name from team_members tm
     join students s on s.id = tm.student_id where tm.team_id = ?`,
  )
  .all(team.id);
const soloMembers = db
  .prepare(
    `select s.id, s.name from team_members tm
     join students s on s.id = tm.student_id where tm.team_id = ?`,
  )
  .all(soloTeam.id);
// Another team on the *same* assignment: the sharpest version of the
// cross-team download check, since both could plausibly hold the file.
const otherTeam = db
  .prepare(
    "select id, access_token from teams where assignment_id = ? and id != ? limit 1",
  )
  .get(teamAssignment.id, team.id);

const TOKEN = team.access_token;
const SOLO_TOKEN = soloTeam.access_token;
// getRandomValues caps at 64 KB per call, so fill in chunks.
function randomBytes(size) {
  const out = new Uint8Array(size);
  for (let i = 0; i < size; i += 65536) {
    crypto.getRandomValues(out.subarray(i, Math.min(i + 65536, size)));
  }
  return out;
}
const zip = new Blob([randomBytes(900_000)], { type: "application/zip" });

const post = (assignmentId, fields, token = TOKEN) => {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (v instanceof Blob) body.append(k, v, fields.__filename ?? "file.zip");
    else if (k !== "__filename") body.append(k, String(v));
  }
  return fetch(`${BASE}/api/submit/${token}/${assignmentId}`, {
    method: "POST",
    body,
    redirect: "manual",
  });
};

const locationOf = (res) => res.headers.get("location") ?? "";

console.log(`\nTeam: ${team.name} (${team.short_code})`);
console.log(`Members: ${members.map((m) => m.name).join(", ")}\n`);

/* -------------------------------------------------------------------------- */
console.log("Team delivery");
{
  const res = await post(teamAssignment.id, {
    submittedBy: members[1].id,
    videoUrl: "https://aaudk.cloud.panopto.eu/Panopto/Pages/Viewer.aspx?id=abc",
    videoShareConfirmed: "on",
    note: "Smoke test delivery",
    files: zip,
    __filename: "solution.zip",
  });
  const loc = locationOf(res);
  check("upload accepted", res.status === 303 && loc.includes("ok=1"), loc);
  // Relative, so the browser resolves it against the host the student typed.
  // An absolute one built from the server's hostname is 0.0.0.0 in a container.
  check("redirect is relative", loc.startsWith("/"), loc);

  const row = db
    .prepare(
      "select * from submissions where assignment_id=? and team_id=? and student_id is null",
    )
    .get(teamAssignment.id, team.id);
  check("submission row written", Boolean(row));
  check("attributed to the chosen member", row?.submitted_by_student_id === members[1].id);
  check("not marked late (deadline is open)", row?.is_late === 0);

  const files = db
    .prepare("select * from submission_files where submission_id=?")
    .all(row.id);
  check("exactly one file recorded", files.length === 1, `got ${files.length}`);
  check("byte count matches what was sent", files[0]?.size_bytes === 900_000,
    `got ${files[0]?.size_bytes}`);

  // The bytes must actually be on disk, not just in the database.
  const fs = await import("node:fs");
  const onDisk = fs.existsSync(`${DATA_DIR}/uploads/${files[0].stored_name}`);
  check("bytes present on disk", onDisk);

  const dl = await fetch(
    `${BASE}/api/files/${files[0].stored_name}?t=${TOKEN}`,
  );
  check("owner can download it", dl.status === 200, `status ${dl.status}`);
  check(
    "download is the right size",
    dl.headers.get("content-length") === "900000",
  );

  const stolen = await fetch(
    `${BASE}/api/files/${files[0].stored_name}?t=${otherTeam.access_token}`,
  );
  check("another team cannot download it", stolen.status === 404,
    `status ${stolen.status}`);

  const anon = await fetch(`${BASE}/api/files/${files[0].stored_name}`);
  check("no token cannot download it", anon.status === 404,
    `status ${anon.status}`);
}

/* -------------------------------------------------------------------------- */
console.log("\nReplacement");
{
  const before = db
    .prepare(
      "select * from submissions where assignment_id=? and team_id=? and student_id is null",
    )
    .get(teamAssignment.id, team.id);
  const oldFiles = db
    .prepare("select * from submission_files where submission_id=?")
    .all(before.id);

  const res = await post(teamAssignment.id, {
    submittedBy: members[0].id,
    videoUrl: "https://aaudk.cloud.panopto.eu/Panopto/Pages/Viewer.aspx?id=xyz",
    videoShareConfirmed: "on",
    note: "Replaced",
    files: zip,
    __filename: "solution-v2.zip",
  });
  check("replacement accepted", locationOf(res).includes("ok=1"));

  const after = db
    .prepare(
      "select * from submissions where assignment_id=? and team_id=? and student_id is null",
    )
    .all(teamAssignment.id, team.id);
  check("still exactly one submission row", after.length === 1,
    `got ${after.length}`);
  check("re-attributed to the new submitter",
    after[0].submitted_by_student_id === members[0].id);

  const newFiles = db
    .prepare("select * from submission_files where submission_id=?")
    .all(before.id);
  check("old file row replaced", newFiles.length === 1);
  check("filename updated", newFiles[0].original_name === "solution-v2.zip",
    newFiles[0].original_name);

  const fs = await import("node:fs");
  check("old bytes deleted from disk",
    !fs.existsSync(`${DATA_DIR}/uploads/${oldFiles[0].stored_name}`));
}

/* -------------------------------------------------------------------------- */
console.log("\nValidation");
{
  const noVideo = await post(teamAssignment.id, {
    submittedBy: members[0].id,
    files: zip,
    __filename: "x.zip",
  });
  check("missing required video is rejected",
    locationOf(noVideo).includes("error="), locationOf(noVideo));

  const unconfirmed = await post(teamAssignment.id, {
    submittedBy: members[0].id,
    videoUrl: "https://aaudk.cloud.panopto.eu/x",
    files: zip,
    __filename: "x.zip",
  });
  check("unconfirmed video sharing is rejected",
    locationOf(unconfirmed).includes("error="));

  const badExt = await post(teamAssignment.id, {
    submittedBy: members[0].id,
    videoUrl: "https://aaudk.cloud.panopto.eu/x",
    videoShareConfirmed: "on",
    files: new Blob(["#!/bin/sh"], { type: "text/plain" }),
    __filename: "script.sh",
  });
  check("disallowed extension is rejected",
    locationOf(badExt).includes("error="), locationOf(badExt));

  const outsider = await post(teamAssignment.id, {
    // A roster id that belongs to a different team.
    submittedBy: db
      .prepare(
        "select student_id from team_members where assignment_id = ? and team_id != ? limit 1",
      )
      .get(teamAssignment.id, team.id).student_id,
    videoUrl: "https://aaudk.cloud.panopto.eu/x",
    videoShareConfirmed: "on",
    files: zip,
    __filename: "x.zip",
  });
  check("non-member cannot submit for this team",
    locationOf(outsider).includes("error="));

  const draftRes = await post(draft.id, {
    submittedBy: members[0].id,
    files: zip,
    __filename: "x.zip",
  });
  check("unpublished draft rejects delivery",
    locationOf(draftRes).includes("error="));

  // A team's code must not reach another assignment's brief, even a published
  // one — this is the boundary that per-assignment teams exist to draw.
  const wrongAssignment = await post(soloAssignment.id, {
    submittedBy: members[0].id,
    files: zip,
    __filename: "x.zip",
  });
  check("a team code is refused on another assignment",
    locationOf(wrongAssignment).includes("error="),
    locationOf(wrongAssignment));

  const badToken = await post(teamAssignment.id, {
    submittedBy: members[0].id,
    files: zip,
    __filename: "x.zip",
  }, "not-a-real-token");
  check("invalid team token is rejected",
    locationOf(badToken).includes("error="));
}

/* -------------------------------------------------------------------------- */
console.log("\nSolo delivery");
{
  const target = soloMembers[2];
  const res = await post(soloAssignment.id, {
    submittedBy: target.id,
    studentId: target.id,
    files: new Blob([new Uint8Array(2048)], { type: "application/pdf" }),
    __filename: "reflection.pdf",
  }, SOLO_TOKEN);
  check("solo upload accepted", locationOf(res).includes("ok=1"),
    locationOf(res));

  const row = db
    .prepare(
      "select * from submissions where assignment_id=? and student_id=?",
    )
    .get(soloAssignment.id, target.id);
  check("attributed to that individual", Boolean(row));
  check("marked late (deadline passed)", row?.is_late === 1);

  const others = db
    .prepare(
      "select count(*) c from submissions where assignment_id=? and student_id=?",
    )
    .get(soloAssignment.id, soloMembers[1].id);
  check("a teammate's own row is unaffected", others.c <= 1);
}

/* -------------------------------------------------------------------------- */
console.log("\nPage rendering");
for (const [name, path, expect] of [
  ["landing", "/", 200],
  ["team dashboard", `/t/${TOKEN}`, 200],
  ["assignment page", `/t/${TOKEN}/a/${teamAssignment.id}`, 200],
  ["solo assignment page", `/t/${SOLO_TOKEN}/a/${soloAssignment.id}`, 200],
  ["another assignment is not reachable", `/t/${TOKEN}/a/${soloAssignment.id}`, 404],
  ["draft hidden from students", `/t/${TOKEN}/a/${draft.id}`, 404],
  ["unknown team token", "/t/does-not-exist", 404],
]) {
  const res = await fetch(`${BASE}${path}`);
  check(name, res.status === expect, `status ${res.status}`);
}

console.log(
  failures === 0
    ? "\nAll smoke checks passed.\n"
    : `\n${failures} smoke check(s) FAILED.\n`,
);
// Connections are opened and closed per statement; nothing to close here.
process.exit(failures === 0 ? 0 : 1);
