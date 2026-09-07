import "server-only";

import { and, eq, isNull } from "drizzle-orm";

import { db } from "@/db";
import {
  assignments,
  submissionFiles,
  submissions,
  type Assignment,
} from "@/db/schema";
import { recordAudit } from "./auth";
import { getEffectiveDeadline } from "./dashboard";
import { checkVideoUrl, getSetting } from "./settings";
import { deleteStoredFile, type StoredFile } from "./storage";
import { assertMembership, getTeamByToken } from "./team-access";

/**
 * Recording a delivery.
 *
 * Every rule that decides whether a submission is accepted lives here, and the
 * upload route is a thin wrapper over it. That matters because the route is
 * reachable by direct POST — a student could construct one by hand — so none of
 * these checks may live only in the form.
 */

export interface SubmitInput {
  token: string;
  assignmentId: number;
  /** Roster id of the person clicking submit. */
  submittedByStudentId: number;
  /** For a solo assignment, whose delivery this is. Null for team mode. */
  studentId: number | null;
  videoUrl: string;
  videoShareConfirmed: boolean;
  note: string;
  files: StoredFile[];
  /** Files the parser refused, reported back to the student. */
  rejected: { filename: string; reason: string }[];
  /** Keep the previously uploaded files instead of replacing them. */
  keepExistingFiles: boolean;
}

export type SubmitResult =
  | { ok: true; submissionId: number; isLate: boolean }
  | { ok: false; error: string };

export async function submitDelivery(
  input: SubmitInput,
): Promise<SubmitResult> {
  const context = await getTeamByToken(input.token);
  if (!context) return fail(input, "That team link is not valid.");
  const { team } = context;

  const assignment = await db.query.assignments.findFirst({
    where: eq(assignments.id, input.assignmentId),
  });
  if (!assignment) return fail(input, "That assignment does not exist.");
  if (!assignment.publishedAt) {
    return fail(input, "That assignment has not been published yet.");
  }
  // A team is formed for one assignment. This endpoint is reachable by direct
  // POST, so the pairing is re-checked here and not just in the page that
  // rendered the form — otherwise one week's code could deliver to another's.
  if (assignment.id !== team.assignmentId) {
    return fail(
      input,
      "That team code belongs to a different assignment. Use the code for this one.",
    );
  }

  /* -- who is delivering --------------------------------------------------- */

  const isMember = await assertMembership(team.id, input.submittedByStudentId);
  if (!isMember) {
    return fail(input, "Choose your name from the list before delivering.");
  }

  let studentId: number | null = null;
  if (assignment.mode === "solo") {
    // A solo delivery must name the person it belongs to, and that person must
    // be on this team — otherwise one team could deliver on another's behalf.
    studentId = input.studentId ?? input.submittedByStudentId;
    if (!(await assertMembership(team.id, studentId))) {
      return fail(input, "That person is not a member of this team.");
    }
  }

  /* -- is the window open -------------------------------------------------- */

  const deadline = await getEffectiveDeadline(assignment, team.id);
  if (!deadline.canSubmit) {
    return fail(
      input,
      "The deadline has passed and this assignment does not accept late deliveries.",
    );
  }

  /* -- requirements -------------------------------------------------------- */

  const existing = await db.query.submissions.findFirst({
    where: and(
      eq(submissions.assignmentId, assignment.id),
      eq(submissions.teamId, team.id),
      studentId == null
        ? isNull(submissions.studentId)
        : eq(submissions.studentId, studentId),
    ),
    with: { files: true },
  });

  const keptFiles = input.keepExistingFiles ? (existing?.files ?? []) : [];
  const totalFiles = input.files.length + keptFiles.length;

  if (assignment.requiresFiles && totalFiles === 0) {
    const because =
      input.rejected.length > 0
        ? ` (${input.rejected.map((r) => `${r.filename}: ${r.reason}`).join("; ")})`
        : "";
    return fail(input, `This assignment needs at least one file${because}.`);
  }

  let videoUrl: string | null = input.videoUrl.trim() || null;
  if (assignment.requiresVideo) {
    const hosts = await getSetting("video_hosts");
    const check = checkVideoUrl(input.videoUrl, hosts);
    if (!check.valid) return fail(input, check.message ?? "Invalid video link.");
    if (!input.videoShareConfirmed) {
      return fail(
        input,
        "Confirm that you have set the sharing on the video so AAU staff can watch it.",
      );
    }
    videoUrl = input.videoUrl.trim();
  }

  /* -- write --------------------------------------------------------------- */

  const now = Date.now();
  const isLate = deadline.wouldBeLate;

  const submissionId = db.transaction((tx) => {
    let id: number;

    if (existing) {
      tx.update(submissions)
        .set({
          submittedByStudentId: input.submittedByStudentId,
          videoUrl,
          videoShareConfirmed: input.videoShareConfirmed,
          note: input.note.trim() || null,
          submittedAt: now,
          isLate,
          // Replacing the work clears a previous review: a "needs rework"
          // verdict no longer applies to files the reviewer has not seen.
          status: "submitted",
          reviewComment: null,
          reviewedAt: null,
          reviewedByAdminId: null,
        })
        .where(eq(submissions.id, existing.id))
        .run();
      id = existing.id;

      if (!input.keepExistingFiles) {
        tx.delete(submissionFiles)
          .where(eq(submissionFiles.submissionId, existing.id))
          .run();
      }
    } else {
      const row = tx
        .insert(submissions)
        .values({
          assignmentId: assignment.id,
          teamId: team.id,
          studentId,
          submittedByStudentId: input.submittedByStudentId,
          videoUrl,
          videoShareConfirmed: input.videoShareConfirmed,
          note: input.note.trim() || null,
          submittedAt: now,
          isLate,
        })
        .returning()
        .get();
      id = row.id;
    }

    if (input.files.length > 0) {
      tx.insert(submissionFiles)
        .values(
          input.files.map((f) => ({
            submissionId: id,
            originalName: f.originalName,
            storedName: f.storedName,
            sizeBytes: f.sizeBytes,
            mimeType: f.mimeType,
          })),
        )
        .run();
    }

    return id;
  });

  // Only once the database is consistent do the old bytes go. Doing this inside
  // the transaction would leave files deleted but rows intact on a rollback.
  if (existing && !input.keepExistingFiles) {
    await Promise.all(
      existing.files.map((f) =>
        deleteStoredFile(f.storedName).catch(() => undefined),
      ),
    );
  }

  const actor = context.members.find(
    (m) => m.id === input.submittedByStudentId,
  );
  await recordAudit({
    action: existing ? "submission.replaced" : "submission.created",
    actorName: actor?.name ?? `student:${input.submittedByStudentId}`,
    teamId: team.id,
    detail: `${assignment.title}${isLate ? " (late)" : ""} — ${totalFiles} file(s)`,
  });

  return { ok: true, submissionId, isLate };
}

/**
 * Discard anything already written to disk before returning an error, so a
 * rejected attempt never leaves orphaned bytes in the uploads directory.
 */
async function fail(input: SubmitInput, error: string): Promise<SubmitResult> {
  await Promise.all(
    input.files.map((f) =>
      deleteStoredFile(f.storedName).catch(() => undefined),
    ),
  );
  return { ok: false, error };
}

/** Used by the page to describe what an assignment wants, in one sentence. */
export function requirementSummary(assignment: Assignment): string {
  const parts: string[] = [];
  if (assignment.requiresFiles) {
    const exts = assignment.allowedExtensions
      .split(",")
      .map((e) => e.trim().toUpperCase())
      .filter(Boolean);
    parts.push(
      exts.length > 0 ? `${exts.join(" or ")} file(s)` : "one or more files",
    );
  }
  if (assignment.requiresVideo) parts.push("a video link");
  if (parts.length === 0) return "Nothing to upload — just confirm below.";
  return `This assignment needs ${parts.join(" and ")}.`;
}
