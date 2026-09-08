import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import {
  deadlineExtensions,
  students,
  submissions,
  teamMembers,
  teams,
} from "@/db/schema";
import { generateAccessToken, generateShortCode } from "./ids";
import { shuffleIntoGroups } from "./shuffle";

export interface ShuffleResult {
  created: number;
  placed: number;
  deleted: number;
  protectedTeams: number;
  skipped: number;
}

/**
 * Team operations that are worth testing on their own.
 *
 * Deliberately not a `"use server"` module: those may only export async
 * functions, and keeping this plain means the copy can be exercised directly
 * against a database instead of only through an HTTP action.
 */

/**
 * Clone one assignment's teams onto another. Returns how many were created.
 *
 * Fresh links and codes are minted on purpose — the copy is a new set of teams,
 * and a code that unlocked last week's delivery must not unlock this week's.
 *
 * A student already grouped for the target assignment is skipped rather than
 * moved, so running this twice, or after some students have organised
 * themselves, never undoes what is already there. A source team whose members
 * are all already placed produces no empty team.
 */
export function copyTeams(
  fromAssignmentId: number,
  toAssignmentId: number,
): number {
  if (fromAssignmentId === toAssignmentId) return 0;

  const source = db.query.teams
    .findMany({
      where: eq(teams.assignmentId, fromAssignmentId),
      with: { members: true },
    })
    .sync();

  const alreadyGrouped = new Set(
    db
      .select({ studentId: teamMembers.studentId })
      .from(teamMembers)
      .where(eq(teamMembers.assignmentId, toAssignmentId))
      .all()
      .map((r) => r.studentId),
  );

  let created = 0;
  db.transaction((tx) => {
    for (const team of source) {
      const members = team.members
        .map((m) => m.studentId)
        .filter((id) => !alreadyGrouped.has(id));
      if (members.length === 0) continue;

      const copy = tx
        .insert(teams)
        .values({
          assignmentId: toAssignmentId,
          name: team.name,
          accessToken: generateAccessToken(),
          shortCode: generateShortCode(),
        })
        .returning()
        .get();

      tx.insert(teamMembers)
        .values(
          members.map((studentId) => ({
            teamId: copy.id,
            assignmentId: toAssignmentId,
            studentId,
          })),
        )
        .run();

      // Guard against a source that somehow lists the same student twice.
      for (const id of members) alreadyGrouped.add(id);
      created++;
    }
  });

  return created;
}

/**
 * How many of this assignment's teams a "re-shuffle everyone" would refuse to
 * touch, because they already have a submission or a deadline extension. Used
 * to name the real number in the confirm dialog rather than a hypothetical.
 */
export function countProtectedTeams(assignmentId: number): number {
  const teamIds = new Set([
    ...db
      .select({ teamId: submissions.teamId })
      .from(submissions)
      .where(eq(submissions.assignmentId, assignmentId))
      .all()
      .map((r) => r.teamId),
    ...db
      .select({ teamId: deadlineExtensions.teamId })
      .from(deadlineExtensions)
      .where(eq(deadlineExtensions.assignmentId, assignmentId))
      .all()
      .map((r) => r.teamId),
  ]);
  return teamIds.size;
}

/**
 * Auto-group a roster into teams of 3-4 for one assignment.
 *
 * `mode: "fill"` (the default) only touches students who have no team for
 * this assignment yet, so running it after some students have organised
 * themselves — or running it twice — never undoes what is already there.
 *
 * `mode: "reshuffle"` re-cuts everyone, deleting the assignment's existing
 * teams first — except any team that already has a submission or a deadline
 * extension attached. Both of those cascade off `teams.id`, so deleting such
 * a team would silently take real deliveries and their files with it; this
 * function refuses to do that regardless of what the caller asked for, since
 * it may be reached directly rather than only through the confirm dialog that
 * names the risk.
 */
export function shuffleTeams(
  assignmentId: number,
  opts?: { mode?: "fill" | "reshuffle"; preferred?: number; seed?: number },
): ShuffleResult {
  const mode = opts?.mode ?? "fill";

  return db.transaction((tx) => {
    const existingTeams = tx
      .select()
      .from(teams)
      .where(eq(teams.assignmentId, assignmentId))
      .all();

    const protectedTeamIds = new Set([
      ...tx
        .select({ teamId: submissions.teamId })
        .from(submissions)
        .where(eq(submissions.assignmentId, assignmentId))
        .all()
        .map((r) => r.teamId),
      ...tx
        .select({ teamId: deadlineExtensions.teamId })
        .from(deadlineExtensions)
        .where(eq(deadlineExtensions.assignmentId, assignmentId))
        .all()
        .map((r) => r.teamId),
    ]);

    const protectedTeams = existingTeams.filter((t) =>
      protectedTeamIds.has(t.id),
    );

    let deleted = 0;
    let pool: number[];

    if (mode === "reshuffle") {
      const removable = existingTeams.filter(
        (t) => !protectedTeamIds.has(t.id),
      );
      for (const t of removable) {
        tx.delete(teams).where(eq(teams.id, t.id)).run();
      }
      deleted = removable.length;

      const protectedStudentIds = new Set(
        protectedTeams.length === 0
          ? []
          : tx
              .select({ studentId: teamMembers.studentId })
              .from(teamMembers)
              .where(
                and(
                  eq(teamMembers.assignmentId, assignmentId),
                  inArray(
                    teamMembers.teamId,
                    protectedTeams.map((t) => t.id),
                  ),
                ),
              )
              .all()
              .map((m) => m.studentId),
      );

      pool = tx
        .select({ id: students.id })
        .from(students)
        .where(eq(students.active, true))
        .all()
        .map((s) => s.id)
        .filter((id) => !protectedStudentIds.has(id));
    } else {
      const alreadyGrouped = new Set(
        tx
          .select({ studentId: teamMembers.studentId })
          .from(teamMembers)
          .where(eq(teamMembers.assignmentId, assignmentId))
          .all()
          .map((r) => r.studentId),
      );

      pool = tx
        .select({ id: students.id })
        .from(students)
        .where(eq(students.active, true))
        .all()
        .map((s) => s.id)
        .filter((id) => !alreadyGrouped.has(id));
    }

    const groups = shuffleIntoGroups(pool, {
      preferred: opts?.preferred ?? 4,
      seed: opts?.seed,
    });

    let nextNumber =
      1 +
      existingTeams.reduce((max, t) => {
        const match = /^Group (\d+)$/.exec(t.name);
        return match ? Math.max(max, Number(match[1])) : max;
      }, 0);

    let created = 0;
    let placed = 0;
    for (const group of groups) {
      const team = tx
        .insert(teams)
        .values({
          assignmentId,
          name: `Group ${nextNumber++}`,
          accessToken: generateAccessToken(),
          shortCode: generateShortCode(),
        })
        .returning()
        .get();

      tx.insert(teamMembers)
        .values(
          group.map((studentId) => ({
            teamId: team.id,
            assignmentId,
            studentId,
          })),
        )
        .run();

      created++;
      placed += group.length;
    }

    return {
      created,
      placed,
      deleted,
      protectedTeams: protectedTeams.length,
      skipped: 0,
    };
  });
}
