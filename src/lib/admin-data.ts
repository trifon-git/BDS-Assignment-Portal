import "server-only";

import { and, asc, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  assignments,
  deadlineExtensions,
  students,
  submissionFiles,
  submissions,
  teamMembers,
  teams,
  type Assignment,
  type Student,
  type Submission,
  type SubmissionFile,
  type Team,
} from "@/db/schema";
import { getFilesFor } from "./dashboard";
import {
  deliveryState,
  isOutstanding,
  resolveDeadline,
  type DeliveryState,
} from "./deadline";

/**
 * Queries behind the admin panel.
 *
 * The delivery matrix is the screen this app exists for — "who delivered and
 * who didn't" — so it is built to answer that in one pass over a handful of
 * bulk queries rather than per-row lookups.
 */

export interface MatrixRow {
  /** Stable key: the team for a team assignment, the student for a solo one. */
  key: string;
  team: Team;
  /** Set only for a solo assignment. */
  student: Student | null;
  /** The team's members, for showing who to chase. */
  members: Student[];
  submission: (Submission & { files: SubmissionFile[] }) | null;
  submittedByName: string | null;
  state: DeliveryState;
  effectiveDueAt: number;
  extended: boolean;
  outstanding: boolean;
  /** Emails to chase when this row is outstanding. */
  chaseEmails: string[];
}

export interface DeliveryMatrix {
  assignment: Assignment;
  rows: MatrixRow[];
  delivered: number;
  outstanding: number;
  late: number;
  total: number;
}

export async function getDeliveryMatrix(
  assignment: Assignment,
  now: number = Date.now(),
): Promise<DeliveryMatrix> {
  const [allTeams, memberships, allSubmissions, extensions] = await Promise.all(
    [
      // Only this assignment's teams: every assignment has its own set now, and
      // an unscoped query would list the whole semester's groups in one matrix.
      db
        .select()
        .from(teams)
        .where(eq(teams.assignmentId, assignment.id))
        .orderBy(asc(teams.name)),
      db
        .select({ teamId: teamMembers.teamId, student: students })
        .from(teamMembers)
        .innerJoin(students, eq(teamMembers.studentId, students.id))
        .where(eq(teamMembers.assignmentId, assignment.id))
        .orderBy(asc(students.name)),
      db
        .select()
        .from(submissions)
        .where(eq(submissions.assignmentId, assignment.id)),
      db
        .select()
        .from(deadlineExtensions)
        .where(eq(deadlineExtensions.assignmentId, assignment.id)),
    ],
  );

  const files = await getFilesFor(allSubmissions.map((s) => s.id));
  const nameById = new Map(memberships.map((m) => [m.student.id, m.student.name]));

  const membersByTeam = new Map<number, Student[]>();
  for (const m of memberships) {
    const list = membersByTeam.get(m.teamId);
    if (list) list.push(m.student);
    else membersByTeam.set(m.teamId, [m.student]);
  }

  const extensionFor = new Map(extensions.map((e) => [e.teamId, e.newDueAt]));

  const rows: MatrixRow[] = [];

  for (const team of allTeams) {
    const members = membersByTeam.get(team.id) ?? [];
    const deadline = resolveDeadline(
      assignment,
      extensionFor.get(team.id) ?? null,
      now,
    );

    const build = (
      student: Student | null,
      submission: Submission | undefined,
    ): MatrixRow => {
      const withFiles = submission
        ? { ...submission, files: files.get(submission.id) ?? [] }
        : null;
      const state = deliveryState(withFiles, deadline);

      return {
        key: student ? `s${student.id}` : `t${team.id}`,
        team,
        student,
        members,
        submission: withFiles,
        submittedByName: submission?.submittedByStudentId
          ? (nameById.get(submission.submittedByStudentId) ?? null)
          : null,
        state,
        effectiveDueAt: deadline.effectiveDueAt,
        extended: deadline.extended,
        outstanding: isOutstanding(state),
        chaseEmails: student
          ? [student.email]
          : members.map((m) => m.email),
      };
    };

    if (assignment.mode === "solo") {
      for (const student of members) {
        rows.push(
          build(
            student,
            allSubmissions.find((s) => s.studentId === student.id),
          ),
        );
      }
    } else {
      rows.push(
        build(
          null,
          allSubmissions.find(
            (s) => s.teamId === team.id && s.studentId === null,
          ),
        ),
      );
    }
  }

  return {
    assignment,
    rows,
    total: rows.length,
    delivered: rows.filter((r) => !r.outstanding).length,
    outstanding: rows.filter((r) => r.outstanding).length,
    late: rows.filter((r) => r.submission?.isLate).length,
  };
}

/* -------------------------------------------------------------------------- */
/* Overview                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * One assignment's deliverables, counted without building its matrix.
 *
 * The fields mirror `deliveryState` / `isOutstanding` exactly, so a number here
 * and the same number on the assignment's own screen can never disagree. The
 * one thing this cannot see is a per-team extension moving a row from `missing`
 * to `pending` — that distinction needs the matrix, and neither state changes
 * whether the row is outstanding, so no count below depends on it.
 */
export interface OverviewAssignment {
  assignment: Assignment;
  /** Denominator: one row per team, or per grouped student on a solo one. */
  total: number;
  /** Teams cut for this assignment, and students placed in one of them. */
  teams: number;
  groupedStudents: number;

  /** Rows with something handed in, whatever the reviewer made of it. */
  submitted: number;
  approved: number;
  rework: number;
  /**
   * Handed in after the effective deadline. A separate axis from status, so an
   * approved delivery can still be counted late here.
   */
  late: number;
  /**
   * Late deliveries that were not sent back. Split out from `late` so a
   * progress bar can show on-time, late and rework as three segments that add
   * up to `submitted` instead of double-counting a late rework.
   */
  lateDelivered: number;
  /** Rows with nothing handed in at all. */
  notDelivered: number;
  /** Rows still needing a chase: nothing in, or sent back for rework. */
  outstanding: number;
  /** In and not sent back. The progress-bar numerator. */
  delivered: number;

  /** Uploaded files and the bytes they occupy on disk. */
  files: number;
  bytes: number;
  /** Teams whose deadline was moved for this assignment. */
  extensions: number;
  /** The assignment's own deadline has passed. */
  overdue: boolean;
}

/**
 * Published assignments in a stable chart/column order: by `weekNumber` when
 * both sides have one (nulls sort after numbered weeks), falling back to
 * `dueAt` ascending. Used by both the weekly trend and the student matrix so
 * the two never disagree about column order.
 */
export function orderPublishedAssignments(
  list: readonly Assignment[],
): Assignment[] {
  return [...list].sort((a, b) => {
    if (a.weekNumber != null && b.weekNumber != null && a.weekNumber !== b.weekNumber) {
      return a.weekNumber - b.weekNumber;
    }
    if (a.weekNumber != null && b.weekNumber == null) return -1;
    if (a.weekNumber == null && b.weekNumber != null) return 1;
    return a.dueAt - b.dueAt;
  });
}

/**
 * The dashboard summary.
 *
 * Counts come from a handful of grouped queries rather than by building every
 * matrix, since the overview only needs totals and a semester can hold a lot of
 * weeks. Grouping by status and lateness costs no extra round trip and is what
 * lets the page separate "not in yet" from "in but sent back".
 */
export async function getOverview(now: number = Date.now()) {
  const everyAssignment = await db
    .select()
    .from(assignments)
    .orderBy(desc(assignments.dueAt));
  const published = everyAssignment.filter((a) => a.publishedAt != null);

  // Teams and memberships are per assignment, so the denominators are too:
  // an unscoped count would measure the whole semester against one week.
  const [
    teamCounts,
    memberCounts,
    stateCounts,
    fileStats,
    extensionCounts,
    roster,
    videoStats,
  ] = await Promise.all([
      db
        .select({ assignmentId: teams.assignmentId, n: sql<number>`count(*)` })
        .from(teams)
        .groupBy(teams.assignmentId),
      db
        .select({
          assignmentId: teamMembers.assignmentId,
          n: sql<number>`count(*)`,
        })
        .from(teamMembers)
        .groupBy(teamMembers.assignmentId),
      // Status and lateness together: one pass gives every delivery bucket the
      // overview shows, instead of a count per bucket.
      db
        .select({
          assignmentId: submissions.assignmentId,
          status: submissions.status,
          isLate: submissions.isLate,
          n: sql<number>`count(*)`,
        })
        .from(submissions)
        .groupBy(submissions.assignmentId, submissions.status, submissions.isLate),
      db
        .select({
          assignmentId: submissions.assignmentId,
          files: sql<number>`count(*)`,
          bytes: sql<number>`coalesce(sum(${submissionFiles.sizeBytes}), 0)`,
        })
        .from(submissionFiles)
        .innerJoin(submissions, eq(submissions.id, submissionFiles.submissionId))
        .groupBy(submissions.assignmentId),
      db
        .select({
          assignmentId: deadlineExtensions.assignmentId,
          n: sql<number>`count(*)`,
        })
        .from(deadlineExtensions)
        .groupBy(deadlineExtensions.assignmentId),
      db
        .select({ n: sql<number>`count(*)` })
        .from(students)
        .where(eq(students.active, true))
        .get(),
      // Share-confirmed rate for assignments that actually require a video —
      // scoped to published ones, same as everything else on this page.
      db
        .select({
          total: sql<number>`count(*)`,
          compliant: sql<number>`sum(case when ${submissions.videoShareConfirmed} then 1 else 0 end)`,
        })
        .from(submissions)
        .innerJoin(assignments, eq(assignments.id, submissions.assignmentId))
        .where(
          and(
            eq(assignments.requiresVideo, true),
            isNotNull(assignments.publishedAt),
          ),
        )
        .get(),
    ]);

  const teamsBy = new Map(teamCounts.map((c) => [c.assignmentId, Number(c.n)]));
  const membersBy = new Map(
    memberCounts.map((c) => [c.assignmentId, Number(c.n)]),
  );
  const filesBy = new Map(
    fileStats.map((c) => [
      c.assignmentId,
      { files: Number(c.files), bytes: Number(c.bytes) },
    ]),
  );
  const extensionsBy = new Map(
    extensionCounts.map((c) => [c.assignmentId, Number(c.n)]),
  );

  const summaries: OverviewAssignment[] = published.map((assignment) => {
    const rows = stateCounts.filter((c) => c.assignmentId === assignment.id);
    const sum = (match: (r: (typeof rows)[number]) => boolean) =>
      rows.reduce((acc, r) => (match(r) ? acc + Number(r.n) : acc), 0);

    // A team assignment is counted per team; a solo one per grouped member.
    const total =
      assignment.mode === "solo"
        ? (membersBy.get(assignment.id) ?? 0)
        : (teamsBy.get(assignment.id) ?? 0);

    const submitted = sum(() => true);
    const approved = sum((r) => r.status === "approved");
    const rework = sum((r) => r.status === "rework");
    const late = sum((r) => r.isLate);
    const lateDelivered = sum((r) => r.isLate && r.status !== "rework");
    // Clamped: a team removed after it delivered would otherwise read as a
    // negative denominator gap.
    const notDelivered = Math.max(0, total - submitted);
    const storage = filesBy.get(assignment.id);

    return {
      assignment,
      total,
      teams: teamsBy.get(assignment.id) ?? 0,
      groupedStudents: membersBy.get(assignment.id) ?? 0,
      submitted,
      approved,
      rework,
      late,
      lateDelivered,
      notDelivered,
      outstanding: notDelivered + rework,
      delivered: submitted - rework,
      files: storage?.files ?? 0,
      bytes: storage?.bytes ?? 0,
      extensions: extensionsBy.get(assignment.id) ?? 0,
      overdue: now > assignment.dueAt,
    };
  });

  const current = summaries.find((s) => s.assignment.dueAt >= now);
  const focus = current ?? summaries[0] ?? null;

  // Reshaped from `summaries` rather than re-querying, so this can never
  // disagree with the counts shown elsewhere on the page.
  const weeklyTrend = orderPublishedAssignments(
    summaries.map((s) => s.assignment),
  ).map((assignment) => {
    const s = summaries.find((x) => x.assignment.id === assignment.id)!;
    return {
      assignmentId: assignment.id,
      label: assignment.weekNumber != null ? `W${assignment.weekNumber}` : assignment.title,
      onTime: s.delivered - s.lateDelivered,
      late: s.lateDelivered,
      rework: s.rework,
      missing: s.notDelivered,
    };
  });

  return {
    summaries,
    weeklyTrend,
    videoCompliance: {
      total: Number(videoStats?.total ?? 0),
      compliant: Number(videoStats?.compliant ?? 0),
    },
    /** The assignment the teacher most likely cares about right now. */
    current: focus,
    teamCount: focus?.teams ?? 0,
    studentCount: focus?.groupedStudents ?? 0,
    /** Active roster size, so the page can say who is not grouped yet. */
    rosterCount: Number(roster?.n ?? 0),
    /** Unpublished assignments — students cannot see these yet. */
    draftCount: everyAssignment.length - published.length,
    /** Everything handed in this semester, across every assignment. */
    totals: {
      submitted: summaries.reduce((n, s) => n + s.submitted, 0),
      outstanding: summaries.reduce((n, s) => n + s.outstanding, 0),
      late: summaries.reduce((n, s) => n + s.late, 0),
      rework: summaries.reduce((n, s) => n + s.rework, 0),
      files: summaries.reduce((n, s) => n + s.files, 0),
      bytes: summaries.reduce((n, s) => n + s.bytes, 0),
    },
    /** The instant these numbers describe. Returned so the page can render
     *  countdowns without reading the clock during render. */
    now,
  };
}

export interface StoragePoint {
  /** Midnight UTC ms for the day this point represents. */
  day: number;
  bytesAdded: number;
  cumulativeBytes: number;
}

/** Cumulative storage use by day, for a semester-wide trend chart. */
export async function getStorageOverTime(): Promise<StoragePoint[]> {
  const rows = await db
    .select({
      day: sql<number>`(${submissionFiles.uploadedAt} / 86400000) * 86400000`,
      bytes: sql<number>`coalesce(sum(${submissionFiles.sizeBytes}), 0)`,
    })
    .from(submissionFiles)
    .groupBy(sql`${submissionFiles.uploadedAt} / 86400000`)
    .orderBy(sql`${submissionFiles.uploadedAt} / 86400000`);

  let running = 0;
  return rows.map((r) => {
    const bytes = Number(r.bytes);
    running += bytes;
    return { day: Number(r.day), bytesAdded: bytes, cumulativeBytes: running };
  });
}

export interface StudentMatrixCell {
  assignmentId: number;
  state: DeliveryState;
}

export interface StudentMatrixRow {
  student: Student;
  cells: StudentMatrixCell[];
}

export interface StudentDeliveryMatrix {
  columns: Assignment[];
  rows: StudentMatrixRow[];
}

/**
 * Student x assignment delivery grid, across the whole semester.
 *
 * Teams are re-cut every assignment (`teams.assignmentId`), so there is no
 * persistent team identity to key a matrix on — only the student is stable
 * week to week. Each cell is resolved the same way `deliveryState` resolves
 * every other status in the app, so this can never disagree with a badge
 * shown elsewhere.
 */
export async function getStudentDeliveryMatrix(
  now: number = Date.now(),
): Promise<StudentDeliveryMatrix> {
  const [everyAssignment, activeStudents, memberships, allSubs, allExtensions] =
    await Promise.all([
      db.select().from(assignments).orderBy(desc(assignments.dueAt)),
      db
        .select()
        .from(students)
        .where(eq(students.active, true))
        .orderBy(asc(students.name)),
      db.select().from(teamMembers),
      db.select().from(submissions),
      db.select().from(deadlineExtensions),
    ]);

  const columns = orderPublishedAssignments(
    everyAssignment.filter((a) => a.publishedAt != null),
  );

  const teamIdFor = new Map<string, number>();
  for (const m of memberships) {
    teamIdFor.set(`${m.assignmentId}:${m.studentId}`, m.teamId);
  }

  // Solo submissions carry the student directly; team submissions carry the
  // team and a null studentId. Mixing these two lookups up would make every
  // member of a solo assignment's roster show the same state.
  const soloSubmission = new Map<string, Submission>();
  const teamSubmission = new Map<string, Submission>();
  for (const s of allSubs) {
    if (s.studentId != null) soloSubmission.set(`${s.assignmentId}:${s.studentId}`, s);
    else teamSubmission.set(`${s.assignmentId}:${s.teamId}`, s);
  }

  const extensionFor = new Map(
    allExtensions.map((e) => [`${e.assignmentId}:${e.teamId}`, e.newDueAt]),
  );

  const rows: StudentMatrixRow[] = activeStudents.map((student) => ({
    student,
    cells: columns.map((assignment) => {
      const teamId = teamIdFor.get(`${assignment.id}:${student.id}`);
      const deadline = resolveDeadline(
        assignment,
        teamId != null ? (extensionFor.get(`${assignment.id}:${teamId}`) ?? null) : null,
        now,
      );

      const submission =
        assignment.mode === "solo"
          ? soloSubmission.get(`${assignment.id}:${student.id}`)
          : teamId != null
            ? teamSubmission.get(`${assignment.id}:${teamId}`)
            : undefined;

      return {
        assignmentId: assignment.id,
        state: deliveryState(submission ?? null, deadline),
      };
    }),
  }));

  return { columns, rows };
}

/** Every assignment, drafts included, newest deadline first. */
export async function listAssignments(now: number = Date.now()) {
  const rows = await db
    .select()
    .from(assignments)
    .orderBy(desc(assignments.dueAt));
  return { assignments: rows, now };
}

/* -------------------------------------------------------------------------- */
/* Teams and roster                                                            */
/* -------------------------------------------------------------------------- */

export interface RosterMember {
  student: Student;
  /** The team they are on right now, or null. */
  team: { id: number; name: string } | null;
}

/**
 * The whole active roster with each student's current team.
 *
 * The admin team screens use this rather than "students with no team", so a
 * group can be assembled from anyone in the class. Moving someone is then a
 * single action, and the UI can say where they are coming from instead of
 * making the admin dismantle the old team first.
 */
export async function getRosterWithTeams(
  assignmentId: number,
): Promise<RosterMember[]> {
  const rows = await db
    .select({ student: students, teamId: teams.id, teamName: teams.name })
    .from(students)
    .leftJoin(
      teamMembers,
      and(
        eq(teamMembers.studentId, students.id),
        eq(teamMembers.assignmentId, assignmentId),
      ),
    )
    .leftJoin(teams, eq(teams.id, teamMembers.teamId))
    .where(eq(students.active, true))
    .orderBy(asc(students.name));

  return rows.map((r) => ({
    student: r.student,
    team: r.teamId != null ? { id: r.teamId, name: r.teamName ?? "" } : null,
  }));
}

export interface TeamWithMembers {
  team: Team;
  members: Student[];
}

export async function getTeamsWithMembers(
  assignmentId: number,
): Promise<TeamWithMembers[]> {
  const [allTeams, memberships] = await Promise.all([
    db
      .select()
      .from(teams)
      .where(eq(teams.assignmentId, assignmentId))
      .orderBy(asc(teams.name)),
    db
      .select({ teamId: teamMembers.teamId, student: students })
      .from(teamMembers)
      .innerJoin(students, eq(teamMembers.studentId, students.id))
      .where(eq(teamMembers.assignmentId, assignmentId))
      .orderBy(asc(students.name)),
  ]);

  const byTeam = new Map<number, Student[]>();
  for (const m of memberships) {
    const list = byTeam.get(m.teamId);
    if (list) list.push(m.student);
    else byTeam.set(m.teamId, [m.student]);
  }

  return allTeams.map((team) => ({
    team,
    members: byTeam.get(team.id) ?? [],
  }));
}

export interface RosterRow {
  student: Student;
  /**
   * How many published assignments this student is grouped for, out of how
   * many there are. "Which team are they on" no longer has a single answer —
   * they have one per assignment — so the class list reports coverage and
   * leaves the detail to the Teams screen.
   */
  groupedFor: number;
  publishedAssignments: number;
  /** Solo deliveries this student owns. Removing them would take these with
   *  them, so the confirmation can say so instead of guessing. */
  soloSubmissions: number;
  /** Team deliveries they were the one to hand in. Those belong to the team
   *  and survive; only the "submitted by" name is cleared. */
  submittedByThem: number;
}

export async function getRoster(): Promise<RosterRow[]> {
  const [rows, grouped, publishedCount, solo, submitted] = await Promise.all([
    db.select().from(students).orderBy(asc(students.name)),
    // One row per student: how many published assignments they are grouped for.
    db
      .select({
        studentId: teamMembers.studentId,
        n: sql<number>`count(*)`.as("n"),
      })
      .from(teamMembers)
      .innerJoin(assignments, eq(assignments.id, teamMembers.assignmentId))
      .where(isNotNull(assignments.publishedAt))
      .groupBy(teamMembers.studentId),
    db
      .select({ n: sql<number>`count(*)` })
      .from(assignments)
      .where(isNotNull(assignments.publishedAt))
      .get(),
    db
      .select({
        studentId: submissions.studentId,
        n: sql<number>`count(*)`.as("n"),
      })
      .from(submissions)
      .where(isNotNull(submissions.studentId))
      .groupBy(submissions.studentId),
    db
      .select({
        studentId: submissions.submittedByStudentId,
        n: sql<number>`count(*)`.as("n"),
      })
      .from(submissions)
      .where(isNull(submissions.studentId))
      .groupBy(submissions.submittedByStudentId),
  ]);

  const soloBy = new Map(solo.map((r) => [r.studentId, Number(r.n)]));
  const sentBy = new Map(submitted.map((r) => [r.studentId, Number(r.n)]));
  const groupedBy = new Map(grouped.map((r) => [r.studentId, Number(r.n)]));

  return rows.map((student) => ({
    student,
    groupedFor: groupedBy.get(student.id) ?? 0,
    publishedAssignments: publishedCount?.n ?? 0,
    soloSubmissions: soloBy.get(student.id) ?? 0,
    submittedByThem: sentBy.get(student.id) ?? 0,
  }));
}
