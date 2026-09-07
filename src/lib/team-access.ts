import "server-only";

import { and, asc, eq, isNotNull, isNull } from "drizzle-orm";

import { db } from "@/db";
import {
  assignments,
  students,
  submissions,
  teamMembers,
  teams,
  type Assignment,
  type Student,
  type Team,
} from "@/db/schema";

/**
 * Resolving a team link into a team and its members. Every student-facing route
 * enters through here, which keeps "what does holding this link entitle you to"
 * in one auditable place.
 */

export interface TeamContext {
  team: Team;
  /** The assignment this team was formed for. A team only ever has one. */
  assignment: Assignment;
  members: Student[];
}

/** Look up a team by the token in its URL. Returns null for an unknown token. */
export async function getTeamByToken(
  token: string,
): Promise<TeamContext | null> {
  if (!token) return null;

  const team = await db.query.teams.findFirst({
    where: eq(teams.accessToken, token),
    with: { assignment: true },
  });
  if (!team) return null;

  const { assignment, ...rest } = team;
  return { team: rest, assignment, members: await getTeamMembers(team.id) };
}

/** Look up a team by the code a student typed on the landing page. */
export async function getTeamByShortCode(code: string): Promise<Team | null> {
  if (!code) return null;
  const team = await db.query.teams.findFirst({
    where: eq(teams.shortCode, code),
  });
  return team ?? null;
}

export async function getTeamMembers(teamId: number): Promise<Student[]> {
  const rows = await db
    .select({ student: students })
    .from(teamMembers)
    .innerJoin(students, eq(teamMembers.studentId, students.id))
    .where(eq(teamMembers.teamId, teamId))
    .orderBy(asc(students.name));

  return rows.map((r) => r.student);
}

/**
 * Confirm a student is actually on the team whose link was used.
 *
 * The "Submitted by" dropdown only ever offers team members, but a Server
 * Action is reachable by direct POST, so the server re-checks rather than
 * trusting the submitted id.
 */
export async function assertMembership(
  teamId: number,
  studentId: number,
): Promise<boolean> {
  const row = await db.query.teamMembers.findFirst({
    where: and(
      eq(teamMembers.teamId, teamId),
      eq(teamMembers.studentId, studentId),
    ),
  });
  return Boolean(row);
}

/**
 * Students not yet grouped **for this assignment**, for the /join dropdown and
 * the admin panel's "not in a team" list.
 *
 * Scoped to one assignment because that is now the unit of grouping: somebody
 * can be settled in a team for week 4 and still ungrouped for week 5. The
 * unique index on (assignment_id, student_id) makes this left-join test exact.
 */
export async function getUnassignedStudents(
  assignmentId: number,
): Promise<Student[]> {
  const rows = await db
    .select({ student: students })
    .from(students)
    .leftJoin(
      teamMembers,
      and(
        eq(teamMembers.studentId, students.id),
        eq(teamMembers.assignmentId, assignmentId),
      ),
    )
    .where(and(isNull(teamMembers.id), eq(students.active, true)))
    .orderBy(asc(students.name));

  return rows.map((r) => r.student);
}

/** Every published assignment a student could still be forming a team for. */
export async function getOpenAssignments(): Promise<Assignment[]> {
  return db.query.assignments.findMany({
    where: isNotNull(assignments.publishedAt),
    orderBy: (a, { asc: ascending }) => [ascending(a.dueAt)],
  });
}

/**
 * The team's submission for one assignment.
 *
 * For a team assignment pass `studentId: null` to get the single shared row;
 * for a solo assignment pass the member's id to get theirs. This mirrors the
 * two partial unique indexes on the table.
 */
export async function getSubmission(
  assignmentId: number,
  teamId: number,
  studentId: number | null,
) {
  return db.query.submissions.findFirst({
    where: and(
      eq(submissions.assignmentId, assignmentId),
      eq(submissions.teamId, teamId),
      studentId == null
        ? isNull(submissions.studentId)
        : eq(submissions.studentId, studentId),
    ),
    with: { files: true },
  });
}
