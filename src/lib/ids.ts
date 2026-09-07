import { randomBytes, randomUUID } from "node:crypto";

/**
 * Identifier generation. All of it uses the CSPRNG, never Math.random —
 * `accessToken` below is the only thing standing between a stranger and a
 * team's submissions, so it has to be genuinely unguessable.
 */

/** 128-bit URL-safe team access token. Appears in /t/<token>. */
export function generateAccessToken(): string {
  return randomBytes(16).toString("base64url");
}

/**
 * Human-typable team code, e.g. "BDS-7K2P".
 *
 * The alphabet omits 0/O/1/I/L/U — the characters people misread when copying a
 * code off a slide, and U so the generator can't produce an unfortunate word.
 * At 4 characters this is ~1M combinations: fine for a class-sized namespace
 * with a uniqueness check on insert, and it is not the security boundary (the
 * token is).
 */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789";

export function generateShortCode(prefix = "BDS"): string {
  const bytes = randomBytes(4);
  let code = "";
  for (let i = 0; i < 4; i++) {
    code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return `${prefix}-${code}`;
}

/** Opaque admin session cookie value. */
export function generateSessionId(): string {
  return randomBytes(32).toString("base64url");
}

/** On-disk filename for an upload. Never derived from user input. */
export function generateStoredName(): string {
  return randomUUID();
}

/**
 * Normalise a code a student typed: trim, uppercase, and tolerate a missing
 * prefix or a space instead of the hyphen, so "bds 7k2p" and "7K2P" both work.
 */
export function normalizeShortCode(input: string, prefix = "BDS"): string {
  const cleaned = input.trim().toUpperCase().replace(/[\s_]+/g, "-");
  if (/^[A-Z]+-[A-Z0-9]+$/.test(cleaned)) return cleaned;
  return `${prefix}-${cleaned.replace(/^-+/, "")}`;
}
