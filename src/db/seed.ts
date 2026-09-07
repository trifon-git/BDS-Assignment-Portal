/**
 * Development seed: a plausible BDS cohort, a few teams, and a mix of
 * assignments already delivered, still open, missing, and needing rework — so
 * every screen has something real to render while it is being built.
 *
 * Run with `npm run db:seed`. Refuses to touch a database that already has
 * students unless RESEED=1, so it can't wipe a live class list by accident.
 */
import "dotenv/config";

import bcrypt from "bcryptjs";

import { db, runMigrations, sqlite } from "./index";
import {
  admins,
  assignments,
  deadlineExtensions,
  students,
  submissionFiles,
  submissions,
  teamMembers,
  teams,
} from "./schema";
import { generateAccessToken, generateShortCode } from "@/lib/ids";

const DAY = 24 * 60 * 60 * 1000;
const now = Date.now();

const ROSTER = [
  "Amalie Sørensen",
  "Mikkel Jensen",
  "Sofia Rossi",
  "Jonas Berg",
  "Freja Nielsen",
  "Rasmus Holm",
  "Elena Petrova",
  "Kasper Lund",
  "Maria Kowalski",
  "Emil Andersen",
  "Nina Haugen",
  "Tobias Krogh",
  "Laura Vestergaard",
  "Anders Bak",
  "Yusuf Demir",
  "Clara Møller",
];

/** Nordic letters are distinct characters, not accented Latin ones, so NFD
 *  alone leaves them behind. AAU spells them out the way its own addresses do. */
const TRANSLITERATE: Record<string, string> = {
  "æ": "ae", // ae
  "ø": "oe", // oe
  "å": "aa", // aa
  "ü": "u",
  "ö": "oe",
  "ä": "ae",
};

function emailFor(name: string): string {
  const slug = [...name.toLowerCase()]
    .map((ch) => TRANSLITERATE[ch] ?? ch)
    .join("")
    // Decompose the remaining accented Latin letters and drop the marks.
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z]+/g, ".")
    .replace(/^\.+|\.+$/g, "");
  return `${slug}@student.aau.dk`;
}

async function main() {
  runMigrations();

  const existing = db.select().from(students).all();
  if (existing.length > 0 && process.env.RESEED !== "1") {
    console.log(
      `Database already has ${existing.length} students. ` +
        `Set RESEED=1 to wipe and reseed.`,
    );
    return;
  }

  if (process.env.RESEED === "1") {
    console.log("RESEED=1 — clearing existing data");
    for (const table of [
      submissionFiles,
      submissions,
      deadlineExtensions,
      teamMembers,
      teams,
      assignments,
      students,
    ]) {
      db.delete(table).run();
    }
  }

  /* -- admin -------------------------------------------------------------- */
  const adminEmail = process.env.ADMIN_EMAIL ?? "admin@aau.dk";
  const adminPassword = process.env.ADMIN_PASSWORD ?? "changeme123";
  const hasAdmin = db.select().from(admins).all().length > 0;
  if (!hasAdmin) {
    db.insert(admins)
      .values({
        name: process.env.ADMIN_NAME ?? "Course responsible",
        email: adminEmail.toLowerCase(),
        passwordHash: bcrypt.hashSync(adminPassword, 12),
      })
      .run();
    console.log(`Admin created: ${adminEmail} / ${adminPassword}`);
  }

  /* -- roster ------------------------------------------------------------- */
  const studentRows = ROSTER.map((name) => ({ name, email: emailFor(name) }));
  db.insert(students).values(studentRows).run();
  const allStudents = db.select().from(students).all();
  console.log(`Seeded ${allStudents.length} students`);

  /* -- assignments -------------------------------------------------------- */
  const assignmentRows = [
    {
      title: "Week 1 — Exploratory data analysis",
      description:
        "Load the provided dataset, profile it, and document what you find.\n\nDeliver a ZIP with your notebook and a short PDF of your findings.",
      weekNumber: 1,
      mode: "team" as const,
      dueAt: now - 21 * DAY,
      publishedAt: now - 28 * DAY,
      acceptLate: true,
      requiresFiles: true,
      requiresVideo: false,
      allowedExtensions: "zip,pdf",
      maxFileSizeMb: 200,
    },
    {
      title: "Week 2 — Feature engineering",
      description:
        "Build a feature pipeline and justify each transformation.\n\nRecord a short Panopto walkthrough explaining your choices.",
      weekNumber: 2,
      mode: "team" as const,
      dueAt: now - 14 * DAY,
      publishedAt: now - 21 * DAY,
      acceptLate: true,
      requiresFiles: true,
      requiresVideo: true,
      allowedExtensions: "zip,pdf",
      maxFileSizeMb: 200,
    },
    {
      title: "Week 3 — Individual reflection",
      description:
        "A short individual note on your contribution and what you learned.\n\nThis one is delivered per person, not per group.",
      weekNumber: 3,
      mode: "solo" as const,
      dueAt: now - 7 * DAY,
      publishedAt: now - 14 * DAY,
      acceptLate: true,
      requiresFiles: true,
      requiresVideo: false,
      allowedExtensions: "pdf",
      maxFileSizeMb: 20,
    },
    {
      title: "Week 4 — Model training and evaluation",
      description:
        "Train at least two models, compare them honestly, and explain the trade-offs.\n\nInclude a Panopto recording where you walk through your code.",
      weekNumber: 4,
      mode: "team" as const,
      dueAt: now + 3 * DAY,
      publishedAt: now - 4 * DAY,
      acceptLate: true,
      requiresFiles: true,
      requiresVideo: true,
      allowedExtensions: "zip,pdf",
      maxFileSizeMb: 200,
    },
    {
      title: "Week 5 — Deployment (draft, not yet published)",
      description: "Package your model behind a small API.",
      weekNumber: 5,
      mode: "team" as const,
      dueAt: now + 10 * DAY,
      publishedAt: null,
      acceptLate: false,
      requiresFiles: true,
      requiresVideo: false,
      allowedExtensions: "zip",
      maxFileSizeMb: 200,
    },
  ];

  db.insert(assignments).values(assignmentRows).run();
  const allAssignments = db.select().from(assignments).all();
  console.log(`Seeded ${allAssignments.length} assignments`);

  /* -- teams: per assignment ------------------------------------------------
     Teams belong to an assignment now, so each published one gets its own set.
     Weeks 1-3 keep the same four groups of three, with four students left
     ungrouped on purpose. Week 4 shuffles them, because groups changing week to
     week is the whole reason this is per-assignment — and it makes the admin
     screens show something other than the same four rows four times.          */
  const groupNames = [
    "Group 1 — Churn Prediction",
    "Group 2 — Retail Forecasting",
    "Group 3 — Text Mining",
    "Group 4 — Recommender",
  ];

  /** teamIdsByAssignment[assignmentId][groupIndex] */
  const teamsByAssignment = new Map<number, number[]>();

  const makeTeams = (assignmentId: number, groups: (typeof allStudents)[]) => {
    const ids: number[] = [];
    groups.forEach((members, i) => {
      if (members.length === 0) return;
      const team = db
        .insert(teams)
        .values({
          assignmentId,
          name: groupNames[i] ?? `Group ${i + 1}`,
          accessToken: generateAccessToken(),
          shortCode: generateShortCode(),
        })
        .returning()
        .get();
      ids.push(team.id);
      db.insert(teamMembers)
        .values(
          members.map((s) => ({
            teamId: team.id,
            assignmentId,
            studentId: s.id,
          })),
        )
        .run();
    });
    teamsByAssignment.set(assignmentId, ids);
  };

  const inThrees = (list: typeof allStudents) => [
    list.slice(0, 3),
    list.slice(3, 6),
    list.slice(6, 9),
    list.slice(9, 12),
  ];

  const published = allAssignments.filter((a) => a.publishedAt !== null);
  for (const assignment of published) {
    // Week 4 regroups: rotate the roster so the groups genuinely differ.
    const order =
      assignment.weekNumber === 4
        ? [...allStudents.slice(4), ...allStudents.slice(0, 4)]
        : allStudents;
    makeTeams(assignment.id, inThrees(order));
  }

  console.log("Team links (one set per published assignment):");
  for (const assignment of published) {
    console.log(`  ${assignment.title}`);
    for (const id of teamsByAssignment.get(assignment.id) ?? []) {
      const team = db.select().from(teams).all().find((x) => x.id === id)!;
      console.log(`    ${team.shortCode}  ${team.name}`);
      console.log(`        http://localhost:3000/t/${team.accessToken}`);
    }
  }

  /* -- submissions: a realistic spread -------------------------------------
     Week 1: teams 1-3 delivered (one late), team 4 missing.
     Week 2: team 1 approved, team 2 needs rework, others missing.
     Week 3 (solo): scattered per-person deliveries.
     Week 4: still open, team 1 already in.                                  */

  const [w1, w2, w3, w4] = allAssignments;
  const membersOf = (teamId: number) =>
    db.select().from(teamMembers).all().filter((m) => m.teamId === teamId);

  const addSubmission = (opts: {
    assignmentId: number;
    teamId: number;
    studentId?: number | null;
    submittedById: number;
    daysAgo: number;
    isLate?: boolean;
    status?: "submitted" | "approved" | "rework";
    reviewComment?: string;
    videoUrl?: string;
    note?: string;
  }) => {
    const row = db
      .insert(submissions)
      .values({
        assignmentId: opts.assignmentId,
        teamId: opts.teamId,
        studentId: opts.studentId ?? null,
        submittedByStudentId: opts.submittedById,
        submittedAt: now - opts.daysAgo * DAY,
        isLate: opts.isLate ?? false,
        status: opts.status ?? "submitted",
        reviewComment: opts.reviewComment ?? null,
        reviewedAt: opts.reviewComment ? now - 2 * DAY : null,
        videoUrl: opts.videoUrl ?? null,
        videoShareConfirmed: Boolean(opts.videoUrl),
        note: opts.note ?? null,
      })
      .returning()
      .get();

    // A placeholder file record. The bytes are not on disk, which is fine for
    // building screens; a real upload writes both.
    db.insert(submissionFiles)
      .values({
        submissionId: row.id,
        originalName: "submission.zip",
        storedName: crypto.randomUUID(),
        sizeBytes: 1024 * 1024 * (2 + (row.id % 7)),
        mimeType: "application/zip",
      })
      .run();

    return row;
  };

  /** Group `i` of the teams belonging to `assignment`. */
  const t = (assignment: { id: number }, i: number) =>
    (teamsByAssignment.get(assignment.id) ?? [])[i];
  const firstMember = (teamId: number) => membersOf(teamId)[0].studentId;

  addSubmission({
    assignmentId: w1.id,
    teamId: t(w1, 0),
    submittedById: firstMember(t(w1, 0)),
    daysAgo: 22,
  });
  addSubmission({
    assignmentId: w1.id,
    teamId: t(w1, 1),
    submittedById: firstMember(t(w1, 1)),
    daysAgo: 20,
    isLate: true,
  });
  addSubmission({
    assignmentId: w1.id,
    teamId: t(w1, 2),
    submittedById: firstMember(t(w1, 2)),
    daysAgo: 23,
  });

  addSubmission({
    assignmentId: w2.id,
    teamId: t(w2, 0),
    submittedById: firstMember(t(w2, 0)),
    daysAgo: 15,
    status: "approved",
    reviewComment: "Clear pipeline and a good explanation of the scaling step.",
    videoUrl: "https://aaudk.cloud.panopto.eu/Panopto/Pages/Viewer.aspx?id=demo-1",
  });
  addSubmission({
    assignmentId: w2.id,
    teamId: t(w2, 1),
    submittedById: firstMember(t(w2, 1)),
    daysAgo: 15,
    status: "rework",
    reviewComment:
      "The video does not cover the feature selection step — please re-record that part and resubmit.",
    videoUrl: "https://aaudk.cloud.panopto.eu/Panopto/Pages/Viewer.aspx?id=demo-2",
  });

  // Solo week: half of the students grouped for week 3 delivered. Scoped to
  // that assignment's memberships — every assignment has its own now.
  const soloDeliverers = db
    .select()
    .from(teamMembers)
    .all()
    .filter((m) => m.assignmentId === w3.id)
    .filter((_, i) => i % 2 === 0);
  for (const m of soloDeliverers) {
    addSubmission({
      assignmentId: w3.id,
      teamId: m.teamId,
      studentId: m.studentId,
      submittedById: m.studentId,
      daysAgo: 8,
    });
  }

  addSubmission({
    assignmentId: w4.id,
    teamId: t(w4, 0),
    submittedById: firstMember(t(w4, 0)),
    daysAgo: 1,
    videoUrl: "https://aaudk.cloud.panopto.eu/Panopto/Pages/Viewer.aspx?id=demo-3",
    note: "Random forest slightly beat XGBoost — details in section 4.",
  });

  // One team got an extension on the open assignment.
  db.insert(deadlineExtensions)
    .values({
      assignmentId: w4.id,
      teamId: t(w4, 3),
      newDueAt: now + 7 * DAY,
      reason: "Two members ill during the week.",
    })
    .run();

  const counts = db.select().from(submissions).all().length;
  console.log(`Seeded ${counts} submissions`);
  console.log("\nDone. Sign in at http://localhost:3000/admin/login");
}

main()
  .then(() => sqlite.close())
  .catch((error) => {
    console.error(error);
    sqlite.close();
    process.exit(1);
  });
