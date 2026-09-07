// Deliberately no `server-only` guard: the seed script and the migration
// runner import this module outside the Next.js runtime. The modules that wrap
// it (auth, storage, team-access, settings) carry the guard instead.
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { DB_PATH, DATA_DIR, UPLOADS_DIR } from "@/lib/config";
import * as schema from "./schema";

type Db = ReturnType<typeof drizzle<typeof schema>>;

/**
 * One SQLite connection per process, opened on first use and cached on
 * globalThis.
 *
 * **Lazy on purpose.** Opening the database as a side effect of importing this
 * module means anything that transitively imports it opens a connection, even
 * when it never runs a query. `next build` collects page data in fifteen worker
 * processes; each one imported this module through the shared page shell, each
 * one raced to run `PRAGMA journal_mode = WAL`, and the build died with
 * SQLITE_BUSY. A build should not need a database at all, and now it does not.
 *
 * **Cached on purpose.** The cache is not a development convenience either — a
 * built Next app evaluates this module once per bundler layer, so without it
 * the server-component layer and the layer that renders client components each
 * open their own connection to the same file. That is wasteful everywhere, and
 * fatal where a second concurrent open fails. It also keeps `next dev` from
 * leaking a file handle on every hot reload.
 */
const globalForDb = globalThis as unknown as {
  __aauSqlite?: Database.Database;
  __aauDb?: Db;
};

function openDatabase(): Database.Database {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });

  const connection = new Database(DB_PATH);

  // First, so every pragma below waits its turn rather than throwing the
  // moment another process holds the lock.
  connection.pragma("busy_timeout = 5000");
  // WAL lets the admin panel read while a student's submission is being
  // written, which is the only real concurrency this app ever sees.
  connection.pragma("journal_mode = WAL");
  // Without this, the ON DELETE CASCADE rules in the schema are silently
  // ignored — SQLite has foreign keys off by default per connection.
  connection.pragma("foreign_keys = ON");

  return connection;
}

function connection(): Database.Database {
  return (globalForDb.__aauSqlite ??= openDatabase());
}

function client(): Db {
  return (globalForDb.__aauDb ??= drizzle(connection(), { schema }));
}

/**
 * Both exports are lazy proxies: the connection is opened by the first property
 * access, not by the import. Methods are bound to the real instance so
 * `db.transaction(...)` and `sqlite.prepare(...)` behave normally.
 */
function lazy<T extends object>(resolve: () => T): T {
  return new Proxy({} as T, {
    get(_target, property) {
      const target = resolve() as Record<string | symbol, unknown>;
      const value = target[property];
      return typeof value === "function" ? value.bind(target) : value;
    },
    has: (_target, property) => property in (resolve() as object),
  });
}

export const sqlite: Database.Database = lazy(connection);
export const db: Db = lazy(client);

/**
 * Applies any pending migrations from ./drizzle. Called from instrumentation on
 * boot so a fresh container comes up with a working database and the operator
 * never has to run a migration step by hand.
 */
export function runMigrations() {
  const migrationsFolder = path.join(process.cwd(), "drizzle");
  if (!fs.existsSync(migrationsFolder)) return;

  migrate(client(), { migrationsFolder });
}

export { schema };
