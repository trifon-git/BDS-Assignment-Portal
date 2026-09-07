import "server-only";

import bcrypt from "bcryptjs";
import { and, eq, gt, lt } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { db } from "@/db";
import { adminSessions, admins, auditLog, type Admin } from "@/db/schema";
import { ADMIN_SESSION_COOKIE, ADMIN_SESSION_DAYS } from "./config";
import { generateSessionId } from "./ids";

/**
 * Admin authentication.
 *
 * Students have no login at all — a team link is their credential — but the
 * admin panel holds every submission for the whole class, so it gets a real
 * password, a server-side session, and an audit trail.
 */

const SESSION_MS = ADMIN_SESSION_DAYS * 24 * 60 * 60 * 1000;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(
  password: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/**
 * Check an email/password pair.
 *
 * When the email is unknown we still run a bcrypt comparison against a dummy
 * hash. Returning early would make "no such account" measurably faster than
 * "wrong password" and turn the login form into an account enumerator.
 */
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", 12);

export async function authenticate(
  email: string,
  password: string,
): Promise<Admin | null> {
  const admin = await db.query.admins.findFirst({
    where: eq(admins.email, email.trim().toLowerCase()),
  });

  const ok = await verifyPassword(password, admin?.passwordHash ?? DUMMY_HASH);
  return ok && admin ? admin : null;
}

export async function createSession(adminId: number): Promise<string> {
  const id = generateSessionId();
  await db.insert(adminSessions).values({
    id,
    adminId,
    expiresAt: Date.now() + SESSION_MS,
  });

  const store = await cookies();
  store.set(ADMIN_SESSION_COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    // The university serves this over HTTPS; in local dev it is plain http.
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MS / 1000,
  });

  return id;
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  const id = store.get(ADMIN_SESSION_COOKIE)?.value;
  if (id) await db.delete(adminSessions).where(eq(adminSessions.id, id));
  store.delete(ADMIN_SESSION_COOKIE);
}

/** The signed-in admin, or null. Safe to call from any server component. */
export async function getCurrentAdmin(): Promise<Admin | null> {
  const store = await cookies();
  const id = store.get(ADMIN_SESSION_COOKIE)?.value;
  if (!id) return null;

  const row = await db
    .select({ admin: admins })
    .from(adminSessions)
    .innerJoin(admins, eq(adminSessions.adminId, admins.id))
    .where(
      and(eq(adminSessions.id, id), gt(adminSessions.expiresAt, Date.now())),
    )
    .get();

  return row?.admin ?? null;
}

/**
 * Guard for admin pages and actions. Server Actions are reachable by direct
 * POST, so every one of them calls this rather than assuming the page already
 * checked.
 */
export async function requireAdmin(): Promise<Admin> {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");
  return admin;
}

/** Remove expired rows. Called opportunistically on login. */
export async function pruneSessions(): Promise<void> {
  await db.delete(adminSessions).where(lt(adminSessions.expiresAt, Date.now()));
}

/* -------------------------------------------------------------------------- */
/* Audit                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Record an action. This is what makes a shared team link accountable: the
 * roster name the student picked, plus the request IP, plus what they did.
 */
export async function recordAudit(entry: {
  action: string;
  actorName?: string | null;
  teamId?: number | null;
  detail?: string | null;
}): Promise<void> {
  let ip: string | null = null;
  try {
    const h = await headers();
    ip =
      h.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      h.get("x-real-ip") ??
      null;
  } catch {
    // Outside a request context (e.g. the seed script) there are no headers.
  }

  await db.insert(auditLog).values({
    action: entry.action,
    actorName: entry.actorName ?? null,
    teamId: entry.teamId ?? null,
    detail: entry.detail ?? null,
    ip,
  });
}
