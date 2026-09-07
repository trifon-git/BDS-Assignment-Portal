import { redirect } from "next/navigation";

import { AssignmentPicker } from "@/components/assignment-picker";
import { CopyTeamsForm } from "@/components/copy-teams-form";
import { SendLinks } from "@/components/send-links";
import { ShuffleForm } from "@/components/shuffle-form";
import { TeamBoard } from "@/components/team-board";
import { NewTeamForm } from "@/components/new-team-form";
import {
  getRosterWithTeams,
  getTeamsWithMembers,
  listAssignments,
} from "@/lib/admin-data";
import { requireAdmin } from "@/lib/auth";
import {
  copyTeamsFromAssignment,
  createTeamAsAdmin,
  shuffleTeamsAction,
} from "@/lib/admin-actions";
import { countProtectedTeams } from "@/lib/teams";
import { getForumCounts } from "@/lib/forum";

export const dynamic = "force-dynamic";

export const metadata = { title: "Teams" };

/**
 * Teams, for one assignment at a time.
 *
 * Teams belong to an assignment, so this screen always has to answer "which
 * one" before it can show anything. It defaults to the next assignment still
 * open, because that is the one whose groups are actually in flux.
 */
export default async function TeamsPage({
  searchParams,
}: PageProps<"/admin/teams">) {
  await requireAdmin();

  const query = await searchParams;
  const { assignments, now } = await listAssignments();

  if (assignments.length === 0) {
    return (
      <>
        <h1 className="text-2xl font-semibold tracking-tight">Teams</h1>
        <p className="mt-8 rounded-lg border border-dashed p-8 text-center text-muted-foreground">
          Teams belong to an assignment, so there is nothing to group yet.
          Create an assignment first.
        </p>
      </>
    );
  }

  const requested = Number(query.assignment);
  const selected =
    assignments.find((a) => a.id === requested) ??
    // The nearest assignment whose deadline has not passed, else the newest.
    assignments.filter((a) => a.dueAt >= now).sort((a, b) => a.dueAt - b.dueAt)[0] ??
    assignments[assignments.length - 1];

  if (!Number.isInteger(requested) || requested !== selected.id) {
    redirect(`/admin/teams?assignment=${selected.id}`);
  }

  const [teams, roster] = await Promise.all([
    getTeamsWithMembers(selected.id),
    getRosterWithTeams(selected.id),
  ]);
  const unassigned = roster
    .filter((r) => r.team === null)
    .map((r) => r.student);

  const shuffled = query.shuffled === "1";
  const protectedTeamCount = countProtectedTeams(selected.id);
  const forumCountsByTeam = await getForumCounts(teams.map((t) => t.team.id));
  const forumCounts = Object.fromEntries(forumCountsByTeam);

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Teams</h1>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
        Groups are formed per assignment, so a student can work with different
        people from one week to the next. Each team has its own link and short
        code, and that code only opens the assignment it belongs to.
      </p>

      <AssignmentPicker
        assignments={assignments}
        selectedId={selected.id}
        basePath="/admin/teams"
        className="mt-6"
      />

      <p className="mt-4 max-w-2xl text-sm text-muted-foreground">
        Drag a member onto another team to move them, or onto the panel below to
        take them off a team. The <em>Add a student</em> menu on each card does
        the same without a mouse.
      </p>

      {shuffled ? (
        <p className="mt-4 rounded-md bg-status-delivered-bg px-3 py-2 text-sm text-status-delivered">
          {Number(query.created ?? 0)} group
          {Number(query.created ?? 0) === 1 ? "" : "s"} created,{" "}
          {Number(query.placed ?? 0)} student
          {Number(query.placed ?? 0) === 1 ? "" : "s"} placed.
          {Number(query.deleted ?? 0) > 0
            ? ` ${query.deleted} old group${
                Number(query.deleted) === 1 ? "" : "s"
              } removed.`
            : ""}
          {Number(query.protectedTeams ?? 0) > 0
            ? ` ${query.protectedTeams} group${
                Number(query.protectedTeams) === 1 ? "" : "s"
              } kept — already has a submission.`
            : ""}
        </p>
      ) : null}

      <div className="mt-6 flex flex-wrap items-start gap-3">
        <ShuffleForm
          action={shuffleTeamsAction}
          assignmentId={selected.id}
          hasTeams={teams.length > 0}
          protectedTeamCount={protectedTeamCount}
        />
        <NewTeamForm
          action={createTeamAsAdmin}
          roster={roster}
          assignmentId={selected.id}
        />
        <CopyTeamsForm
          action={copyTeamsFromAssignment}
          assignments={assignments.filter((a) => a.id !== selected.id)}
          assignmentId={selected.id}
          hasTeams={teams.length > 0}
        />
        <SendLinks teams={teams} />
      </div>

      <TeamBoard
        teams={teams}
        unassigned={unassigned}
        roster={roster}
        assignmentId={selected.id}
        forumCounts={forumCounts}
      />
    </>
  );
}
