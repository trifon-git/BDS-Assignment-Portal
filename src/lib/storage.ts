import "server-only";

import fs from "node:fs";
import path from "node:path";
import { createWriteStream } from "node:fs";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

import { MAX_UPLOAD_BYTES, UPLOADS_DIR } from "./config";
import { generateStoredName } from "./ids";

/**
 * The single choke point for reading and writing uploaded files.
 *
 * Nothing else in the app touches the filesystem, so the rules that keep a
 * student-supplied filename from escaping the uploads directory live in exactly
 * one place.
 */

export interface StoredFile {
  storedName: string;
  originalName: string;
  sizeBytes: number;
  mimeType: string | null;
}

/**
 * Absolute path for a stored file, refusing anything that isn't a bare UUID.
 *
 * `storedName` always comes from our own generator, but a download route reads
 * it back out of the URL, so it is validated rather than trusted: a value like
 * "../../app.db" must never resolve.
 */
export function resolveStoredPath(storedName: string): string {
  if (!/^[0-9a-f-]{36}$/i.test(storedName)) {
    throw new Error(`Refusing to resolve suspicious stored name: ${storedName}`);
  }
  const full = path.join(UPLOADS_DIR, storedName);
  if (path.dirname(full) !== path.resolve(UPLOADS_DIR)) {
    throw new Error("Resolved path escaped the uploads directory");
  }
  return full;
}

/** Characters that are illegal in a Windows path or confusing in a ZIP entry. */
const ILLEGAL_NAME_CHARS = new Set('<>:"|?*/\\');

/**
 * Strip a browser-supplied filename down to something safe to show and to place
 * inside a ZIP. Keeps it recognisable to the student who uploaded it; the name
 * on disk is a UUID regardless.
 *
 * Filtering by code point rather than by regex keeps the control-character rule
 * explicit and avoids an escape sequence that is easy to get subtly wrong.
 */
export function sanitizeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "file";

  let cleaned = "";
  for (const ch of base) {
    const code = ch.codePointAt(0) ?? 0;
    // Drop C0 controls and DEL outright.
    if (code < 0x20 || code === 0x7f) continue;
    cleaned += ILLEGAL_NAME_CHARS.has(ch) ? "_" : ch;
  }

  // Leading dots would hide the file, or produce "." / ".." entries.
  cleaned = cleaned.replace(/^\.+/, "").trim();
  return cleaned.slice(0, 180) || "file";
}

/**
 * Stream one uploaded file to disk.
 *
 * Streaming rather than buffering matters here: a 200 MB ZIP held in memory
 * would be a real problem on a shared university VM with several teams
 * submitting in the last ten minutes before a Friday deadline.
 */
export async function storeUpload(
  file: File,
  maxBytes: number = MAX_UPLOAD_BYTES,
): Promise<StoredFile> {
  if (file.size > maxBytes) {
    throw new UploadTooLargeError(file.size, maxBytes);
  }

  fs.mkdirSync(UPLOADS_DIR, { recursive: true });

  const storedName = generateStoredName();
  const destination = path.join(UPLOADS_DIR, storedName);

  let written = 0;
  const counter = new TransformCounter((n) => {
    written += n;
    if (written > maxBytes) {
      throw new UploadTooLargeError(written, maxBytes);
    }
  });

  try {
    await pipeline(
      Readable.fromWeb(file.stream() as Parameters<typeof Readable.fromWeb>[0]),
      counter,
      createWriteStream(destination),
    );
  } catch (error) {
    // Never leave a half-written file behind to be counted as a delivery.
    await fs.promises.rm(destination, { force: true });
    throw error;
  }

  return {
    storedName,
    originalName: sanitizeFilename(file.name),
    sizeBytes: written,
    mimeType: file.type || null,
  };
}

export async function deleteStoredFile(storedName: string): Promise<void> {
  await fs.promises.rm(resolveStoredPath(storedName), { force: true });
}

export function statStoredFile(storedName: string) {
  return fs.promises.stat(resolveStoredPath(storedName));
}

export function readStoredFile(storedName: string) {
  return fs.createReadStream(resolveStoredPath(storedName));
}

export class UploadTooLargeError extends Error {
  constructor(
    readonly actual: number,
    readonly limit: number,
  ) {
    super(
      `Upload is ${(actual / 1024 / 1024).toFixed(1)} MB, which exceeds the ` +
        `${(limit / 1024 / 1024).toFixed(0)} MB limit`,
    );
    this.name = "UploadTooLargeError";
  }
}

/**
 * Counts bytes as they pass through, so the size limit is enforced against what
 * actually arrives rather than the client-declared Content-Length.
 */
class TransformCounter extends Transform {
  constructor(private readonly onBytes: (n: number) => void) {
    super();
  }
  override _transform(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null, data?: Buffer) => void,
  ) {
    try {
      this.onBytes(chunk.length);
      callback(null, chunk);
    } catch (error) {
      callback(error as Error);
    }
  }
}

/** Extension check, matching the assignment's allow-list. */
export function extensionAllowed(filename: string, allowed: string): boolean {
  const list = allowed
    .split(",")
    .map((s) => s.trim().toLowerCase().replace(/^\./, ""))
    .filter(Boolean);
  if (list.length === 0) return true;

  const ext = path.extname(filename).slice(1).toLowerCase();
  return list.includes(ext);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
