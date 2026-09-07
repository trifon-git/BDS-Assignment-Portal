import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { ArrowLeft } from "lucide-react";

import { ForumThread } from "@/components/forum/forum-thread";
import { buttonVariants } from "@/components/ui/button";
import { db } from "@/db";
import { teams } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";
import { getTeamForum } from "@/lib/forum";
import { getTeamMembers } from "@/lib/team-access";

export const dynamic = "force-dynamic";

export const metadata = { title: "Team forum" };

/**
 * Read-only view of one team's board — same `ForumThread` component the team
 * itself sees, deleted messages included (soft delete exists so an admin can
 * still see what was removed, not so it vanishes for everyone but the class).
 */
export default async function TeamForumPage({
  params,
}: PageProps<"/admin/teams/[teamId]/forum">) {
  await requireAdmin();
  const { teamId } = await params;
  const id = Number(teamId);
  if (!Number.isInteger(id)) notFound();

  const team = await db.query.teams.findFirst({
    where: eq(teams.id, id),
    with: { assignment: true },
  });
  if (!team) notFound();

  const [members, forum] = await Promise.all([
    getTeamMembers(team.id),
    getTeamForum(team.id),
  ]);

  return (
    <>
      <Link
        href={`/admin/teams?assignment=${team.assignmentId}`}
        className={buttonVariants({ variant: "ghost", size: "lg" })}
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Teams
      </Link>

      <h1 className="mt-4 text-2xl font-semibold tracking-tight">
        {team.name} — forum
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {team.assignment.title} · read-only
      </p>

      <div className="mt-6">
        <ForumThread
          nodes={forum}
          token={team.accessToken}
          teamId={team.id}
          members={members}
          readOnly
        />
      </div>
    </>
  );
}
