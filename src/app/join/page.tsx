import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, CalendarClock } from "lucide-react";

import { SiteShell } from "@/components/site-shell";
import { JoinForm } from "@/components/join-form";
import { buttonVariants } from "@/components/ui/button";
import { db } from "@/db";
import { assignments, teamMembers, teams } from "@/db/schema";
import { recordAudit } from "@/lib/auth";
import { formatDeadline } from "@/lib/format";
import { generateAccessToken, generateShortCode } from "@/lib/ids";
import { getSetting } from "@/lib/settings";
import { getOpenAssignments, getUnassignedStudents } from "@/lib/team-access";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

/**
 * Form a team for one assignment.
 *
 * Teams belong to an assignment, so this page cannot do anything until it knows
 * which one. Without `?assignment=` it asks; with it, it offers the students
 * who are not yet grouped *for that assignment* — someone settled into a team
 * for week 4 is still free to be picked for week 5.
 */
export default async function JoinPage({ searchParams }: PageProps<"/join">) {
  const query = await searchParams;
  const error = typeof query.error === "string" ? query.error : null;
  const requested = Number(query.assignment);
  const semester = await getSetting("semester_name");

  /* -- no assignment chosen yet: ask which one --------------------------- */
  if (!Number.isInteger(requested)) {
    const open = await getOpenAssignments();
    return (
      <SiteShell subtitle={semester}>
        <div className="mx-auto max-w-xl">
          <Link
            href="/"
            className={buttonVariants({ variant: "ghost", size: "lg" })}
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            Back
          </Link>

          <h1 className="mt-4 text-2xl font-semibold tracking-tight">
            Which assignment is the team for?
          </h1>
          <p className="mt-3 text-muted-foreground">
            Teams are formed per assignment, so you can work with different
            people from one week to the next. Pick the assignment you are
            grouping up for.
          </p>

          {open.length === 0 ? (
            <p className="mt-8 rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              Nothing has been published yet. This page will fill up as the
              semester goes on.
            </p>
          ) : (
            <ul className="mt-6 space-y-2">
              {open.map((assignment) => (
                <li key={assignment.id}>
                  <Link
                    href={`/join?assignment=${assignment.id}`}
                    className="flex items-center justify-between gap-4 rounded-lg border bg-card p-4 hover:border-aau-400 hover:bg-aau-50/50"
                  >
                    <span className="min-w-0">
                      <span className="block font-medium">
                        {assignment.title}
                      </span>
                      <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                        <CalendarClock className="size-3.5" aria-hidden="true" />
                        {formatDeadline(assignment.dueAt)}
                      </span>
                    </span>
                    <span className="shrink-0 text-sm text-aau-700">
                      Form a team →
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </SiteShell>
    );
  }

  const assignment = await db.query.assignments.findFirst({
    where: eq(assignments.id, requested),
  });
  if (!assignment || !assignment.publishedAt) notFound();

  const available = await getUnassignedStudents(assignment.id);

  /**
   * Create a team for this assignment from names picked off the roster.
   *
   * Everything is re-checked here rather than trusted from the form: the page
   * offers only ungrouped students, but this action is reachable by direct
   * POST, and the unique index on (assignment_id, student_id) is the final word
   * either way.
   */
  async function createTeam(formData: FormData) {
    "use server";

    const assignmentId = Number(formData.get("assignmentId"));
    if (!Number.isInteger(assignmentId)) redirect("/join");

    const back = (message: string) =>
      redirect(
        `/join?assignment=${assignmentId}&error=${encodeURIComponent(message)}`,
      );

    const name = String(formData.get("name") ?? "").trim();
    const ids = formData
      .getAll("members")
      .map((v) => Number(v))
      .filter((n) => Number.isInteger(n));

    if (!name) back("Give your team a name.");
    if (ids.length === 0) back("Choose at least one member.");

    const stillFree = new Set(
      (await getUnassignedStudents(assignmentId)).map((s) => s.id),
    );
    if (ids.some((id) => !stillFree.has(id))) {
      back(
        "Someone you picked has just joined another team for this assignment. Check the list and try again.",
      );
    }

    // Retry on the astronomically unlikely short-code collision rather than
    // showing a student a unique-constraint error.
    let token = "";
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        token = db.transaction((tx) => {
          const accessToken = generateAccessToken();
          const team = tx
            .insert(teams)
            .values({
              assignmentId,
              name,
              accessToken,
              shortCode: generateShortCode(),
            })
            .returning()
            .get();

          tx.insert(teamMembers)
            .values(
              ids.map((studentId) => ({
                teamId: team.id,
                assignmentId,
                studentId,
              })),
            )
            .run();

          return accessToken;
        });
        break;
      } catch (e) {
        if (attempt === 4) throw e;
      }
    }

    await recordAudit({
      action: "team.created",
      actorName: "student (self-service)",
      detail: `${name} — ${ids.length} member(s), assignment ${assignmentId}`,
    });

    redirect(`/t/${token}?new=1`);
  }

  return (
    <SiteShell subtitle={semester}>
      <div className="mx-auto max-w-xl">
        <Link
          href="/join"
          className={buttonVariants({ variant: "ghost", size: "lg" })}
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Different assignment
        </Link>

        <h1 className="mt-4 text-2xl font-semibold tracking-tight">
          Create a team for {assignment.title}
        </h1>
        <p className="mt-3 text-muted-foreground">
          Pick yourself and your group members from the class list. You will get
          a link and a code to share with them — that is what you use to deliver
          this assignment.
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          This team is for this assignment only. Next week you can group up
          differently, and you will get a new code for it.
        </p>

        {error ? (
          <p
            role="alert"
            className="mt-6 rounded-lg bg-status-missing-bg p-4 text-sm font-medium text-status-missing"
          >
            {error}
          </p>
        ) : null}

        {available.length === 0 ? (
          <p className="mt-8 rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            Everyone on the class list is already in a team for this assignment.
            If you think that is wrong, contact the course responsible.
          </p>
        ) : (
          <JoinForm
            action={createTeam}
            students={available}
            assignmentId={assignment.id}
          />
        )}
      </div>
    </SiteShell>
  );
}
