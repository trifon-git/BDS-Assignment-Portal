import "server-only";

import { eq } from "drizzle-orm";

import { db } from "@/db";
import { settings } from "@/db/schema";
import { SETTING_DEFAULTS, type SettingKey } from "./config";

export type { SettingKey };

/**
 * Admin-editable settings, read through a defaults map so a missing row never
 * breaks a page and adding a setting never needs a migration.
 */

export async function getSetting(key: SettingKey): Promise<string> {
  const row = await db.query.settings.findFirst({
    where: eq(settings.key, key),
  });
  return row?.value ?? SETTING_DEFAULTS[key];
}

export async function getAllSettings(): Promise<Record<SettingKey, string>> {
  const rows = await db.select().from(settings);
  const stored = new Map(rows.map((r) => [r.key, r.value]));

  return Object.fromEntries(
    Object.entries(SETTING_DEFAULTS).map(([key, fallback]) => [
      key,
      stored.get(key) ?? fallback,
    ]),
  ) as Record<SettingKey, string>;
}

export async function setSetting(
  key: SettingKey,
  value: string,
): Promise<void> {
  await db
    .insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } });
}

/* -------------------------------------------------------------------------- */
/* Video links                                                                 */
/* -------------------------------------------------------------------------- */

export interface VideoUrlCheck {
  valid: boolean;
  /** True when the host is on the allow-list. A false here is a warning shown
   *  to the student, not a rejection — an unusual but working link should not
   *  block a delivery an hour before the deadline. */
  recognisedHost: boolean;
  host: string | null;
  message: string | null;
}

/**
 * Validate a video link.
 *
 * Panopto is what AAU supports and what the UI recommends, but the allow-list
 * is a setting rather than a constant so the host list can be corrected without
 * a redeploy — university tooling changes more often than this app will.
 */
export function checkVideoUrl(
  raw: string,
  allowedHosts: string,
): VideoUrlCheck {
  const trimmed = raw.trim();
  if (!trimmed) {
    return {
      valid: false,
      recognisedHost: false,
      host: null,
      message: "A video link is required for this assignment.",
    };
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return {
      valid: false,
      recognisedHost: false,
      host: null,
      message:
        "That does not look like a link. Paste the full address, starting with https://",
    };
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return {
      valid: false,
      recognisedHost: false,
      host: url.hostname,
      message: "The link must start with https://",
    };
  }

  const hosts = allowedHosts
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);

  const hostname = url.hostname.toLowerCase();
  const recognised = hosts.some(
    (h) => hostname === h || hostname.endsWith(`.${h}`),
  );

  return {
    valid: true,
    recognisedHost: recognised,
    host: url.hostname,
    message: recognised
      ? null
      : `${url.hostname} is not one of the usual video hosts. Double-check the ` +
        `link works — Panopto is what we recommend.`,
  };
}
