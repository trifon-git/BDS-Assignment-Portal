import { TIMEZONE } from "./config";

/**
 * Date rendering. Everything is stored as epoch milliseconds and displayed in
 * the university's timezone, so a deadline reads the same for a student on a
 * laptop in Aalborg and one visiting family abroad.
 */

const dateTime = new Intl.DateTimeFormat("en-GB", {
  timeZone: TIMEZONE,
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const dateOnly = new Intl.DateTimeFormat("en-GB", {
  timeZone: TIMEZONE,
  day: "numeric",
  month: "short",
  year: "numeric",
});

const timeOnly = new Intl.DateTimeFormat("en-GB", {
  timeZone: TIMEZONE,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function formatDeadline(ms: number): string {
  return dateTime.format(new Date(ms));
}

export function formatDate(ms: number): string {
  return dateOnly.format(new Date(ms));
}

export function formatTime(ms: number): string {
  return timeOnly.format(new Date(ms));
}

/** For <input type="datetime-local">, which wants local wall-clock time. */
export function toDateTimeLocal(ms: number): string {
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(ms));
  // sv-SE gives "2026-09-04 23:59"; the input wants a "T" separator.
  return parts.replace(" ", "T");
}

/**
 * Parse a datetime-local value as a wall-clock time in the university's
 * timezone.
 *
 * `new Date("2026-09-04T23:59")` would use the *server's* timezone, which in a
 * container is UTC — silently shifting every deadline by an hour or two. This
 * finds the true instant by measuring the offset at that date, which also gets
 * the summer-time boundary right.
 */
export function fromDateTimeLocal(value: string): number {
  // Parse strictly. `new Date("not-a-date:00Z")` is happily accepted by V8 as
  // the year 2000, which would turn a typo into a real-looking deadline.
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) return Number.NaN;

  const [, y, mo, d, h, mi] = match.map(Number) as unknown as number[];
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) {
    return Number.NaN;
  }

  const naive = Date.UTC(y, mo - 1, d, h, mi);
  // Reject dates that rolled over, e.g. 31 February.
  const check = new Date(naive);
  if (check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) {
    return Number.NaN;
  }

  const offset = timezoneOffsetAt(naive);
  // Re-measure once: near a DST switch the first guess can land on the wrong
  // side of the boundary.
  return naive - timezoneOffsetAt(naive - offset);
}

/** Milliseconds the timezone is ahead of UTC at a given instant. */
function timezoneOffsetAt(utcMs: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date(utcMs));

  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? "0");

  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") % 24,
    get("minute"),
    get("second"),
  );
  return asUtc - utcMs;
}
