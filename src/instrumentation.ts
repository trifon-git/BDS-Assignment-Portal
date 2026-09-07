/**
 * Boot-time setup.
 *
 * Runs once when the server starts, before the first request. This is what lets
 * the container be handed to university IT as "docker compose up": migrations
 * apply themselves and the first admin account exists, with no separate setup
 * step for someone to forget.
 */
export async function register() {
  // Only the Node.js runtime has a filesystem and the SQLite driver.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { runMigrations, db } = await import("@/db");
  const { admins } = await import("@/db/schema");
  const {
    SEED_ADMIN_EMAIL,
    SEED_ADMIN_PASSWORD,
    SEED_ADMIN_NAME,
    DATA_DIR,
  } = await import("@/lib/config");

  runMigrations();
  console.log(`[startup] database ready in ${DATA_DIR}`);

  const existing = db.select().from(admins).all();
  if (existing.length > 0) return;

  if (!SEED_ADMIN_EMAIL || !SEED_ADMIN_PASSWORD) {
    console.warn(
      "[startup] No admin account exists and ADMIN_EMAIL / ADMIN_PASSWORD are " +
        "not set. Set them and restart, or nobody can sign in to the admin panel.",
    );
    return;
  }

  if (SEED_ADMIN_PASSWORD.length < 12) {
    console.warn(
      "[startup] ADMIN_PASSWORD is shorter than 12 characters. This account " +
        "can read every submission in the course — please use a longer one.",
    );
  }

  const bcrypt = (await import("bcryptjs")).default;
  db.insert(admins)
    .values({
      name: SEED_ADMIN_NAME,
      email: SEED_ADMIN_EMAIL.trim().toLowerCase(),
      passwordHash: bcrypt.hashSync(SEED_ADMIN_PASSWORD, 12),
    })
    .run();

  console.log(`[startup] created first admin account: ${SEED_ADMIN_EMAIL}`);
}
