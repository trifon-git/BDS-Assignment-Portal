import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import {
  AlertTriangle,
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  Download,
  Info,
  Link2,
  Video,
} from "lucide-react";

import { SiteShell } from "@/components/site-shell";
import { StatusBadge } from "@/components/status-badge";
import { SubmissionForm } from "@/components/submission-form";
import { buttonVariants } from "@/components/ui/button";
import { db } from "@/db";
import { assignments } from "@/db/schema";
import { getEffectiveDeadline } from "@/lib/dashboard";
import { deliveryState, formatRelative } from "@/lib/deadline";
import { formatDeadline } from "@/lib/format";
import { requirementSummary } from "@/lib/submit";
import { formatBytes } from "@/lib/storage";
import { getSubmission, getTeamByToken } from "@/lib/team-access";

export const dynamic = "force-dynamic";

export default async function AssignmentPage({
  params,
  searchParams,
}: PageProps<"/t/[token]/a/[id]">) {
  const { token, id } = await params;
  const query = await searchParams;

  const context = await getTeamByToken(token);
  if (!context) notFound();
  const { team, members } = context;

  const assignmentId = Number(id);
  const assignment = Number.isInteger(assignmentId)
    ? await db.query.assignments.findFirst({
        where: eq(assignments.id, assignmentId),
      })
    : undefined;

  // A draft is invisible to students even by direct URL. So is any assignment
  // this team was not formed for: a team belongs to one assignment, and its
  // link must not reach another week's brief.
  if (!assignment || !assignment.publishedAt) notFound();
  if (assignment.id !== team.assignmentId) notFound();

  const deadline = await getEffectiveDeadline(assignment, team.id);
  const isSolo = assignment.mode === "solo";

  // For a solo assignment the page shows one panel per member; for a team
  // assignment there is a single shared delivery.
  const rows = isSolo
    ? await Promise.all(
        members.map(async (student) => ({
          student,
          submission: await getSubmission(assignment.id, team.id, student.id),
        })),
      )
    : [
        {
          student: null,
          submission: await getSubmission(assignment.id, team.id, null),
        },
      ];

  const error = typeof query.error === "string" ? query.error : null;
  const skipped = typeof query.skipped === "string" ? query.skipped : null;
  const success = query.ok === "1";
  const wasLate = query.late === "1";

  return (
    <SiteShell subtitle={team.name}>
      <Link
        href={`/t/${token}`}
        className={buttonVariants({ variant: "ghost", size: "lg" })}
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        All assignments
      </Link>

      <div className="mt-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          {assignment.weekNumber != null ? (
            <span className="rounded bg-aau-50 px-1.5 py-0.5 text-xs font-medium text-aau-700">
              Week {assignment.weekNumber}
            </span>
          ) : null}
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-balance">
            {assignment.title}
          </h1>
        </div>
        <span className="rounded-full border px-3 py-1 text-sm font-medium">
          {isSolo ? "Individual delivery" : "Team delivery"}
        </span>
      </div>

      {/* -- status banners --------------------------------------------------- */}
      {success ? (
        <Banner tone={wasLate ? "late" : "ok"}>
          {wasLate
            ? "Delivered, but after the deadline. It is recorded as late."
            : "Delivered. You can replace it until the deadline."}
        </Banner>
      ) : null}
      {skipped ? (
        <Banner tone="late">Some files were not accepted: {skipped}</Banner>
      ) : null}
      {error ? <Banner tone="error">{error}</Banner> : null}

      {/* -- the brief -------------------------------------------------------- */}
      <div className="mt-6 rounded-lg border bg-card p-5">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          <span className="flex items-center gap-1.5">
            <CalendarClock
              className="size-4 text-muted-foreground"
              aria-hidden="true"
            />
            <span className="font-medium">
              {formatDeadline(deadline.effectiveDueAt)}
            </span>
            <span className="text-muted-foreground">
              ({formatRelative(deadline.msRemaining)})
            </span>
          </span>
          {deadline.extended ? (
            <span className="rounded bg-aau-50 px-2 py-0.5 text-xs font-medium text-aau-700">
              Your team has an extension
            </span>
          ) : null}
        </div>

        {assignment.description ? (
          <div className="mt-4 space-y-3 text-sm leading-relaxed whitespace-pre-line">
            {assignment.description}
          </div>
        ) : null}

        <p className="mt-4 flex items-start gap-2 rounded-md bg-muted p-3 text-sm">
          <Info
            className="mt-0.5 size-4 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
          <span>
            {requirementSummary(assignment)}
            {assignment.requiresFiles
              ? ` Up to ${assignment.maxFileSizeMb} MB per file.`
              : ""}
          </span>
        </p>

        {deadline.overdue && assignment.acceptLate ? (
          <p className="mt-3 flex items-start gap-2 rounded-md bg-status-late-bg p-3 text-sm text-status-late">
            <AlertTriangle
              className="mt-0.5 size-4 shrink-0"
              aria-hidden="true"
            />
            <span>
              <span className="font-medium">
                The deadline has passed, but delivery is still open.
              </span>{" "}
              You can hand in below — it will be recorded as late.
            </span>
          </p>
        ) : null}
      </div>

      {/* -- delivery panels --------------------------------------------------- */}
      <div className="mt-8 space-y-6">
        {rows.map((row) => {
          const state = deliveryState(row.submission ?? null, deadline);
          const key = row.student?.id ?? "team";

          return (
            <section
              key={key}
              className="rounded-lg border bg-card p-5"
              aria-label={
                row.student ? `Delivery for ${row.student.name}` : "Delivery"
              }
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="font-medium">
                  {row.student ? row.student.name : "Your team's delivery"}
                </h2>
                <StatusBadge state={state} />
              </div>

              {row.submission ? (
                <div className="mt-4 space-y-3 text-sm">
                  <p className="text-muted-foreground">
                    Delivered {formatDeadline(row.submission.submittedAt)}
                    {row.submission.isLate ? " — recorded as late" : ""}
                  </p>

                  {row.submission.files.length > 0 ? (
                    <ul className="divide-y rounded-md border">
                      {row.submission.files.map((file) => (
                        <li
                          key={file.id}
                          className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
                        >
                          <span className="min-w-0 truncate font-mono text-xs">
                            {file.originalName}
                          </span>
                          <span className="flex items-center gap-3">
                            <span className="text-xs text-muted-foreground">
                              {formatBytes(file.sizeBytes)}
                            </span>
                            <a
                              href={`/api/files/${file.storedName}?t=${token}`}
                              className="inline-flex items-center gap-1 text-xs font-medium text-aau-600 hover:underline"
                            >
                              <Download className="size-3.5" aria-hidden="true" />
                              Download
                            </a>
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : null}

                  {row.submission.videoUrl ? (
                    <p className="flex items-center gap-2">
                      <Video
                        className="size-4 shrink-0 text-muted-foreground"
                        aria-hidden="true"
                      />
                      <a
                        href={row.submission.videoUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="min-w-0 truncate text-aau-600 hover:underline"
                      >
                        {row.submission.videoUrl}
                      </a>
                    </p>
                  ) : null}

                  {row.submission.linkUrl ? (
                    <p className="flex items-center gap-2">
                      <Link2
                        className="size-4 shrink-0 text-muted-foreground"
                        aria-hidden="true"
                      />
                      <a
                        href={row.submission.linkUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="min-w-0 truncate text-aau-600 hover:underline"
                      >
                        {row.submission.linkUrl}
                      </a>
                    </p>
                  ) : null}

                  {row.submission.reviewComment ? (
                    <p
                      className={
                        row.submission.status === "rework"
                          ? "rounded-md bg-status-rework-bg p-3 text-status-rework"
                          : "rounded-md bg-status-delivered-bg p-3 text-status-delivered"
                      }
                    >
                      <span className="font-medium">Feedback:</span>{" "}
                      {row.submission.reviewComment}
                    </p>
                  ) : null}
                </div>
              ) : null}

              {deadline.canSubmit ? (
                <SubmissionForm
                  className="mt-5"
                  action={`/api/submit/${token}/${assignment.id}`}
                  members={members}
                  studentId={row.student?.id ?? null}
                  requiresFiles={assignment.requiresFiles}
                  requiresVideo={assignment.requiresVideo}
                  allowedExtensions={assignment.allowedExtensions}
                  maxFileSizeMb={assignment.maxFileSizeMb}
                  hasExisting={Boolean(row.submission)}
                  existingVideoUrl={row.submission?.videoUrl ?? ""}
                  existingLinkUrl={row.submission?.linkUrl ?? ""}
                  existingNote={row.submission?.note ?? ""}
                  willBeLate={deadline.wouldBeLate}
                />
              ) : (
                <p className="mt-5 flex items-center gap-2 rounded-md bg-muted p-3 text-sm text-muted-foreground">
                  <AlertTriangle className="size-4" aria-hidden="true" />
                  The deadline has passed and this assignment does not accept
                  late deliveries. Contact the course responsible.
                </p>
              )}
            </section>
          );
        })}
      </div>
    </SiteShell>
  );
}

function Banner({
  tone,
  children,
}: {
  tone: "ok" | "late" | "error";
  children: React.ReactNode;
}) {
  const styles = {
    ok: "bg-status-delivered-bg text-status-delivered",
    late: "bg-status-late-bg text-status-late",
    error: "bg-status-missing-bg text-status-missing",
  }[tone];

  const Icon = tone === "ok" ? CheckCircle2 : AlertTriangle;

  return (
    <p
      role="status"
      className={`mt-6 flex items-start gap-2 rounded-lg p-4 text-sm font-medium ${styles}`}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}
