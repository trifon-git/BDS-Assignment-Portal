import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
// archiver v8 dropped the callable default export in favour of these classes.
import { ZipArchive } from "archiver";
import fs from "node:fs";

import { db } from "@/db";
import { assignments } from "@/db/schema";
import { getDeliveryMatrix } from "@/lib/admin-data";
import { getCurrentAdmin, recordAudit } from "@/lib/auth";
import { formatDeadline } from "@/lib/format";
import { resolveStoredPath, sanitizeFilename } from "@/lib/storage";
import { toWebStream } from "@/lib/web-stream";

/**
 * Every submission for one assignment, as a single ZIP.
 *
 * Streamed rather than assembled in memory — a class's worth of ZIPs is easily
 * a gigabyte. An index CSV goes in alongside the folders so the video links and
 * the "who didn't deliver" rows survive outside the app, which is the form the
 * teacher can keep for their own records.
 */

export const maxDuration = 300;

export async function GET(
  _request: Request,
  { params }: RouteContext<"/api/admin/assignments/[id]/download">,
) {
  const admin = await getCurrentAdmin();
  if (!admin) return new NextResponse("Not found", { status: 404 });

  const { id } = await params;
  const assignment = await db.query.assignments.findFirst({
    where: eq(assignments.id, Number(id)),
  });
  if (!assignment) return new NextResponse("Not found", { status: 404 });

  const matrix = await getDeliveryMatrix(assignment);

  const archive = new ZipArchive({ zlib: { level: 6 } });
  // Uploads are usually already-compressed ZIPs; a missing file must not abort
  // the whole download.
  archive.on("warning", (err: Error) => console.warn("Archive warning", err));
  archive.on("error", (err: Error) => console.error("Archive error", err));

  const csv: string[][] = [
    [
      "Folder",
      "Team",
      "Student",
      "Status",
      "Delivered at",
      "Late",
      "Submitted by",
      "Video URL",
      "Sharing confirmed",
      "Link URL",
      "Files",
      "Note",
      "Review",
      "Review comment",
      "Emails",
    ],
  ];

  for (const row of matrix.rows) {
    const label = row.student
      ? `${row.student.name} (${row.team.name})`
      : row.team.name;
    const folder = sanitizeFilename(label).replace(/\.+$/, "") || `row-${row.key}`;

    csv.push([
      row.submission ? folder : "",
      row.team.name,
      row.student?.name ?? "",
      row.state,
      row.submission ? formatDeadline(row.submission.submittedAt) : "",
      row.submission?.isLate ? "yes" : "no",
      row.submittedByName ?? "",
      row.submission?.videoUrl ?? "",
      row.submission?.videoShareConfirmed ? "yes" : "no",
      row.submission?.linkUrl ?? "",
      row.submission?.files.map((f) => f.originalName).join(" | ") ?? "",
      row.submission?.note ?? "",
      row.submission?.status ?? "",
      row.submission?.reviewComment ?? "",
      row.chaseEmails.join(" "),
    ]);

    if (!row.submission) continue;

    for (const file of row.submission.files) {
      try {
        const path = resolveStoredPath(file.storedName);
        // Skip rows whose bytes are gone rather than failing the whole archive.
        if (!fs.existsSync(path)) continue;
        archive.file(path, { name: `${folder}/${file.originalName}` });
      } catch (error) {
        console.error("Skipping unreadable file", file.storedName, error);
      }
    }

    // A per-folder note so the video link is visible without opening the CSV.
    const details = [
      `Team: ${row.team.name}`,
      row.student ? `Student: ${row.student.name}` : null,
      `Delivered: ${formatDeadline(row.submission.submittedAt)}${
        row.submission.isLate ? " (LATE)" : ""
      }`,
      row.submittedByName ? `Submitted by: ${row.submittedByName}` : null,
      row.submission.videoUrl ? `Video: ${row.submission.videoUrl}` : null,
      row.submission.linkUrl ? `Link: ${row.submission.linkUrl}` : null,
      row.submission.note ? `Note: ${row.submission.note}` : null,
    ]
      .filter(Boolean)
      .join("\n");
    archive.append(details, { name: `${folder}/_details.txt` });
  }

  archive.append(toCsv(csv), { name: "submissions.csv" });
  archive.finalize();

  await recordAudit({
    action: "assignment.downloaded",
    actorName: `admin:${admin.email}`,
    detail: `${assignment.title} — ${matrix.delivered}/${matrix.total}`,
  });

  const filename = `${sanitizeFilename(assignment.title) || "assignment"}.zip`;

  return new NextResponse(
    toWebStream(archive as unknown as AsyncIterable<Uint8Array>) as unknown as BodyInit,
    {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "Cache-Control": "private, no-store",
      },
    },
  );
}

/** Excel-safe CSV: quote everything, double internal quotes, BOM for UTF-8 so
 *  Danish characters open correctly by double-click on Windows. */
function toCsv(rows: string[][]): string {
  const body = rows
    .map((row) =>
      row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","),
    )
    .join("\r\n");
  return `﻿${body}`;
}
