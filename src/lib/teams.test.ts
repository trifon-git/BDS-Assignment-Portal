import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Copying teams between assignments, against a real SQLite database.
 *
 * The other suites test pure functions, but what this has to get right lives in
 * the schema rather than the TypeScript: unique access codes, and the unique
 * index on (assignment_id, student_id) that makes "one team per student per
 * assignment" true.
 *
 * DATA_DIR is set before anything imports @/db. The lazy connection is what
 * makes that work — importing the module no longer opens a database, so the
 * temporary directory below is the one that ends up being used.
 */
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aau-teams-test-"));
process.env.DATA_DIR = dir;

let copyTeams: typeof import("./teams").copyTeams;
let shuffleTeams: typeof import("./teams").shuffleTeams;
let db: typeof import("@/db").db;
let schema: typeof import("@/db/schema");

let studentIds: number[];
let week1: number;
let week2: number;

beforeAll(async () => {
  const dbModule = await import("@/db");
  schema = await import("@/db/schema");
  ({ copyTeams, shuffleTeams } = await import("./teams"));
  db = dbModule.db;
  dbModule.runMigrations();

  studentIds = [1, 2, 3, 4, 5, 6].map(
    (n) =>
      db
        .insert(schema.students)
        .values({ name: `Student ${n}`, email: `s${n}@student.aau.dk` })
        .returning()
        .get().id,
  );

  const assignment = (title: string) =>
    db
      .insert(schema.assignments)
      .values({ title, dueAt: Date.now() + 86_400_000 })
      .returning()
      .get().id;

  week1 = assignment("Week 1");
  week2 = assignment("Week 2");

  // Two groups of two on week 1. Students 5 and 6 are deliberately ungrouped.
  [studentIds.slice(0, 2), studentIds.slice(2, 4)].forEach((group, i) => {
    const team = db
      .insert(schema.teams)
      .values({
        assignmentId: week1,
        name: `Group ${i + 1}`,
        accessToken: `token-${i + 1}`,
        shortCode: `BDS-000${i + 1}`,
      })
      .returning()
      .get();
    db.insert(schema.teamMembers)
      .values(
        group.map((studentId) => ({
          teamId: team.id,
          assignmentId: week1,
          studentId,
        })),
      )
      .run();
  });
});

const teamsFor = (assignmentId: number) =>
  db.select().from(schema.teams).all().filter((t) => t.assignmentId === assignmentId);

const membersFor = (assignmentId: number) =>
  db
    .select()
    .from(schema.teamMembers)
    .all()
    .filter((m) => m.assignmentId === assignmentId);

describe("copyTeams", () => {
  it("copies every group across", () => {
    expect(copyTeams(week1, week2)).toBe(2);
    expect(teamsFor(week2)).toHaveLength(2);
    expect(membersFor(week2)).toHaveLength(4);
  });

  it("keeps the group names", () => {
    expect(
      teamsFor(week2)
        .map((t) => t.name)
        .sort(),
    ).toEqual(["Group 1", "Group 2"]);
  });

  it("mints fresh links and codes rather than reusing them", () => {
    const source = teamsFor(week1);
    for (const copy of teamsFor(week2)) {
      expect(source.some((s) => s.accessToken === copy.accessToken)).toBe(false);
      expect(source.some((s) => s.shortCode === copy.shortCode)).toBe(false);
    }
  });

  it("puts the same people together", () => {
    const group1 = teamsFor(week2).find((t) => t.name === "Group 1")!;
    expect(
      membersFor(week2)
        .filter((m) => m.teamId === group1.id)
        .map((m) => m.studentId)
        .sort(),
    ).toEqual([studentIds[0], studentIds[1]]);
  });

  it("is safe to run twice — nobody is duplicated", () => {
    expect(copyTeams(week1, week2)).toBe(0);
    expect(teamsFor(week2)).toHaveLength(2);
    expect(membersFor(week2)).toHaveLength(4);
  });

  it("leaves a student who has already regrouped where they are", () => {
    // Move student 1 onto their own team for week 2, then copy again. The
    // group they came from in week 1 must not drag them back.
    const moved = db
      .insert(schema.teams)
      .values({
        assignmentId: week2,
        name: "Regrouped",
        accessToken: "token-regrouped",
        shortCode: "BDS-RG01",
      })
      .returning()
      .get();

    const membership = membersFor(week2).find(
      (m) => m.studentId === studentIds[0],
    )!;
    db.update(schema.teamMembers)
      .set({ teamId: moved.id })
      .where(eq(schema.teamMembers.id, membership.id))
      .run();

    expect(copyTeams(week1, week2)).toBe(0);
    expect(
      membersFor(week2).find((m) => m.studentId === studentIds[0])!.teamId,
    ).toBe(moved.id);
  });

  it("refuses to copy an assignment onto itself", () => {
    expect(copyTeams(week1, week1)).toBe(0);
  });
});

describe("shuffleTeams", () => {
  let shuffleAssignment: number;

  beforeAll(() => {
    for (let i = 0; i < 10; i++) {
      db.insert(schema.students)
        .values({
          name: `Shuffle Student ${i}`,
          email: `shuffle${i}@student.aau.dk`,
        })
        .run();
    }

    shuffleAssignment = db
      .insert(schema.assignments)
      .values({ title: "Shuffle week", dueAt: Date.now() + 86_400_000 })
      .returning()
      .get().id;
  });

  const teamsFor = (assignmentId: number) =>
    db
      .select()
      .from(schema.teams)
      .all()
      .filter((t) => t.assignmentId === assignmentId);

  const membersFor = (assignmentId: number) =>
    db
      .select()
      .from(schema.teamMembers)
      .all()
      .filter((m) => m.assignmentId === assignmentId);

  it("groups everyone into teams of 3-4", () => {
    // "fill" pulls from the whole active roster, not just the students
    // created in this block — so this also legitimately sweeps in the
    // ungrouped-for-this-assignment students left over by the copyTeams
    // tests above. That is correct: fill mode groups anyone active who has
    // no team for *this* assignment yet, regardless of other assignments.
    const result = shuffleTeams(shuffleAssignment, { seed: 1 });
    expect(result.placed).toBeGreaterThanOrEqual(10);
    expect(result.created).toBeGreaterThan(0);

    const members = membersFor(shuffleAssignment);
    expect(members.length).toBe(result.placed);
    expect(new Set(members.map((m) => m.studentId)).size).toBe(result.placed);

    const sizeByTeam = new Map<number, number>();
    for (const m of members) {
      sizeByTeam.set(m.teamId, (sizeByTeam.get(m.teamId) ?? 0) + 1);
    }
    for (const size of sizeByTeam.values()) {
      expect(size).toBeGreaterThanOrEqual(3);
      expect(size).toBeLessThanOrEqual(4);
    }
  });

  it("fill mode is idempotent — running it again places nobody new", () => {
    const before = membersFor(shuffleAssignment).length;
    const result = shuffleTeams(shuffleAssignment, { mode: "fill", seed: 2 });
    expect(result.placed).toBe(0);
    expect(result.created).toBe(0);
    expect(membersFor(shuffleAssignment)).toHaveLength(before);
  });

  it("reshuffle protects a team that already has a submission", () => {
    const teamsBefore = teamsFor(shuffleAssignment);
    const protectedTeam = teamsBefore[0];

    db.insert(schema.submissions)
      .values({
        assignmentId: shuffleAssignment,
        teamId: protectedTeam.id,
        submittedAt: Date.now(),
      })
      .run();

    const protectedMemberIds = membersFor(shuffleAssignment)
      .filter((m) => m.teamId === protectedTeam.id)
      .map((m) => m.studentId);

    const result = shuffleTeams(shuffleAssignment, {
      mode: "reshuffle",
      seed: 3,
    });

    expect(result.protectedTeams).toBe(1);

    // The protected team must still exist, unchanged, with the same members.
    expect(teamsFor(shuffleAssignment).some((t) => t.id === protectedTeam.id)).toBe(
      true,
    );
    const stillTogether = membersFor(shuffleAssignment)
      .filter((m) => m.teamId === protectedTeam.id)
      .map((m) => m.studentId)
      .sort();
    expect(stillTogether).toEqual([...protectedMemberIds].sort());

    // Every other team was deleted and its members re-cut.
    const otherTeams = teamsFor(shuffleAssignment).filter(
      (t) => t.id !== protectedTeam.id,
    );
    for (const t of otherTeams) {
      expect(teamsBefore.some((b) => b.id === t.id)).toBe(false);
    }
  });

  it("never deletes a protected team's submission", () => {
    const submissionsForAssignment = db
      .select()
      .from(schema.submissions)
      .all()
      .filter((s) => s.assignmentId === shuffleAssignment);
    expect(submissionsForAssignment).toHaveLength(1);
  });
});
