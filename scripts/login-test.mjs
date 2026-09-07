/**
 * Exercises the admin login form the way a browser with JavaScript disabled
 * would: a plain multipart POST carrying the $ACTION_ID field Next renders into
 * the form. This is the progressive-enhancement path, so if it works the
 * hydrated path certainly does.
 */
const BASE = process.argv[2] ?? "http://localhost:3001";
const EMAIL = process.argv[3] ?? "ops@aau.dk";
const PASSWORD = process.argv[4] ?? "a-long-enough-password";

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const html = await (await fetch(`${BASE}/admin/login`)).text();
const field = html.match(/name="(\$ACTION_ID_[a-f0-9]+)"/)?.[1];
check("login form renders an action field", Boolean(field));
if (!field) process.exit(1);

async function attempt(email, password) {
  const body = new FormData();
  body.append(field, "");
  body.append("email", email);
  body.append("password", password);
  const res = await fetch(`${BASE}/admin/login`, {
    method: "POST",
    body,
    redirect: "manual",
  });
  const cookies = res.headers.getSetCookie?.() ?? [];
  return {
    status: res.status,
    session: cookies
      .map((c) => c.split(";")[0])
      .find((c) => c.startsWith("aau_admin_session=") && c.length > 20),
    location: res.headers.get("x-action-redirect") ?? res.headers.get("location") ?? "",
  };
}

const wrong = await attempt(EMAIL, "definitely-not-the-password");
check("wrong password is refused", !wrong.session, wrong.session ? "got a session!" : "");

const unknown = await attempt("nobody@aau.dk", "whatever");
check("unknown email is refused", !unknown.session);

const good = await attempt(EMAIL, PASSWORD);
check("correct credentials sign in", Boolean(good.session), good.session ? "" : `status ${good.status}`);

if (good.session) {
  const admin = await fetch(`${BASE}/admin`, {
    headers: { Cookie: good.session },
    redirect: "manual",
  });
  check("session opens the admin panel", admin.status === 200, `status ${admin.status}`);

  const noCookie = await fetch(`${BASE}/admin`, { redirect: "manual" });
  check("no session is redirected away", noCookie.status === 307, `status ${noCookie.status}`);

  for (const path of ["/admin/teams", "/admin/students", "/admin/settings", "/admin/assignments"]) {
    const r = await fetch(`${BASE}${path}`, { redirect: "manual" });
    check(`${path} is protected`, r.status === 307, `status ${r.status}`);
  }

  const dl = await fetch(`${BASE}/api/admin/assignments/1/download`, { redirect: "manual" });
  check("bulk download is protected", dl.status === 404, `status ${dl.status}`);
}

console.log(failures === 0 ? "\nAuth checks passed.\n" : `\n${failures} auth check(s) FAILED.\n`);
process.exit(failures === 0 ? 0 : 1);
