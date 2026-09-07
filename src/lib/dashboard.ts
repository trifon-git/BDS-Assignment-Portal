import "server-only";

import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";

import { db } from "@/db";
import {
  assignments,
  deadlineExtensions,
  submissionFiles,
  submissions,
  type Assignment,
  type Student,
  type Submission,
  type SubmissionFile,
} from "@/db/schema";
import {
  deliveryState,
  resolveDeadline,
  type DeadlineInfo,
  type DeliveryState,
} from "./deadline";

/**
 * Assembles what a team sees on its dashboard.
 *
 * The whole view is built from three bulk queries rather than one query per
 * assignment, because the page renders every week of the semester at once.
 */

export interface SubmissionWithFiles extends Submission {
  files: SubmissionFile[];
}

/** One row on a solo assignment: a single member's own delivery. */
export interface MemberRow {
  student: Student;
  submission: SubmissionWithFiles | null;
  state: DeliveryState;
}

export interface AssignmentCard {
  assignment: Assignment;
  deadline: DeadlineInfo;
  /** For team assignments: the team's single shared submission. */
  submission: SubmissionWithFiles | null;
  /** For solo assignments: one row per member. Empty for team assignments. */
  memberRows: MemberRow[];
  /** The single state to show on the card. For a solo assignment this is a
   *  summary across members. */
  state: DeliveryState;
}

/**
 * The card for the one assignment this team was formed for.
 *
 * A team belongs to a single assignment, so this returns at most one card —
 * it stays a list only because a draft assignment produces none, and every
 * caller already renders a collection.
 */
export async function getTeamDashboard(
  teamId: number,
  members: Student[],
  assignmentId: number,
  now: number = Date.now(),
): Promise<AssignmentCard[]> {
  // A draft is invisible to students even through its own team's link, so a
  // half-written brief is never exposed by a code handed out too early.
  const published = await db
    .select()
    .from(assignments)
    .where(
      and(
        eq(assignments.id, assignmentId),
        isNotNull(assignments.publishedAt),
      ),
    );

  if (published.length === 0) return [];

  const [teamSubmissions, extensions] = await Promise.all([
    db
      .select()
      .from(submissions)
      .where(eq(submissions.teamId, teamId)),
    db
      .select()
      .from(deadlineExtensions)
      .where(eq(deadlineExtensions.teamId, teamId)),
  ]);

  const files = await getFilesFor(teamSubmissions.map((s) => s.id));

  const withFiles = (s: Submission): SubmissionWithFiles => ({
    ...s,
    files: files.get(s.id) ?? [],
  });

  const extensionFor = new Map(
    extensions.map((e) => [e.assignmentId, e.newDueAt]),
  );

  return published.map((assignment) => {
    const deadline = resolveDeadline(
      assignment,
      extensionFor.get(assignment.id) ?? null,
      now,
    );

    if (assignment.mode === "solo") {
      const memberRows: MemberRow[] = members.map((student) => {
        const found = teamSubmissions.find(
          (s) => s.assignmentId === assignment.id && s.studentId === student.id,
        );
        const submission = found ? withFiles(found) : null;
        return {
          student,
          submission,
          state: deliveryState(submission, deadline),
        };
      });

      return {
        assignment,
        deadline,
        submission: null,
        memberRows,
        state: summariseMembers(memberRows),
      };
    }

    const found = teamSubmissions.find(
      (s) => s.assignmentId === assignment.id && s.studentId === null,
    );
    const submission = found ? withFiles(found) : null;

    return {
      assignment,
      deadline,
      submission,
      memberRows: [],
      state: deliveryState(submission, deadline),
    };
  });
}

/**
 * The headline state for a solo assignment card.
 *
 * Anything unresolved wins over anything finished: a card must not read
 * "Delivered" while one member of the group still hasn't handed in. Rework is
 * surfaced above a plain miss because it is the one the team can act on today.
 */
function summariseMembers(rows: MemberRow[]): DeliveryState {
  if (rows.length === 0) return "pending";
  if (rows.some((r) => r.state === "rework")) return "rework";
  if (rows.some((r) => r.state === "missing")) return "missing";
  if (rows.some((r) => r.state === "pending")) return "pending";
  if (rows.some((r) => r.state === "late")) return "late";
  if (rows.every((r) => r.state === "approved")) return "approved";
  return "delivered";
}

/** Files for a set of submissions, grouped by submission id. */
export async function getFilesFor(
  submissionIds: number[],
): Promise<Map<number, SubmissionFile[]>> {
  const grouped = new Map<number, SubmissionFile[]>();
  if (submissionIds.length === 0) return grouped;

  const rows = await db
    .select()
    .from(submissionFiles)
    .where(inArray(submissionFiles.submissionId, submissionIds))
    .orderBy(asc(submissionFiles.id));

  for (const row of rows) {
    const list = grouped.get(row.submissionId);
    if (list) list.push(row);
    else grouped.set(row.submissionId, [row]);
  }
  return grouped;
}

/** The team's effective deadline for one assignment. */
export async function getEffectiveDeadline(
  assignment: Assignment,
  teamId: number,
  now: number = Date.now(),
): Promise<DeadlineInfo> {
  const extension = await db.query.deadlineExtensions.findFirst({
    where: and(
      eq(deadlineExtensions.assignmentId, assignment.id),
      eq(deadlineExtensions.teamId, teamId),
    ),
  });
  return resolveDeadline(assignment, extension?.newDueAt ?? null, now);
}
