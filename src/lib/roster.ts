/**
 * Roster parsing.
 *
 * The class list arrives as whatever the study administration exports — a CSV,
 * a column pasted out of Excel, a block of addresses copied from an email. This
 * accepts all of those rather than demanding one exact format, because the
 * alternative is the teacher hand-editing a file before every import.
 *
 * Pure and dependency-free so it can be tested directly.
 */

export interface RosterEntry {
  name: string;
  email: string;
}

const EMAIL = /[\w.+-]+@[\w.-]+\.\w{2,}/;

/** Does this look like a single address? Used when one is typed by hand rather
 *  than pasted in a list. Deliberately the same rule as the bulk import, so a
 *  name that imports fine cannot be rejected when added individually. */
export function isEmailish(value: string): boolean {
  const trimmed = value.trim();
  return new RegExp(`^${EMAIL.source}$`).test(trimmed);
}

export function parseRoster(raw: string): RosterEntry[] {
  // Keyed by email so the same address pasted twice collapses to one entry.
  const out = new Map<string, RosterEntry>();

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const match = EMAIL.exec(trimmed);
    if (!match) continue;

    const email = match[0].toLowerCase();

    let name = trimmed
      .replace(match[0], "")
      // Strip the separators and decorations these formats bring with them.
      .replace(/[<>,;"']/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    // A trailing CSV column such as a study number is not a name.
    if (/^\d+$/.test(name)) name = "";

    if (!name) name = nameFromEmail(email);

    out.set(email, { name, email });
  }

  return [...out.values()];
}

/** "amalie.soerensen" -> "Amalie Soerensen". A reasonable placeholder the
 *  teacher can correct, rather than leaving the row blank. */
function nameFromEmail(email: string): string {
  return (
    email
      .split("@")[0]
      .split(/[._-]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ") || email
  );
}
