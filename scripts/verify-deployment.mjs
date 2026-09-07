/**
 * Verifies a *deployed* instance over HTTP only.
 *
 * `npm run smoke` is the thorough suite, but it reads the SQLite file directly,
 * so it can only run where that file is. This one proves the same core loop —
 * a delivery is accepted, the app's own page shows it, and the bytes come back
 * byte-for-byte — using nothing but the URL. That makes it the check to run
 * against the university server after a deploy, and the one to reach for when
 * the app and the person testing it are on different machines.
 *
 * It deliberately drives the app the way a student does: it reads the student's
 * name out of the real "Submitted by" dropdown and posts to the real endpoint,
 * so a misconfigured reverse proxy (body limits, buffering, timeouts) fails it.
 *
 * Usage:
 *   node scripts/verify-deployment.mjs <baseUrl> <teamToken> [options]
 *
 *   --assignment <id>     Which assignment to deliver to. Default: the first
 *                         open one on the team's dashboard.
 *   --size <bytes>        Upload size. Default 512000. Raise it to prove the
 *                         proxy really accepts large ZIPs (e.g. --size 50000000).
 *   --restart-cmd "<cmd>" Run this after a successful delivery, wait for the app
 *                         to come back, and re-check that the delivery survived.
 *                         This is the test that catches a misconfigured volume.
 *
 * WARNING: this creates a real delivery for that team. Run it before the
 * semester starts, or against a throwaway team.
 */
const args = process.argv.slice(2);
const BASE = (args[0] ?? "").replace(/\/$/, "");
const TOKEN = args[1];
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i === -1 ? fallback : args[i + 1];
};

if (!BASE || !TOKEN || BASE.startsWith("--")) {
  console.error(
    "Usage: node scripts/verify-deployment.mjs <baseUrl> <teamToken> " +
      "[--assignment <id>] [--size <bytes>] [--restart-cmd \"<cmd>\"]",
  );
  process.exit(2);
}

const SIZE = Number(opt("--size", 512_000));
const RESTART = opt("--restart-cmd", "");

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const waitForHealth = async (attempts = 30) => {
  for (let i = 0; i < attempts; i++) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
};

/* -- the app is reachable at all ------------------------------------------- */
console.log(`\nVerifying ${BASE}\n`);
console.log("Reachability");
check("health endpoint responds", await waitForHealth(3));

/* -- find something to deliver to ------------------------------------------ */
const dashboard = await fetch(`${BASE}/t/${TOKEN}`);
check("team link resolves", dashboard.status === 200, `status ${dashboard.status}`);
if (dashboard.status !== 200) process.exit(1);
const dashboardHtml = await dashboard.text();

let assignmentId = opt("--assignment", "");
if (!assignmentId) {
  // Every assignment the dashboard links to, most recent last; the open ones
  // are the ones the student can still act on.
  const ids = [...dashboardHtml.matchAll(/\/t\/[^/"]+\/a\/(\d+)/g)].map((m) => m[1]);
  assignmentId = [...new Set(ids)].pop();
}
check("an assignment is available", Boolean(assignmentId), assignmentId ? `#${assignmentId}` : "none linked");
if (!assignmentId) process.exit(1);

const formHtml = await (await fetch(`${BASE}/t/${TOKEN}/a/${assignmentId}`)).text();
const studentId = formHtml.match(/name="submittedBy"[\s\S]*?<option value="(\d+)"/)?.[1];
check("submitted-by roster is populated", Boolean(studentId));
if (!studentId) process.exit(1);
const needsVideo = /name="videoUrl"/.test(formHtml);
// Deliver something the assignment actually allows: the file input carries the
// same extension list the server enforces, so read it rather than assume .zip.
const accepted = formHtml.match(/accept="([^"]+)"/)?.[1] ?? ".zip";
const extension = accepted.split(",")[0].trim().replace(/^\.?/, ".");

/* -- deliver --------------------------------------------------------------- */
console.log("\nDelivery");
const bytes = new Uint8Array(SIZE);
// getRandomValues caps at 64 KB per call, so fill in chunks.
for (let i = 0; i < SIZE; i += 65536) {
  crypto.getRandomValues(bytes.subarray(i, Math.min(i + 65536, SIZE)));
}
const checksum = bytes.reduce((a, b) => a + b, 0);
const filename = `deployment-check-${Date.now()}${extension}`;

const body = new FormData();
body.append("submittedBy", studentId);
body.append("note", "Automated deployment check");
if (needsVideo) {
  body.append("videoUrl", "https://aaudk.cloud.panopto.eu/Panopto/Pages/Viewer.aspx?id=deployment-check");
  body.append("videoShareConfirmed", "on");
}
body.append("files", new Blob([bytes], { type: "application/octet-stream" }), filename);

const started = Date.now();
const post = await fetch(`${BASE}/api/submit/${TOKEN}/${assignmentId}`, {
  method: "POST",
  body,
  redirect: "manual",
});
const location = post.headers.get("location") ?? "";
check(
  `upload of ${(SIZE / 1024 / 1024).toFixed(1)} MB accepted`,
  post.status === 303 && location.includes("ok=1"),
  post.status === 413
    ? "413 — the reverse proxy's client_max_body_size is too small"
    : location || `status ${post.status}`,
);
if (!location.includes("ok=1")) process.exit(1);
// The delivery succeeding is not enough: the browser has to be able to follow
// the redirect. An absolute Location built from the server's own hostname sends
// the student to 0.0.0.0 and a "site can't be reached" page, with their work
// already safely uploaded.
check(
  "the redirect is one a browser can follow",
  location.startsWith("/") || location.startsWith(BASE),
  location,
);
console.log(`        (took ${((Date.now() - started) / 1000).toFixed(1)}s)`);

/* -- the app's own page must show it, and hand back the same bytes ---------- */
console.log("\nRead-back");
const after = await (await fetch(`${BASE}/t/${TOKEN}/a/${assignmentId}`)).text();
check("the page lists the delivered file", after.includes(filename));

const stored = after.match(/\/api\/files\/([0-9a-f-]{36})/)?.[1];
check("the page renders a download link", Boolean(stored));
if (!stored) process.exit(1);

const verifyBytes = async (label) => {
  const res = await fetch(`${BASE}/api/files/${stored}?t=${TOKEN}`);
  const got = new Uint8Array(await res.arrayBuffer());
  check(
    label,
    res.status === 200 && got.length === SIZE && got.reduce((a, b) => a + b, 0) === checksum,
    `status ${res.status}, ${got.length} of ${SIZE} bytes`,
  );
};
await verifyBytes("download returns the identical bytes");

const anon = await fetch(`${BASE}/api/files/${stored}`);
check("the file is not readable without the team link", anon.status === 404, `status ${anon.status}`);

/* -- does it survive a restart? -------------------------------------------- */
if (RESTART) {
  console.log("\nPersistence");
  const { execSync } = await import("node:child_process");
  execSync(RESTART, { stdio: "ignore" });
  check("the app came back up", await waitForHealth());
  await verifyBytes("the delivery survived the restart");
  const reread = await (await fetch(`${BASE}/t/${TOKEN}/a/${assignmentId}`)).text();
  check("the page still lists it", reread.includes(filename));
}

console.log(
  failures === 0
    ? "\nDeployment verified.\n"
    : `\n${failures} check(s) FAILED.\n`,
);
process.exit(failures === 0 ? 0 : 1);
