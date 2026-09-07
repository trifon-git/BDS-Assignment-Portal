import "server-only";

import { createWriteStream } from "node:fs";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import Busboy from "busboy";

import { UPLOADS_DIR } from "./config";
import { generateStoredName } from "./ids";
import { sanitizeFilename, type StoredFile } from "./storage";

/**
 * Streaming multipart parser for submission uploads.
 *
 * `request.formData()` would be shorter, but it buffers every part in memory
 * first. With a 200 MB ZIP limit and several teams uploading in the last ten
 * minutes before a Friday deadline, that is a genuine way to take down a shared
 * university VM. Busboy lets each file go straight to disk as it arrives.
 */

export interface ParsedUpload {
  fields: Record<string, string>;
  files: StoredFile[];
  /** Files rejected during parsing, with the reason, so the page can explain
   *  precisely what went wrong rather than failing the whole delivery. */
  rejected: { filename: string; reason: string }[];
}

export interface ParseOptions {
  maxFileBytes: number;
  maxFiles?: number;
  /** Comma-separated extension allow-list; empty string means allow anything. */
  allowedExtensions: string;
}

export async function parseUpload(
  request: Request,
  options: ParseOptions,
): Promise<ParsedUpload> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("multipart/form-data")) {
    throw new Error("Expected a multipart/form-data request");
  }
  if (!request.body) throw new Error("Request had no body");

  fs.mkdirSync(UPLOADS_DIR, { recursive: true });

  const allowed = options.allowedExtensions
    .split(",")
    .map((s) => s.trim().toLowerCase().replace(/^\./, ""))
    .filter(Boolean);

  const fields: Record<string, string> = {};
  const files: StoredFile[] = [];
  const rejected: { filename: string; reason: string }[] = [];
  /** Everything written so far, so a failure anywhere can clean up. */
  const writtenPaths: string[] = [];

  const busboy = Busboy({
    headers: { "content-type": contentType },
    limits: {
      fileSize: options.maxFileBytes,
      files: options.maxFiles ?? 10,
      fields: 30,
      fieldSize: 100_000,
    },
  });

  const pending: Promise<void>[] = [];

  const done = new Promise<void>((resolve, reject) => {
    busboy.on("field", (name, value) => {
      fields[name] = value;
    });

    busboy.on("file", (_name, stream, info) => {
      const originalName = sanitizeFilename(info.filename ?? "file");

      // An empty file input still sends a part with no filename; ignore it
      // rather than storing a zero-byte "file".
      if (!info.filename) {
        stream.resume();
        return;
      }

      const ext = path.extname(originalName).slice(1).toLowerCase();
      if (allowed.length > 0 && !allowed.includes(ext)) {
        rejected.push({
          filename: originalName,
          reason: `only ${allowed.join(", ")} files are accepted`,
        });
        stream.resume();
        return;
      }

      const storedName = generateStoredName();
      const destination = path.join(UPLOADS_DIR, storedName);
      writtenPaths.push(destination);

      let size = 0;
      stream.on("data", (chunk: Buffer) => {
        size += chunk.length;
      });

      const task = (async () => {
        await pipeline(stream, createWriteStream(destination));

        // Busboy sets this when the part hit the fileSize limit; the bytes on
        // disk are truncated, so the file must not be recorded as delivered.
        if (stream.truncated) {
          await fs.promises.rm(destination, { force: true });
          rejected.push({
            filename: originalName,
            reason: `larger than ${Math.round(options.maxFileBytes / 1024 / 1024)} MB`,
          });
          return;
        }

        files.push({
          storedName,
          originalName,
          sizeBytes: size,
          mimeType: info.mimeType || null,
        });
      })();

      pending.push(task);
    });

    busboy.on("close", () => {
      Promise.all(pending).then(() => resolve(), reject);
    });
    busboy.on("error", reject);
  });

  try {
    await pipeline(
      Readable.fromWeb(request.body as Parameters<typeof Readable.fromWeb>[0]),
      busboy,
    );
    await done;
  } catch (error) {
    // Don't leave orphaned bytes on disk if parsing failed halfway.
    await Promise.all(
      writtenPaths.map((p) => fs.promises.rm(p, { force: true })),
    );
    throw error;
  }

  return { fields, files, rejected };
}
