import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { ArrowLeft, Download, Pencil, Video } from "lucide-react";

import { ChaseList } from "@/components/chase-list";
import { ExtensionControl } from "@/components/extension-control";
import { ReviewControls } from "@/components/review-controls";
import { StatusBadge } from "@/components/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { db } from "@/db";
import { assignments } from "@/db/schema";
import { getDeliveryMatrix } from "@/lib/admin-data";
import { requireAdmin } from "@/lib/auth";
import { formatDeadline } from "@/lib/format";
import { getSetting } from "@/lib/settings";
import { formatBytes } from "@/lib/storage";

export const dynamic = "force-dynamic";

export default async function DeliveryMatrixPage({
  params,
  searchParams,
}: PageProps<"/admin/assignments/[id]">) {
  await requireAdmin();
  const { id } = await params;
  const query = await searchParams;

  const assignment = await db.query.assignments.findFirst({
    where: eq(assignments.id, Number(id)),
  });
  if (!assignment) notFound();

  const matrix = await getDeliveryMatrix(assignment);
  const courseCode = await getSetting("course_code");
  const onlyOutstanding = query.filter === "outstanding";
  const rows = onlyOutstanding
    ? matrix.rows.filter((r) => r.outstanding)
    : matrix.rows;

  const chaseEmails = [
    ...new Set(matrix.rows.filter((r) => r.outstanding).flatMap((r) => r.chaseEmails)),
  ];

  return (
    <>
      <Link
        href="/admin/assignments"
        className={buttonVariants({ variant: "ghost", size: "lg" })}
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Assignments
      </Link>

      <div className="mt-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {assignment.weekNumber != null ? (
              <span className="rounded bg-aau-50 px-1.5 py-0.5 text-xs font-medium text-aau-700">
                Week {assignment.weekNumber}
              </span>
            ) : null}
            {!assignment.publishedAt ? (
              <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
                Draft — not visible to students
              </span>
            ) : null}
          </div>
          <h1 className="mt-1.5 text-2xl font-semibold tracking-tight text-balance">
            {assignment.title}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Due {formatDeadline(assignment.dueAt)} ·{" "}
            {assignment.mode === "team" ? "team delivery" : "individual delivery"}
            {assignment.requiresVideo ? " · video required" : ""}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Link
            href={`/admin/assignments/${assignment.id}/edit`}
            className={buttonVariants({ variant: "outline", size: "lg" })}
          >
            <Pencil className="size-4" aria-hidden="true" />
            Edit
          </Link>
          <a
            href={`/api/admin/assignments/${assignment.id}/download`}
            className={buttonVariants({ size: "lg" })}
          >
            <Download className="size-4" aria-hidden="true" />
            Download all
          </a>
        </div>
      </div>

      {/* -- counts ---------------------------------------------------------- */}
      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <Stat label="Delivered" value={`${matrix.delivered}/${matrix.total}`} />
        <Stat label="Outstanding" value={matrix.outstanding} />
        <Stat label="Late" value={matrix.late} />
      </div>

      {chaseEmails.length > 0 ? (
        <ChaseList emails={chaseEmails} className="mt-6" />
      ) : null}

      <div className="mt-6 flex flex-wrap items-center gap-2">
        <Link
          href={`/admin/assignments/${assignment.id}`}
          className={buttonVariants({
            variant: onlyOutstanding ? "outline" : "secondary",
            size: "sm",
          })}
        >
          All ({matrix.total})
        </Link>
        <Link
          href={`/admin/assignments/${assignment.id}?filter=outstanding`}
          className={buttonVariants({
            variant: onlyOutstanding ? "secondary" : "outline",
            size: "sm",
          })}
        >
          Outstanding ({matrix.outstanding})
        </Link>
      </div>

      {/* -- the matrix ------------------------------------------------------- */}
      {rows.length === 0 ? (
        <p className="mt-6 rounded-lg border border-dashed p-8 text-center text-muted-foreground">
          {onlyOutstanding
            ? "Everyone has delivered."
            : "No teams yet — create one under Teams."}
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
          {rows.map((row) => (
            <li
              key={row.key}
              className="rounded-lg border bg-card p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium">
                    {row.student ? row.student.name : row.team.name}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {row.student
                      ? `${row.student.email} · ${row.team.name}`
                      : row.members.map((m) => m.name).join(", ") ||
                        "No members"}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {row.extended ? (
                    <span className="rounded bg-aau-50 px-2 py-0.5 text-xs font-medium text-aau-700">
                      extended to {formatDeadline(row.effectiveDueAt)}
                    </span>
                  ) : null}
                  <StatusBadge state={row.state} />
                </div>
              </div>

              {row.submission ? (
                <div className="mt-4 space-y-3 border-t pt-4 text-sm">
                  <p className="text-muted-foreground">
                    Delivered {formatDeadline(row.submission.submittedAt)}
                    {row.submittedByName ? ` by ${row.submittedByName}` : ""}
                    {row.submission.isLate ? " — late" : ""}
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
                              href={`/api/files/${file.storedName}`}
                              className="text-xs font-medium text-aau-600 hover:underline"
                            >
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
                      {row.submission.videoShareConfirmed ? null : (
                        <span className="shrink-0 text-xs text-status-late">
                          sharing not confirmed
                        </span>
                      )}
                    </p>
                  ) : null}

                  {row.submission.note ? (
                    <p className="rounded-md bg-muted p-3">
                      <span className="font-medium">Their note:</span>{" "}
                      {row.submission.note}
                    </p>
                  ) : null}

                  <ReviewControls
                    submissionId={row.submission.id}
                    status={row.submission.status}
                    comment={row.submission.reviewComment ?? ""}
                    assignment={assignment}
                    teamName={row.student ? row.student.name : row.team.name}
                    emails={row.chaseEmails}
                    courseCode={courseCode}
                  />
                </div>
              ) : (
                <p className="mt-3 border-t pt-3 text-sm text-muted-foreground">
                  Nothing delivered.{" "}
                  {row.chaseEmails.length > 0 ? (
                    <a
                      href={`mailto:${row.chaseEmails.join(",")}?subject=${encodeURIComponent(
                        `Missing: ${assignment.title}`,
                      )}`}
                      className="text-aau-600 hover:underline"
                    >
                      Email {row.student ? "them" : "the team"}
                    </a>
                  ) : null}
                </p>
              )}

              {/* An extension applies to the whole team, so it is offered once
                  per team even on a solo assignment's per-student rows. */}
              <div className="mt-2">
                <ExtensionControl
                  assignmentId={assignment.id}
                  teamId={row.team.id}
                  currentDueAt={row.effectiveDueAt}
                  extended={row.extended}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}
