import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { assignments } from "@/db/schema";
import { MAX_UPLOAD_BYTES } from "@/lib/config";
import { parseUpload } from "@/lib/multipart";
import { submitDelivery } from "@/lib/submit";

/**
 * Upload endpoint for a delivery.
 *
 * This is a route handler rather than a Server Action on purpose: actions cap
 * the request body at a couple of megabytes, and students deliver ZIPs two
 * orders of magnitude larger. The form posts here as ordinary
 * multipart/form-data, which also means the page keeps working with no
 * JavaScript at all.
 */

/** Uploads are large and slow; don't let the platform cut them off early. */
export const maxDuration = 300;

export async function POST(
  request: Request,
  { params }: RouteContext<"/api/submit/[token]/[assignmentId]">,
) {
  const { token, assignmentId } = await params;
  const id = Number(assignmentId);

  // A relative Location, deliberately. Building an absolute URL from the
  // request means trusting the host the server thinks it has, and in the
  // container that is HOSTNAME — 0.0.0.0 — which a browser cannot route: the
  // student's delivery succeeds and they land on "This site can't be reached".
  // Behind the university's proxy it would depend on X-Forwarded-Host being
  // set correctly. A relative Location sidesteps the whole question; browsers
  // resolve it against the address the student actually typed.
  const back = (query: string) =>
    new NextResponse(null, {
      // 303 so the browser follows with GET rather than repeating the POST.
      status: 303,
      headers: { Location: `/t/${token}/a/${assignmentId}${query}` },
    });

  if (!Number.isInteger(id)) return back("?error=Unknown+assignment");

  // Read the assignment's own limits before parsing, so an oversized file is
  // rejected against the right cap rather than a global default.
  const assignment = await db.query.assignments.findFirst({
    where: eq(assignments.id, id),
  });
  if (!assignment) return back("?error=Unknown+assignment");

  const perFileLimit = Math.min(
    assignment.maxFileSizeMb * 1024 * 1024,
    MAX_UPLOAD_BYTES,
  );

  let parsed;
  try {
    parsed = await parseUpload(request, {
      maxFileBytes: perFileLimit,
      allowedExtensions: assignment.requiresFiles
        ? assignment.allowedExtensions
        : "",
    });
  } catch (error) {
    console.error("Upload parsing failed", error);
    return back("?error=Upload+failed.+Please+try+again.");
  }

  const { fields, files, rejected } = parsed;

  const result = await submitDelivery({
    token,
    assignmentId: id,
    submittedByStudentId: Number(fields.submittedBy),
    studentId: fields.studentId ? Number(fields.studentId) : null,
    videoUrl: fields.videoUrl ?? "",
    videoShareConfirmed: fields.videoShareConfirmed === "on",
    linkUrl: fields.linkUrl ?? "",
    note: fields.note ?? "",
    files,
    rejected,
    keepExistingFiles: fields.keepExistingFiles === "on",
  });

  if (!result.ok) {
    return back(`?error=${encodeURIComponent(result.error)}`);
  }

  const notice =
    rejected.length > 0
      ? `&skipped=${encodeURIComponent(
          rejected.map((r) => `${r.filename} (${r.reason})`).join(", "),
        )}`
      : "";

  return back(`?ok=1${result.isLate ? "&late=1" : ""}${notice}`);
}
