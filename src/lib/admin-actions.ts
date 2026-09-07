"use server";

import { and, eq, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { db } from "@/db";
import {
  admins,
  assignments,
  deadlineExtensions,
  students,
  submissionFiles,
  submissions,
  teamMembers,
  teams,
  type AssignmentMode,
  type TeamGrouping,
  type SubmissionStatus,
} from "@/db/schema";
import { recordAudit, requireAdmin } from "./auth";
import { fromDateTimeLocal } from "./format";
import { generateAccessToken, generateShortCode } from "./ids";
import { isEmailish, parseRoster } from "./roster";
import { setSetting, type SettingKey } from "./settings";
import { copyTeams, shuffleTeams } from "./teams";
import { SETTING_DEFAULTS } from "./config";
import { deleteStoredFile } from "./storage";

/**
 * Every admin mutation.
 *
 * All of them start with `requireAdmin()`. Server Actions are reachable by
 * direct POST regardless of what the page renders, so the check has to live in
 * the action itself rather than only on the page that shows the button.
 */

const str = (form: FormData, key: string) => String(form.get(key) ?? "").trim();
const on = (form: FormData, key: string) => form.get(key) === "on";
const num = (form: FormData, key: string) => Number(form.get(key));

/* -------------------------------------------------------------------------- */
/* Assignments                                                                 */
/* -------------------------------------------------------------------------- */

export async function saveAssignment(formData: FormData) {
  const admin = await requireAdmin();

  const id = formData.get("id") ? num(formData, "id") : null;
  const title = str(formData, "title");
  const dueAt = fromDateTimeLocal(str(formData, "dueAt"));

  if (!title) backWithError(id, "Give the assignment a title.");
  if (Number.isNaN(dueAt)) {
    backWithError(id, "That deadline is not a valid date and time.");
  }

  const weekRaw = str(formData, "weekNumber");
  const requiresFiles = on(formData, "requiresFiles");
  const requiresVideo = on(formData, "requiresVideo");

  if (!requiresFiles && !requiresVideo) {
    backWithError(id, "An assignment must ask for files, a video, or both.");
  }

  const values = {
    title,
    description: String(formData.get("description") ?? ""),
    weekNumber: weekRaw ? Number(weekRaw) : null,
    mode: (str(formData, "mode") === "solo" ? "solo" : "team") as AssignmentMode,
    grouping: (["copy", "students", "admin"].includes(str(formData, "grouping"))
      ? str(formData, "grouping")
      : "copy") as TeamGrouping,
    dueAt,
    acceptLate: on(formData, "acceptLate"),
    requiresFiles,
    requiresVideo,
    allowedExtensions: normaliseExtensions(str(formData, "allowedExtensions")),
    maxFileSizeMb: Math.max(
      1,
      Math.min(2000, num(formData, "maxFileSizeMb") || 200),
    ),
    publishedAt: on(formData, "published") ? Date.now() : null,
  };

  let assignmentId: number;
  if (id) {
    // Keep the original publication time rather than resetting it on each save.
    const existing = await db.query.assignments.findFirst({
      where: eq(assignments.id, id),
    });
    await db
      .update(assignments)
      .set({
        ...values,
        publishedAt: values.publishedAt
          ? (existing?.publishedAt ?? Date.now())
          : null,
      })
      .where(eq(assignments.id, id));
    assignmentId = id;
  } else {
    const row = await db.insert(assignments).values(values).returning().get();
    assignmentId = row.id;
  }

  await recordAudit({
    action: id ? "assignment.updated" : "assignment.created",
    actorName: `admin:${admin.email}`,
    detail: title,
  });

  revalidatePath("/admin");
  revalidatePath("/admin/assignments");
  redirect(`/admin/assignments/${assignmentId}`);
}

function backWithError(id: number | null, message: string): never {
  const base = id ? `/admin/assignments/${id}/edit` : "/admin/assignments/new";
  redirect(`${base}?error=${encodeURIComponent(message)}`);
}

/** "ZIP, .pdf" -> "zip,pdf" */
function normaliseExtensions(raw: string): string {
  return raw
    .split(/[,\s]+/)
    .map((e) => e.trim().toLowerCase().replace(/^\./, ""))
    .filter(Boolean)
    .join(",");
}

export async function deleteAssignment(formData: FormData) {
  const admin = await requireAdmin();
  const id = num(formData, "id");

  const assignment = await db.query.assignments.findFirst({
    where: eq(assignments.id, id),
    with: { submissions: { with: { files: true } } },
  });
  if (!assignment) redirect("/admin/assignments");

  // Remove the bytes before the rows, so nothing is orphaned on disk. The
  // cascade then takes the submission and file records with the assignment.
  for (const submission of assignment.submissions) {
    for (const file of submission.files) {
      await deleteStoredFile(file.storedName).catch(() => undefined);
    }
  }

  await db.delete(assignments).where(eq(assignments.id, id));
  await recordAudit({
    action: "assignment.deleted",
    actorName: `admin:${admin.email}`,
    detail: `${assignment.title} (${assignment.submissions.length} submission(s))`,
  });

  revalidatePath("/admin/assignments");
  redirect("/admin/assignments");
}

/* -------------------------------------------------------------------------- */
/* Review                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Approve, send back, or just leave a comment.
 *
 * `status` is optional: when it is absent (the "Save feedback" button) the
 * comment is written without touching the review status at all, for a
 * delivery that is fine as-is but still worth a note. When present it must be
 * one of the three real values — an admin action is reachable by direct POST,
 * so this cannot trust a stray value through.
 */
export async function reviewSubmission(formData: FormData) {
  const admin = await requireAdmin();

  const submissionId = num(formData, "submissionId");
  const rawStatus = str(formData, "status");
  const status = rawStatus
    ? (rawStatus as SubmissionStatus)
    : null;
  if (status && !["submitted", "approved", "rework"].includes(status)) return;

  const comment = String(formData.get("reviewComment") ?? "").trim();

  await db
    .update(submissions)
    .set({
      ...(status ? { status } : {}),
      reviewComment: comment || null,
      reviewedAt: Date.now(),
      reviewedByAdminId: admin.id,
    })
    .where(eq(submissions.id, submissionId));

  const submission = await db.query.submissions.findFirst({
    where: eq(submissions.id, submissionId),
    with: { assignment: true, team: true },
  });

  await recordAudit({
    action: status ? `submission.${status}` : "submission.commented",
    actorName: `admin:${admin.email}`,
    teamId: submission?.teamId ?? null,
    detail: `${submission?.assignment.title ?? ""} — ${submission?.team.name ?? ""}`,
  });

  revalidatePath(`/admin/assignments/${submission?.assignmentId}`);
}

/* -------------------------------------------------------------------------- */
/* Deadline extensions                                                         */
/* -------------------------------------------------------------------------- */

export async function setExtension(formData: FormData) {
  const admin = await requireAdmin();

  const assignmentId = num(formData, "assignmentId");
  const teamId = num(formData, "teamId");
  const raw = str(formData, "newDueAt");

  if (!raw) {
    // An empty date clears the extension and restores the shared deadline.
    await db
      .delete(deadlineExtensions)
      .where(
        and(
          eq(deadlineExtensions.assignmentId, assignmentId),
          eq(deadlineExtensions.teamId, teamId),
        ),
      );
    await recordAudit({
      action: "extension.cleared",
      actorName: `admin:${admin.email}`,
      teamId,
    });
    revalidatePath(`/admin/assignments/${assignmentId}`);
    return;
  }

  const newDueAt = fromDateTimeLocal(raw);
  if (Number.isNaN(newDueAt)) return;

  const reason = str(formData, "reason") || null;

  await db
    .insert(deadlineExtensions)
    .values({ assignmentId, teamId, newDueAt, reason })
    .onConflictDoUpdate({
      target: [deadlineExtensions.assignmentId, deadlineExtensions.teamId],
      set: { newDueAt, reason },
    });

  await recordAudit({
    action: "extension.set",
    actorName: `admin:${admin.email}`,
    teamId,
    detail: raw,
  });

  revalidatePath(`/admin/assignments/${assignmentId}`);
}

/* -------------------------------------------------------------------------- */
/* Roster                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Import a roster pasted as CSV or as plain "Name <email>" lines.
 *
 * Existing students are matched on email and left alone rather than duplicated,
 * so the same list can be pasted twice without consequence — which is exactly
 * what happens when someone re-imports after adding one late enrolment.
 */
export async function importRoster(formData: FormData) {
  const admin = await requireAdmin();
  const raw = String(formData.get("roster") ?? "");

  const parsed = parseRoster(raw);
  if (parsed.length === 0) {
    redirect(
      "/admin/students?error=" +
        encodeURIComponent("No names with email addresses found in that text."),
    );
  }

  const existing = new Set(
    (await db.select({ email: students.email }).from(students)).map((s) =>
      s.email.toLowerCase(),
    ),
  );

  const fresh = parsed.filter((p) => !existing.has(p.email));
  if (fresh.length > 0) {
    await db.insert(students).values(fresh);
  }

  await recordAudit({
    action: "roster.imported",
    actorName: `admin:${admin.email}`,
    detail: `${fresh.length} added, ${parsed.length - fresh.length} already present`,
  });

  revalidatePath("/admin/students");
  redirect(
    `/admin/students?added=${fresh.length}&skipped=${parsed.length - fresh.length}`,
  );
}

const studentsError = (message: string) =>
  redirect("/admin/students?error=" + encodeURIComponent(message));

/**
 * Add one student by hand.
 *
 * The bulk import covers the start of term; this covers the late enrolment,
 * the exchange student who appears in week three, and the typo that needs a
 * replacement row. Matching on email is what keeps it idempotent.
 */
export async function addStudent(formData: FormData) {
  const admin = await requireAdmin();
  const name = str(formData, "name");
  const email = str(formData, "email").toLowerCase();

  if (!name) studentsError("A name is required.");
  if (!isEmailish(email)) studentsError(`"${email}" is not an email address.`);

  const clash = await db.query.students.findFirst({
    where: eq(students.email, email),
  });
  if (clash) studentsError(`${email} is already on the list (${clash.name}).`);

  await db.insert(students).values({ name, email });
  await recordAudit({
    action: "student.added",
    actorName: `admin:${admin.email}`,
    detail: `${name} <${email}>`,
  });

  revalidatePath("/admin/students");
  redirect("/admin/students?added=1&single=1");
}

/**
 * Correct a name or an address.
 *
 * Worth having precisely so that fixing a typo never means delete-and-re-add,
 * which would take the student's deliveries with it.
 */
export async function updateStudent(formData: FormData) {
  const admin = await requireAdmin();
  const id = num(formData, "studentId");
  const name = str(formData, "name");
  const email = str(formData, "email").toLowerCase();

  if (!Number.isInteger(id)) return;
  if (!name) studentsError("A name is required.");
  if (!isEmailish(email)) studentsError(`"${email}" is not an email address.`);

  const clash = await db.query.students.findFirst({
    where: and(eq(students.email, email), ne(students.id, id)),
  });
  if (clash) studentsError(`${email} already belongs to ${clash.name}.`);

  await db.update(students).set({ name, email }).where(eq(students.id, id));
  await recordAudit({
    action: "student.updated",
    actorName: `admin:${admin.email}`,
    detail: `${name} <${email}>`,
  });
  revalidatePath("/admin/students");
}

/**
 * Remove a student from the class list for good.
 *
 * Their solo deliveries are deleted with them, files included, because a solo
 * submission whose owner is gone is not a submission any more — the schema
 * would null the owner out and the row would silently start looking like a
 * team delivery. Team deliveries they happened to hand in are left alone;
 * those belong to the team, and only the "submitted by" name clears.
 *
 * Deactivating is the gentler option and stays the right one mid-semester.
 * This is for the row that should never have been there.
 */
export async function deleteStudent(formData: FormData) {
  const admin = await requireAdmin();
  const id = num(formData, "studentId");
  if (!Number.isInteger(id)) return;

  const student = await db.query.students.findFirst({
    where: eq(students.id, id),
  });
  if (!student) return;

  const solo = await db.query.submissions.findMany({
    where: eq(submissions.studentId, id),
    with: { files: true },
  });

  for (const submission of solo) {
    for (const file of submission.files) {
      await deleteStoredFile(file.storedName).catch(() => undefined);
    }
    await db.delete(submissions).where(eq(submissions.id, submission.id));
  }

  // team_members cascades; submitted_by on team rows becomes null.
  await db.delete(students).where(eq(students.id, id));

  await recordAudit({
    action: "student.deleted",
    actorName: `admin:${admin.email}`,
    detail: `${student.name} <${student.email}> (${solo.length} solo delivery/deliveries removed)`,
  });
  revalidatePath("/admin/students");
  revalidatePath("/admin/teams");
}

export async function setStudentActive(formData: FormData) {
  const admin = await requireAdmin();
  const id = num(formData, "studentId");
  const active = on(formData, "active");

  await db.update(students).set({ active }).where(eq(students.id, id));
  await recordAudit({
    action: active ? "student.reactivated" : "student.deactivated",
    actorName: `admin:${admin.email}`,
    detail: String(id),
  });
  revalidatePath("/admin/students");
}

/* -------------------------------------------------------------------------- */
/* Teams                                                                       */
/* -------------------------------------------------------------------------- */

export async function createTeamAsAdmin(formData: FormData) {
  const admin = await requireAdmin();
  const name = str(formData, "name");
  const assignmentId = num(formData, "assignmentId");
  if (!name || !Number.isInteger(assignmentId)) return;

  const memberIds = formData
    .getAll("members")
    .map(Number)
    .filter(Number.isInteger);

  db.transaction((tx) => {
    const team = tx
      .insert(teams)
      .values({
        assignmentId,
        name,
        accessToken: generateAccessToken(),
        shortCode: generateShortCode(),
      })
      .returning()
      .get();

    if (memberIds.length > 0) {
      // One team per student per assignment, so taking someone already grouped
      // for this assignment means moving them off that team first.
      for (const studentId of memberIds) {
        tx.delete(teamMembers)
          .where(
            and(
              eq(teamMembers.studentId, studentId),
              eq(teamMembers.assignmentId, assignmentId),
            ),
          )
          .run();
      }
      tx.insert(teamMembers)
        .values(
          memberIds.map((studentId) => ({
            teamId: team.id,
            assignmentId,
            studentId,
          })),
        )
        .run();
    }
  });

  await recordAudit({
    action: "team.created_by_admin",
    actorName: `admin:${admin.email}`,
    detail: `${name} (assignment ${assignmentId})`,
  });
  revalidatePath("/admin/teams");
}

/**
 * Clone one assignment's teams onto another.
 *
 * Groups mostly stay put week to week, so re-forming them by hand every time
 * would be the most tedious thing about this screen. Fresh links and codes are
 * minted deliberately: the copy is a new set of teams, and a code that unlocked
 * last week's delivery should not unlock this week's.
 *
 * Students already grouped for the target assignment are left where they are.
 */
export async function copyTeamsFromAssignment(formData: FormData) {
  const admin = await requireAdmin();
  const fromId = num(formData, "fromAssignmentId");
  const toId = num(formData, "assignmentId");
  if (!Number.isInteger(fromId) || !Number.isInteger(toId) || fromId === toId) {
    return;
  }

  const copied = copyTeams(fromId, toId);

  await recordAudit({
    action: "teams.copied",
    actorName: `admin:${admin.email}`,
    detail: `${copied} team(s) from assignment ${fromId} to ${toId}`,
  });
  revalidatePath("/admin/teams");
}

/**
 * Auto-group students into teams of 3-4 for one assignment.
 *
 * "fill" only places students who have no team here yet; "reshuffle" re-cuts
 * everyone but refuses to touch a team that already has a submission or an
 * extension attached — `shuffleTeams` enforces that itself, not just this
 * form, since the action is reachable by direct POST.
 */
export async function shuffleTeamsAction(formData: FormData) {
  const admin = await requireAdmin();
  const assignmentId = num(formData, "assignmentId");
  if (!Number.isInteger(assignmentId)) return;
  const mode = str(formData, "mode") === "reshuffle" ? "reshuffle" : "fill";
  const preferred = num(formData, "preferred") === 3 ? 3 : 4;

  const result = shuffleTeams(assignmentId, { mode, preferred });

  await recordAudit({
    action: "team.shuffled",
    actorName: `admin:${admin.email}`,
    detail: `${mode} · created ${result.created} · placed ${result.placed} · deleted ${result.deleted} · protected ${result.protectedTeams}`,
  });

  revalidatePath("/admin/teams");
  redirect(
    `/admin/teams?assignment=${assignmentId}&shuffled=1&created=${result.created}&placed=${result.placed}&deleted=${result.deleted}&protectedTeams=${result.protectedTeams}`,
  );
}

export async function renameTeam(formData: FormData) {
  await requireAdmin();
  const id = num(formData, "teamId");
  const name = str(formData, "name");
  if (!name) return;

  await db.update(teams).set({ name }).where(eq(teams.id, id));
  revalidatePath("/admin/teams");
}

/** Rotate a team's link and code — the fix when a link has leaked. */
export async function regenerateTeamLink(formData: FormData) {
  const admin = await requireAdmin();
  const id = num(formData, "teamId");

  await db
    .update(teams)
    .set({ accessToken: generateAccessToken(), shortCode: generateShortCode() })
    .where(eq(teams.id, id));

  await recordAudit({
    action: "team.link_regenerated",
    actorName: `admin:${admin.email}`,
    teamId: id,
  });
  revalidatePath("/admin/teams");
}

/**
 * The one place membership is written.
 *
 * A student holds at most one team per assignment, so every placement is a
 * delete-then-insert scoped to that assignment, inside one transaction.
 * `teamId: null` just takes them off.
 */
function placeStudent(
  studentId: number,
  assignmentId: number,
  teamId: number | null,
) {
  db.transaction((tx) => {
    tx.delete(teamMembers)
      .where(
        and(
          eq(teamMembers.studentId, studentId),
          eq(teamMembers.assignmentId, assignmentId),
        ),
      )
      .run();
    if (teamId !== null) {
      tx.insert(teamMembers).values({ teamId, assignmentId, studentId }).run();
    }
  });
}

export async function addTeamMember(formData: FormData) {
  await requireAdmin();
  const teamId = num(formData, "teamId");
  const studentId = num(formData, "studentId");
  if (!Number.isInteger(teamId) || !Number.isInteger(studentId)) return;

  // The team knows its assignment, so the caller does not have to say.
  const team = await db.query.teams.findFirst({ where: eq(teams.id, teamId) });
  if (!team) return;

  placeStudent(studentId, team.assignmentId, teamId);
  revalidatePath("/admin/teams");
}

/**
 * Put a student on a team, or take them off one entirely (`teamId: null`).
 *
 * Takes plain arguments rather than FormData because the drag-and-drop board
 * calls it directly; the dropdown and the remove button still go through their
 * own form actions. The assignment is explicit because "off a team" has to say
 * which assignment it means.
 */
export async function moveStudent(
  studentId: number,
  assignmentId: number,
  teamId: number | null,
) {
  const admin = await requireAdmin();
  if (!Number.isInteger(studentId) || !Number.isInteger(assignmentId)) return;
  if (teamId !== null && !Number.isInteger(teamId)) return;

  placeStudent(studentId, assignmentId, teamId);

  await recordAudit({
    action: teamId === null ? "team.member_removed" : "team.member_moved",
    actorName: `admin:${admin.email}`,
    teamId: teamId ?? undefined,
    detail: `student ${studentId}, assignment ${assignmentId}`,
  });
  revalidatePath("/admin/teams");
}

export async function removeTeamMember(formData: FormData) {
  await requireAdmin();
  const studentId = num(formData, "studentId");
  const assignmentId = num(formData, "assignmentId");
  if (!Number.isInteger(studentId) || !Number.isInteger(assignmentId)) return;

  placeStudent(studentId, assignmentId, null);
  revalidatePath("/admin/teams");
}

export async function deleteTeam(formData: FormData) {
  const admin = await requireAdmin();
  const id = num(formData, "teamId");

  const team = await db.query.teams.findFirst({
    where: eq(teams.id, id),
    with: { submissions: { with: { files: true } } },
  });
  if (!team) return;

  for (const submission of team.submissions) {
    for (const file of submission.files) {
      await deleteStoredFile(file.storedName).catch(() => undefined);
    }
  }

  await db.delete(teams).where(eq(teams.id, id));
  await recordAudit({
    action: "team.deleted",
    actorName: `admin:${admin.email}`,
    detail: `${team.name} (${team.submissions.length} submission(s) removed)`,
  });
  revalidatePath("/admin/teams");
}

/* -------------------------------------------------------------------------- */
/* Settings and files                                                          */
/* -------------------------------------------------------------------------- */

export async function saveSettings(formData: FormData) {
  await requireAdmin();

  // Derived from the defaults map so adding a setting never means remembering
  // to add it here too.
  for (const key of Object.keys(SETTING_DEFAULTS) as SettingKey[]) {
    const value = formData.get(key);
    if (value != null) await setSetting(key, String(value).trim());
  }

  revalidatePath("/admin/settings");
  revalidatePath("/");
}

/**
 * Change the signed-in admin's own sign-in email.
 *
 * There is no separate account-management screen and no "forgot password"
 * flow -- this is the one place an admin's identity can change after the
 * account is first seeded from ADMIN_EMAIL at boot. Only the current admin's
 * own row is ever touched, matched by session rather than by a submitted id.
 */
export async function updateAdminEmail(formData: FormData) {
  const admin = await requireAdmin();
  const email = str(formData, "email").toLowerCase();
  const backSettings = (message: string) =>
    redirect(`/admin/settings?emailError=${encodeURIComponent(message)}`);

  if (!isEmailish(email)) backSettings("Enter a valid email address.");

  const clash = await db.query.admins.findFirst({
    where: eq(admins.email, email),
  });
  if (clash && clash.id !== admin.id) {
    backSettings("Another admin account already uses that email.");
  }

  await db.update(admins).set({ email }).where(eq(admins.id, admin.id));

  await recordAudit({
    action: "admin.email_changed",
    actorName: `admin:${admin.email}`,
    detail: `${admin.email} -> ${email}`,
  });
  revalidatePath("/admin/settings");
  redirect("/admin/settings?emailChanged=1");
}

/**
 * Clear the signed-in admin's notification badge.
 *
 * Deliberately not called from the overview's own render — a server component
 * can render more than once, and writing the seen-at timestamp mid-render
 * would risk erasing the "new" markers before they were ever shown. Instead a
 * tiny client component fires this once after the page has painted (see
 * `mark-notifications-seen.tsx`), so the badge clears a beat after the visit,
 * not during it.
 */
export async function markNotificationsSeen(): Promise<void> {
  const admin = await requireAdmin();
  await db
    .update(admins)
    .set({ notificationsSeenAt: Date.now() })
    .where(eq(admins.id, admin.id));
  revalidatePath("/admin", "layout");
}

const backAdmins = (message: string) =>
  redirect(`/admin/settings?adminError=${encodeURIComponent(message)}`);

/**
 * Create another admin account.
 *
 * There is no invite email -- nothing in this app can send one -- so the
 * person adding a colleague sets their password directly, the same way
 * ADMIN_PASSWORD seeds the first account at boot. Whoever receives it should
 * be told to sign in and change their own email/password is out of scope for
 * now, since only the email can be changed today (see updateAdminEmail).
 */
export async function createAdmin(formData: FormData) {
  const admin = await requireAdmin();
  const name = str(formData, "name");
  const email = str(formData, "email").toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!name) backAdmins("Give the new admin a name.");
  if (!isEmailish(email)) backAdmins("Enter a valid email address.");
  if (password.length < 12) {
    backAdmins("Use a password of at least 12 characters.");
  }

  const existing = await db.query.admins.findFirst({
    where: eq(admins.email, email),
  });
  if (existing) backAdmins("An admin with that email already exists.");

  const bcrypt = (await import("bcryptjs")).default;
  await db.insert(admins).values({
    name,
    email,
    passwordHash: bcrypt.hashSync(password, 12),
  });

  await recordAudit({
    action: "admin.created",
    actorName: `admin:${admin.email}`,
    detail: email,
  });
  revalidatePath("/admin/settings");
  redirect("/admin/settings?adminAdded=1");
}

/**
 * Remove another admin's account.
 *
 * Refuses to remove the account making the request (use updateAdminEmail, or
 * ask a colleague) and refuses to remove the last admin standing, since that
 * would lock everyone out of the panel with no recovery path.
 */
export async function deleteAdmin(formData: FormData) {
  const admin = await requireAdmin();
  const id = num(formData, "id");

  if (id === admin.id) {
    backAdmins("You can't remove your own account. Ask another admin.");
  }

  const target = await db.query.admins.findFirst({
    where: eq(admins.id, id),
  });
  if (!target) return;

  const allAdmins = await db.select({ id: admins.id }).from(admins);
  if (allAdmins.length <= 1) {
    backAdmins("Can't remove the last admin account.");
  }

  await db.delete(admins).where(eq(admins.id, id));

  await recordAudit({
    action: "admin.removed",
    actorName: `admin:${admin.email}`,
    detail: target.email,
  });
  revalidatePath("/admin/settings");
}

/** Remove one file from a submission, e.g. a student uploaded the wrong thing. */
export async function deleteSubmissionFile(formData: FormData) {
  const admin = await requireAdmin();
  const fileId = num(formData, "fileId");

  const file = await db.query.submissionFiles.findFirst({
    where: eq(submissionFiles.id, fileId),
  });
  if (!file) return;

  await db.delete(submissionFiles).where(eq(submissionFiles.id, fileId));
  await deleteStoredFile(file.storedName).catch(() => undefined);

  await recordAudit({
    action: "file.deleted",
    actorName: `admin:${admin.email}`,
    detail: file.originalName,
  });
  revalidatePath("/admin");
}
