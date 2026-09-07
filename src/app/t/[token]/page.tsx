import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarClock, FileText, Users, Video } from "lucide-react";

import { ForumThread } from "@/components/forum/forum-thread";
import { SiteShell } from "@/components/site-shell";
import { StatusBadge } from "@/components/status-badge";
import { TeamLinkCard } from "@/components/team-link-card";
import { buttonVariants } from "@/components/ui/button";
import { getTeamDashboard, type AssignmentCard } from "@/lib/dashboard";
import { formatDeadline } from "@/lib/format";
import { formatRelative } from "@/lib/deadline";
import { deleteMessage, editMessage, postMessage } from "@/lib/forum-actions";
import { getTeamForum } from "@/lib/forum";
import { getTeamByToken } from "@/lib/team-access";
import { getSetting } from "@/lib/settings";

export const dynamic = "force-dynamic";

export default async function TeamDashboard({
  params,
  searchParams,
}: PageProps<"/t/[token]">) {
  const { token } = await params;
  const query = await searchParams;
  const forumError = typeof query.forumError === "string" ? query.forumError : null;
  const context = await getTeamByToken(token);
  if (!context) notFound();

  const { team, assignment, members } = context;
  const [cards, semester, supportEmail, forum] = await Promise.all([
    getTeamDashboard(team.id, members, assignment.id),
    getSetting("semester_name"),
    getSetting("support_email"),
    getTeamForum(team.id),
  ]);

  return (
    <SiteShell subtitle={semester}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-medium tracking-wide text-aau-700 uppercase">
            {assignment.title}
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            {team.name}
          </h1>
          <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
            <Users className="size-4" aria-hidden="true" />
            {members.length > 0
              ? members.map((m) => m.name).join(", ")
              : "No members yet"}
          </p>
        </div>
      </div>

      <TeamLinkCard
        shortCode={team.shortCode}
        supportEmail={supportEmail}
        className="mt-6"
      />

      {cards.length === 0 ? (
        <p className="mt-10 rounded-lg border border-dashed p-8 text-center text-muted-foreground">
          This assignment is not published yet. The page will come to life when
          it is.
        </p>
      ) : (
        <Section
          title="This assignment"
          empty="Nothing to show."
          cards={cards}
          token={token}
        />
      )}

      <section id="forum" className="mt-10">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">
            Team chat
          </h2>
          <a href="#forum" className="text-xs text-muted-foreground underline">
            Refresh
          </a>
        </div>
        {forumError ? (
          <p className="mt-3 rounded-md bg-status-missing-bg px-3 py-2 text-sm text-status-missing">
            {forumError}
          </p>
        ) : null}
        <div className="mt-3">
          <ForumThread
            nodes={forum}
            token={token}
            teamId={team.id}
            members={members}
            postAction={postMessage}
            editAction={editMessage}
            deleteAction={deleteMessage}
          />
        </div>
      </section>

      <p className="mt-8 rounded-lg border bg-muted/40 p-4 text-sm text-muted-foreground">
        This team, and this code, are for{" "}
        <strong className="font-medium text-foreground">
          {assignment.title}
        </strong>{" "}
        only. For another assignment you group up again — and get a different
        code — from{" "}
        <Link
          href="/"
          className="font-medium text-aau-700 underline underline-offset-2"
        >
          the front page
        </Link>
        .
      </p>
    </SiteShell>
  );
}

function Section({
  title,
  empty,
  cards,
  token,
}: {
  title: string;
  empty: string;
  cards: AssignmentCard[];
  token: string;
}) {
  return (
    <section className="mt-10">
      <h2 className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">
        {title}
      </h2>
      {cards.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="mt-3 space-y-3">
          {cards.map((card) => (
            <li key={card.assignment.id}>
              <Card card={card} token={token} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Card({ card, token }: { card: AssignmentCard; token: string }) {
  const { assignment, deadline, state, memberRows } = card;
  const href = `/t/${token}/a/${assignment.id}`;

  return (
    <div className="rounded-lg border bg-card p-4 transition-colors hover:border-aau-300 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {assignment.weekNumber != null ? (
              <span className="rounded bg-aau-50 px-1.5 py-0.5 text-xs font-medium text-aau-700">
                Week {assignment.weekNumber}
              </span>
            ) : null}
            <span className="text-xs font-medium text-muted-foreground">
              {assignment.mode === "team" ? "Team delivery" : "Individual"}
            </span>
          </div>
          <h3 className="mt-1.5 font-medium text-balance">
            <Link href={href} className="hover:underline">
              {assignment.title}
            </Link>
          </h3>
        </div>
        <StatusBadge state={state} />
      </div>

      <dl className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <CalendarClock className="size-4" aria-hidden="true" />
          <dt className="sr-only">Deadline</dt>
          <dd>
            {formatDeadline(deadline.effectiveDueAt)}
            <span className="ml-1.5 text-xs">
              ({formatRelative(deadline.msRemaining)})
            </span>
            {deadline.extended ? (
              <span className="ml-1.5 rounded bg-aau-50 px-1.5 py-0.5 text-xs font-medium text-aau-700">
                extended
              </span>
            ) : null}
          </dd>
        </div>

        {assignment.requiresFiles ? (
          <div className="flex items-center gap-1.5">
            <FileText className="size-4" aria-hidden="true" />
            <dt className="sr-only">Files</dt>
            <dd>{assignment.allowedExtensions.replace(/,/g, ", ")}</dd>
          </div>
        ) : null}

        {assignment.requiresVideo ? (
          <div className="flex items-center gap-1.5">
            <Video className="size-4" aria-hidden="true" />
            <dt className="sr-only">Video</dt>
            <dd>Video required</dd>
          </div>
        ) : null}
      </dl>

      {/* A solo assignment shows every member's own status, which is the whole
          reason one team link is enough to cover individual work. */}
      {assignment.mode === "solo" && memberRows.length > 0 ? (
        <ul className="mt-4 divide-y rounded-md border">
          {memberRows.map((row) => (
            <li
              key={row.student.id}
              className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm"
            >
              <span>{row.student.name}</span>
              <StatusBadge state={row.state} size="sm" />
            </li>
          ))}
        </ul>
      ) : null}

      {card.submission?.status === "rework" && card.submission.reviewComment ? (
        <p className="mt-4 rounded-md bg-status-rework-bg p-3 text-sm text-status-rework">
          <span className="font-medium">Feedback:</span>{" "}
          {card.submission.reviewComment}
        </p>
      ) : null}

      <div className="mt-4">
        <Link
          href={href}
          className={buttonVariants({
            variant: deadline.canSubmit ? "default" : "outline",
            size: "lg",
          })}
        >
          {card.submission || memberRows.some((r) => r.submission)
            ? "View or replace"
            : deadline.canSubmit
              ? "Deliver"
              : "View"}
        </Link>
      </div>
    </div>
  );
}
