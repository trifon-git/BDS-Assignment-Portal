import path from "node:path";

/**
 * Everything the app needs to know about its environment, resolved once.
 *
 * DATA_DIR is the single directory the container mounts as a volume. Both the
 * database and the uploads live inside it, so "back up the app" means "copy one
 * directory" — which is the whole reason SQLite was chosen over a separate
 * database server for a university-hosted deployment.
 */
export const DATA_DIR =
  process.env.DATA_DIR ?? path.join(process.cwd(), ".data");

export const DB_PATH = path.join(DATA_DIR, "app.db");
export const UPLOADS_DIR = path.join(DATA_DIR, "uploads");

/** Hard ceiling on a single uploaded file, independent of the per-assignment
 *  cap an admin sets. Guards the disk even if an assignment is misconfigured. */
export const MAX_UPLOAD_BYTES = Number(
  process.env.MAX_UPLOAD_MB ?? 250,
) * 1024 * 1024;

/** How long an admin stays signed in. */
export const ADMIN_SESSION_DAYS = 14;
export const ADMIN_SESSION_COOKIE = "aau_admin_session";

/** Seeded on first boot when no admin exists yet. */
export const SEED_ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "";
export const SEED_ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "";
export const SEED_ADMIN_NAME = process.env.ADMIN_NAME ?? "Course responsible";

export const TIMEZONE = process.env.TIMEZONE ?? "Europe/Copenhagen";

/** Defaults for the settings table; admin-editable at /admin/settings. */
export const SETTING_DEFAULTS = {
  semester_name: "BDS — Autumn 2026",
  /** Short prefix for emails an admin sends by hand, e.g. "BDS · Week 4 ·
   *  Group 2 — ...". Kept separate from semester_name, which is too long for
   *  a subject line. */
  course_code: "BDS",
  /** Hosts we consider a legitimate place to put a screencast. Panopto first:
   *  it is the tool AAU supports and the one we point students at. */
  video_hosts:
    "panopto.eu,panopto.com,aau.dk,sharepoint.com,onedrive.live.com,1drv.ms,teams.microsoft.com,youtube.com,youtu.be,vimeo.com",
  default_max_file_size_mb: "200",
  /** Who a student writes to when their link stops working. There is no
   *  password reset in a system with no passwords, so this address is the
   *  entire recovery path and it appears on every student-facing page. */
  support_email: "trka@business.aau.dk",
} as const;

export type SettingKey = keyof typeof SETTING_DEFAULTS;
