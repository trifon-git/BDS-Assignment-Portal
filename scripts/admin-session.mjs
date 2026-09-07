/**
 * Mints an admin session straight into the database and prints the cookie, so
 * smoke tests can exercise admin pages without driving the login form's Server
 * Action over raw HTTP. The login form itself is covered separately.
 */
import Database from "better-sqlite3";
import { randomBytes } from "node:crypto";

const db = new Database(`${process.env.DATA_DIR ?? ".data"}/app.db`);
const admin = db.prepare("select id, email from admins limit 1").get();
if (!admin) { console.error("no admin in database; run npm run db:seed"); process.exit(1); }

const id = randomBytes(32).toString("base64url");
db.prepare(
  "insert into admin_sessions (id, admin_id, expires_at) values (?,?,?)",
).run(id, admin.id, Date.now() + 3600_000);

console.log(`aau_admin_session=${id}`);
db.close();
