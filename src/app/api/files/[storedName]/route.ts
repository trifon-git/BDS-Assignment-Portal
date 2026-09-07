import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { submissionFiles, submissions } from "@/db/schema";
import { getCurrentAdmin } from "@/lib/auth";
import { readStoredFile, statStoredFile } from "@/lib/storage";
import { toWebStream } from "@/lib/web-stream";
import { getTeamByToken } from "@/lib/team-access";

/**
 * Serve one uploaded file.
 *
 * Two kinds of caller are allowed: a signed-in admin, or someone holding the
 * access token of the team that owns the file (passed as `?t=`). A stored name
 * is an unguessable UUID, but that alone is not treated as authorisation — one
 * team must not be able to read another's work by passing around an id.
 */
export async function GET(
  request: Request,
  { params }: RouteContext<"/api/files/[storedName]">,
) {
  const { storedName } = await params;

  const record = await db.query.submissionFiles.findFirst({
    where: eq(submissionFiles.storedName, storedName),
  });
  if (!record) return new NextResponse("Not found", { status: 404 });

  if (!(await isAuthorised(request, record.submissionId))) {
    return new NextResponse("Not found", { status: 404 });
  }

  let size: number;
  try {
    size = (await statStoredFile(storedName)).size;
  } catch {
    // The row exists but the bytes don't — a seeded placeholder, or a file lost
    // to a restore. Say so plainly instead of returning a broken download.
    return new NextResponse("This file is no longer on the server.", {
      status: 410,
    });
  }

  // `Readable.toWeb()` double-closes its controller here and throws an
  // uncaughtException that would take the whole server process down. Going
  // through the async iterator gives the same streaming behaviour without it.
  const stream = toWebStream(readStoredFile(storedName));

  return new NextResponse(stream as unknown as BodyInit, {
    headers: {
      "Content-Type": record.mimeType ?? "application/octet-stream",
      "Content-Length": String(size),
      // `filename*` carries the UTF-8 name so Danish characters survive.
      "Content-Disposition": `attachment; filename="${asciiFallback(
        record.originalName,
      )}"; filename*=UTF-8''${encodeURIComponent(record.originalName)}`,
      // Submissions are private; never let a shared proxy hold a copy.
      "Cache-Control": "private, no-store",
    },
  });
}

async function isAuthorised(
  request: Request,
  submissionId: number,
): Promise<boolean> {
  if (await getCurrentAdmin()) return true;

  const token = new URL(request.url).searchParams.get("t");
  if (!token) return false;

  const context = await getTeamByToken(token);
  if (!context) return false;

  const submission = await db.query.submissions.findFirst({
    where: eq(submissions.id, submissionId),
  });
  return submission?.teamId === context.team.id;
}

/** A plain-ASCII version of the filename for the legacy `filename=` parameter. */
function asciiFallback(name: string): string {
  let out = "";
  for (const ch of name) {
    const code = ch.codePointAt(0) ?? 0;
    out += code > 31 && code < 127 && ch !== '"' ? ch : "_";
  }
  return out || "download";
}
