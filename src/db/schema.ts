import { relations, sql } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";

/**
 * Timestamps are stored as epoch milliseconds (integer) rather than SQLite's
 * loose date strings, so ordering and deadline comparison are unambiguous and
 * timezone-free. Rendering to Europe/Copenhagen happens in the UI layer.
 */
const createdAt = () =>
  integer("created_at")
    .notNull()
    .default(sql`(unixepoch() * 1000)`);

/* -------------------------------------------------------------------------- */
/* Roster                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The class roster. This is the source of truth for every name dropdown in the
 * app — students never create their own records, so a typo can't invent a
 * person and delivery counts always add up against a known denominator.
 */
export const students = sqliteTable(
  "students",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    email: text("email").notNull(),
    /**
     * Deactivated students stay in the DB (their submissions must survive) but
     * drop out of dropdowns and delivery counts.
     */
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("students_email_unique").on(t.email)],
);

/* -------------------------------------------------------------------------- */
/* Teams                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * A team is the credential. `accessToken` is 128 bits of randomness and appears
 * in the URL students bookmark; `shortCode` is the typable version for the
 * landing page. Both are unique and either can be rotated by an admin if a link
 * leaks.
 */
export const teams = sqliteTable(
  "teams",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /**
     * A team belongs to exactly one assignment. Groups get re-cut week to week
     * on this programme, so a semester-long team was the wrong unit: it made
     * "who am I working with" a property of the course rather than of the piece
     * of work. The cost is that a team's code is also per-assignment, so a group
     * that stays together still takes a new code each week.
     */
    assignmentId: integer("assignment_id")
      .notNull()
      .references(() => assignments.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    accessToken: text("access_token").notNull(),
    shortCode: text("short_code").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("teams_access_token_unique").on(t.accessToken),
    uniqueIndex("teams_short_code_unique").on(t.shortCode),
    index("teams_assignment_idx").on(t.assignmentId),
  ],
);

/**
 * Membership.
 *
 * `assignmentId` is denormalised from the team purely to carry the unique index
 * below: one student, at most one team, *per assignment*. SQLite cannot express
 * that across a join, and this is the guarantee the whole delivery count rests
 * on — so it belongs in the database rather than in whichever code path
 * remembers to check.
 */
export const teamMembers = sqliteTable(
  "team_members",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    teamId: integer("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    assignmentId: integer("assignment_id")
      .notNull()
      .references(() => assignments.id, { onDelete: "cascade" }),
    studentId: integer("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("team_members_assignment_student_unique").on(
      t.assignmentId,
      t.studentId,
    ),
    index("team_members_team_idx").on(t.teamId),
  ],
);

/* -------------------------------------------------------------------------- */
/* Assignments                                                                 */
/* -------------------------------------------------------------------------- */

export type AssignmentMode = "team" | "solo";

/**
 * Where this assignment's teams come from.
 *
 * - `copy`     — clone the previous assignment's groups when it is published,
 *                so a class whose groups rarely change does nothing at all.
 * - `students` — start empty; students form their own at /join.
 * - `admin`    — start empty; only the admin creates and fills them.
 *
 * `copy` and `students` differ only in who is expected to act, but the
 * distinction is what lets the admin overview tell "nobody has grouped up yet"
 * apart from "this is waiting on me".
 */
export type TeamGrouping = "copy" | "students" | "admin";

export const assignments = sqliteTable(
  "assignments",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    title: text("title").notNull(),
    /** Markdown, rendered read-only for students. */
    description: text("description").notNull().default(""),
    weekNumber: integer("week_number"),
    mode: text("mode").$type<AssignmentMode>().notNull().default("team"),
    grouping: text("grouping")
      .$type<TeamGrouping>()
      .notNull()
      .default("copy"),

    dueAt: integer("due_at").notNull(),
    /** Null while a draft; set when the admin publishes it to students. */
    publishedAt: integer("published_at"),
    /** When false, the submission form closes at the deadline. */
    acceptLate: integer("accept_late", { mode: "boolean" })
      .notNull()
      .default(true),

    requiresFiles: integer("requires_files", { mode: "boolean" })
      .notNull()
      .default(true),
    requiresVideo: integer("requires_video", { mode: "boolean" })
      .notNull()
      .default(false),
    /** Comma-separated, lowercase, no dots: "zip,pdf". Empty means anything. */
    allowedExtensions: text("allowed_extensions").notNull().default("zip,pdf"),
    maxFileSizeMb: integer("max_file_size_mb").notNull().default(200),

    createdAt: createdAt(),
  },
  (t) => [index("assignments_due_idx").on(t.dueAt)],
);

/* -------------------------------------------------------------------------- */
/* Submissions                                                                 */
/* -------------------------------------------------------------------------- */

export type SubmissionStatus = "submitted" | "approved" | "rework";

/**
 * One row per delivery. For a team assignment `studentId` is null and the row
 * belongs to the whole team; for a solo assignment `studentId` identifies the
 * member and `teamId` records which team page it came through. The two partial
 * unique indexes below stop the same team (or student) from ending up with two
 * live submissions for one assignment.
 */
export const submissions = sqliteTable(
  "submissions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    assignmentId: integer("assignment_id")
      .notNull()
      .references(() => assignments.id, { onDelete: "cascade" }),
    teamId: integer("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    /** Set only for solo assignments. */
    studentId: integer("student_id").references(() => students.id, {
      onDelete: "set null",
    }),
    /** Who clicked submit, chosen from the roster dropdown. */
    submittedByStudentId: integer("submitted_by_student_id").references(
      () => students.id,
      { onDelete: "set null" },
    ),

    videoUrl: text("video_url"),
    /** The student ticked "I have set sharing so AAU staff can view this". */
    videoShareConfirmed: integer("video_share_confirmed", { mode: "boolean" })
      .notNull()
      .default(false),
    /** An alternative to uploading a file — a Colab notebook, a GitHub repo,
     *  anything hosted elsewhere. Either this or a file satisfies
     *  requiresFiles; a team can give both. */
    linkUrl: text("link_url"),
    note: text("note"),

    status: text("status")
      .$type<SubmissionStatus>()
      .notNull()
      .default("submitted"),
    reviewComment: text("review_comment"),
    reviewedAt: integer("reviewed_at"),
    reviewedByAdminId: integer("reviewed_by_admin_id"),

    submittedAt: integer("submitted_at")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    /**
     * Frozen at submit time against the team's effective deadline, so a later
     * extension does not silently rewrite history.
     */
    isLate: integer("is_late", { mode: "boolean" }).notNull().default(false),
  },
  (t) => [
    uniqueIndex("submissions_team_unique")
      .on(t.assignmentId, t.teamId)
      .where(sql`student_id IS NULL`),
    uniqueIndex("submissions_student_unique")
      .on(t.assignmentId, t.studentId)
      .where(sql`student_id IS NOT NULL`),
    index("submissions_assignment_idx").on(t.assignmentId),
  ],
);

export const submissionFiles = sqliteTable(
  "submission_files",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    submissionId: integer("submission_id")
      .notNull()
      .references(() => submissions.id, { onDelete: "cascade" }),
    /** What the student called it; shown in the UI and used in the bulk ZIP. */
    originalName: text("original_name").notNull(),
    /** UUID filename on disk. Never derived from user input. */
    storedName: text("stored_name").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    mimeType: text("mime_type"),
    uploadedAt: createdAt(),
  },
  (t) => [index("submission_files_submission_idx").on(t.submissionId)],
);

/* -------------------------------------------------------------------------- */
/* Deadline extensions                                                         */
/* -------------------------------------------------------------------------- */

/** Per-team override of an assignment deadline. */
export const deadlineExtensions = sqliteTable(
  "deadline_extensions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    assignmentId: integer("assignment_id")
      .notNull()
      .references(() => assignments.id, { onDelete: "cascade" }),
    teamId: integer("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    newDueAt: integer("new_due_at").notNull(),
    reason: text("reason"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("deadline_extensions_unique").on(t.assignmentId, t.teamId)],
);

/* -------------------------------------------------------------------------- */
/* Team forum                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * One team's discussion board. Keyed on `teams.id`, which is per-assignment —
 * so each assignment's groups start with an empty board. That is a direct
 * consequence of teams being the unit of work rather than a semester-long
 * identity (see the comment on `teams` above); accepted deliberately rather
 * than worked around.
 */
export const forumMessages = sqliteTable(
  "forum_messages",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    teamId: integer("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    /** Null for a top-level post. Replies are flattened to one level — see
     *  the write path in forum-actions.ts for why. */
    parentId: integer("parent_id").references(
      (): AnySQLiteColumn => forumMessages.id,
      { onDelete: "cascade" },
    ),
    authorStudentId: integer("author_student_id")
      .notNull()
      .references(() => students.id, { onDelete: "cascade" }),
    /** Snapshot of the roster name at post time, so a later rename never
     *  rewrites what the thread already showed. */
    authorName: text("author_name").notNull(),
    body: text("body").notNull(),
    createdAt: createdAt(),
    /** Non-null once edited; the UI shows "edited". */
    editedAt: integer("edited_at"),
    /** Soft delete: the row and its replies survive, the body is hidden. */
    deletedAt: integer("deleted_at"),
  },
  (t) => [
    index("forum_messages_team_idx").on(t.teamId, t.createdAt),
    index("forum_messages_parent_idx").on(t.parentId),
  ],
);

export type ForumMessage = typeof forumMessages.$inferSelect;

export const forumMessagesRelations = relations(forumMessages, ({ one }) => ({
  team: one(teams, { fields: [forumMessages.teamId], references: [teams.id] }),
  author: one(students, {
    fields: [forumMessages.authorStudentId],
    references: [students.id],
  }),
}));

/* -------------------------------------------------------------------------- */
/* Admin + audit                                                               */
/* -------------------------------------------------------------------------- */

export const admins = sqliteTable(
  "admins",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    /** When this admin last looked at the overview. Null means "never" — a
     *  brand-new admin sees everything as new rather than nothing. Lives here
     *  rather than on a session, since a session is destroyed on logout and
     *  pruned when expired. */
    notificationsSeenAt: integer("notifications_seen_at"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("admins_email_unique").on(t.email)],
);

export const adminSessions = sqliteTable(
  "admin_sessions",
  {
    /** Random opaque token; the cookie value. */
    id: text("id").primaryKey(),
    adminId: integer("admin_id")
      .notNull()
      .references(() => admins.id, { onDelete: "cascade" }),
    expiresAt: integer("expires_at").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("admin_sessions_admin_idx").on(t.adminId)],
);

/**
 * Because students are identified by a shared team link rather than a login,
 * this log is what makes actions attributable after the fact. Every submit,
 * replace, and team change lands here.
 */
export const auditLog = sqliteTable(
  "audit_log",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    at: createdAt(),
    teamId: integer("team_id"),
    /** Free text: the roster name chosen, or "admin:<email>". */
    actorName: text("actor_name"),
    action: text("action").notNull(),
    detail: text("detail"),
    ip: text("ip"),
  },
  (t) => [index("audit_log_at_idx").on(t.at)],
);

export type AuditLogEntry = typeof auditLog.$inferSelect;

/**
 * Small key/value store for admin-editable settings (semester name, video host
 * allow-list, defaults). Kept as one table so adding a setting never needs a
 * migration.
 */
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export type Student = typeof students.$inferSelect;
export type Team = typeof teams.$inferSelect;
export type TeamMember = typeof teamMembers.$inferSelect;
export type Assignment = typeof assignments.$inferSelect;
export type Submission = typeof submissions.$inferSelect;
export type SubmissionFile = typeof submissionFiles.$inferSelect;
export type DeadlineExtension = typeof deadlineExtensions.$inferSelect;
export type Admin = typeof admins.$inferSelect;

/* -------------------------------------------------------------------------- */
/* Relations                                                                   */
/* -------------------------------------------------------------------------- */

export const teamsRelations = relations(teams, ({ one, many }) => ({
  assignment: one(assignments, {
    fields: [teams.assignmentId],
    references: [assignments.id],
  }),
  members: many(teamMembers),
  submissions: many(submissions),
  forum: many(forumMessages),
}));

export const teamMembersRelations = relations(teamMembers, ({ one }) => ({
  team: one(teams, { fields: [teamMembers.teamId], references: [teams.id] }),
  assignment: one(assignments, {
    fields: [teamMembers.assignmentId],
    references: [assignments.id],
  }),
  student: one(students, {
    fields: [teamMembers.studentId],
    references: [students.id],
  }),
}));

export const studentsRelations = relations(students, ({ many }) => ({
  /** One per assignment they are grouped for, not one overall. */
  memberships: many(teamMembers),
}));

export const assignmentsRelations = relations(assignments, ({ many }) => ({
  teams: many(teams),
  submissions: many(submissions),
  extensions: many(deadlineExtensions),
}));

export const submissionsRelations = relations(submissions, ({ one, many }) => ({
  assignment: one(assignments, {
    fields: [submissions.assignmentId],
    references: [assignments.id],
  }),
  team: one(teams, { fields: [submissions.teamId], references: [teams.id] }),
  student: one(students, {
    fields: [submissions.studentId],
    references: [students.id],
  }),
  submittedBy: one(students, {
    fields: [submissions.submittedByStudentId],
    references: [students.id],
  }),
  files: many(submissionFiles),
}));

export const submissionFilesRelations = relations(submissionFiles, ({ one }) => ({
  submission: one(submissions, {
    fields: [submissionFiles.submissionId],
    references: [submissions.id],
  }),
}));

export const deadlineExtensionsRelations = relations(
  deadlineExtensions,
  ({ one }) => ({
    assignment: one(assignments, {
      fields: [deadlineExtensions.assignmentId],
      references: [assignments.id],
    }),
    team: one(teams, {
      fields: [deadlineExtensions.teamId],
      references: [teams.id],
    }),
  }),
);
