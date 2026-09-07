import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  FileArchive,
  Plus,
  UserMinus,
  Users,
  Video,
  type LucideIcon,
} from "lucide-react";

import { MarkNotificationsSeen } from "@/components/mark-notifications-seen";
import { StatusBadge } from "@/components/status-badge";
import { StorageTrendChart } from "@/components/storage-trend-chart";
import { StudentDeliveryMatrix } from "@/components/student-delivery-matrix";
import { buttonVariants } from "@/components/ui/button";
import { WeeklyTrendChart } from "@/components/weekly-trend-chart";
import {
  getDeliveryMatrix,
  getOverview,
  getRecentActivity,
  getStorageOverTime,
  getStudentDeliveryMatrix,
  NOTIFY_ACTIONS,
  type OverviewAssignment,
} from "@/lib/admin-data";
import { requireAdmin } from "@/lib/auth";
import { formatRelative } from "@/lib/deadline";
import { formatDeadline } from "@/lib/format";
import { formatBytes } from "@/lib/storage";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export const metadata = { title: "Overview" };

export default async function AdminOverview() {
  const admin = await requireAdmin();

  // `now` comes back from the query rather than being read here, so the counts
  // and the countdowns describe the same instant and the render stays a pure
  // function of its inputs.
  const {
    summaries,
    weeklyTrend,
    videoCompliance,
    current,
    teamCount,
    studentCount,
    rosterCount,
    draftCount,
    totals,
    now,
  } = await getOverview();

  // The full matrix only for the assignment in focus, so the page can name the
  // teams still outstanding rather than only counting them.
  const focus = current ? await getDeliveryMatrix(current.assignment, now) : null;
  const chasing = focus?.rows.filter((r) => r.outstanding) ?? [];

  const storageOverTime = await getStorageOverTime();
  const studentMatrix = await getStudentDeliveryMatrix(now);

  // Students on the roster who were never placed in a team for this one. They
  // are invisible in every delivery count below — nobody is chasing them —
  // so the number is worth naming rather than leaving as a gap in a total.
  const ungrouped = current ? Math.max(0, rosterCount - studentCount) : 0;

  const recent = await getRecentActivity();
  const seenAt = admin.notificationsSeenAt;

  return (
    <>
      <MarkNotificationsSeen />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
        <Link
          href="/admin/assignments/new"
          className={buttonVariants({ size: "lg" })}
        >
          <Plus className="size-4" aria-hidden="true" />
          New assignment
        </Link>
      </div>

      {/* -- headline counts -------------------------------------------------- */}
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          icon={Users}
          label="Active students"
          value={rosterCount}
          hint={
            current
              ? `${studentCount} grouped for this assignment`
              : "on the roster"
          }
          href="/admin/students"
        />
        <Stat
          icon={Users}
          label="Teams in focus"
          value={teamCount}
          hint={current ? current.assignment.title : "no assignment yet"}
          href="/admin/teams"
        />
        <Stat
          icon={CalendarClock}
          label="Published"
          value={summaries.length}
          hint={
            draftCount > 0
              ? `${draftCount} draft${draftCount === 1 ? "" : "s"} not yet visible`
              : "no drafts waiting"
          }
          href="/admin/assignments"
        />
        <Stat
          icon={FileArchive}
          label="Files stored"
          value={totals.files}
          hint={`${formatBytes(totals.bytes)} across ${totals.submitted} deliver${
            totals.submitted === 1 ? "y" : "ies"
          }`}
        />
        {videoCompliance.total > 0 ? (
          <Stat
            icon={Video}
            label="Video compliance"
            value={`${videoCompliance.compliant}/${videoCompliance.total}`}
            hint="share-confirmed"
          />
        ) : null}
      </div>

      {/* Chase-worthy totals across the whole semester, not just the current
          week — a rework from three weeks ago is still owed. */}
      {totals.outstanding > 0 || totals.late > 0 ? (
        <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <span>
            <span className="font-medium text-foreground tabular-nums">
              {totals.outstanding}
            </span>{" "}
            outstanding this semester
          </span>
          <span>
            <span className="font-medium text-foreground tabular-nums">
              {totals.rework}
            </span>{" "}
            awaiting rework
          </span>
          <span>
            <span className="font-medium text-foreground tabular-nums">
              {totals.late}
            </span>{" "}
            delivered late
          </span>
        </p>
      ) : null}

      {focus && current ? (
        <section className="mt-10">
          <h2 className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">
            In focus
          </h2>

          <div className="mt-3 rounded-lg border bg-card p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="font-medium">
                  <Link
                    href={`/admin/assignments/${current.assignment.id}`}
                    className="hover:underline"
                  >
                    {current.assignment.title}
                  </Link>
                </h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Due {formatDeadline(current.assignment.dueAt)} (
                  {formatRelative(current.assignment.dueAt - now)}) —{" "}
                  {current.assignment.mode === "team"
                    ? "team delivery"
                    : "individual delivery"}
                  {current.assignment.requiresVideo ? " · video required" : ""}
                  {current.extensions > 0
                    ? ` · ${current.extensions} extension${
                        current.extensions === 1 ? "" : "s"
                      }`
                    : ""}
                </p>
              </div>
              <p className="text-right">
                <span className="text-2xl font-semibold tabular-nums">
                  {focus.delivered}
                  <span className="text-muted-foreground">/{focus.total}</span>
                </span>
                <span className="block text-xs text-muted-foreground">
                  delivered
                </span>
              </p>
            </div>

            <ProgressBar summary={current} className="mt-4" />

            {/* The bar's segments spelled out, because a teacher acts on
                "three need rework", not on a width. */}
            <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm">
              <Breakdown
                label="On time"
                value={current.delivered - current.lateDelivered}
                tone="text-status-delivered"
              />
              <Breakdown
                label="Late"
                value={current.lateDelivered}
                tone="text-status-late"
              />
              <Breakdown
                label="Needs rework"
                value={current.rework}
                tone="text-status-rework"
              />
              <Breakdown
                label="Nothing in"
                value={current.notDelivered}
                tone="text-status-missing"
              />
              <Breakdown
                label="Approved"
                value={current.approved}
                tone="text-muted-foreground"
              />
              <Breakdown
                label="Files"
                value={`${current.files} · ${formatBytes(current.bytes)}`}
                tone="text-muted-foreground"
              />
            </dl>

            {ungrouped > 0 ? (
              <p className="mt-4 flex items-start gap-2 rounded-md bg-status-missing-bg px-3 py-2 text-sm text-status-missing">
                <UserMinus
                  className="mt-0.5 size-4 shrink-0"
                  aria-hidden="true"
                />
                <span>
                  {ungrouped} active student{ungrouped === 1 ? " is" : "s are"}{" "}
                  not in a team for this assignment, so they are not counted
                  above.{" "}
                  <Link href="/admin/teams" className="underline">
                    Group them
                  </Link>
                  .
                </span>
              </p>
            ) : null}

            {chasing.length > 0 ? (
              <div className="mt-5">
                <p className="text-sm font-medium">
                  Still outstanding ({chasing.length})
                </p>
                <ul className="mt-2 flex flex-wrap gap-2">
                  {chasing.slice(0, 12).map((row) => (
                    <li
                      key={row.key}
                      className="rounded-full border px-2.5 py-1 text-xs"
                    >
                      {row.student ? row.student.name : row.team.name}
                    </li>
                  ))}
                  {chasing.length > 12 ? (
                    <li className="px-2.5 py-1 text-xs text-muted-foreground">
                      +{chasing.length - 12} more
                    </li>
                  ) : null}
                </ul>
                <Link
                  href={`/admin/assignments/${current.assignment.id}?filter=outstanding`}
                  className={cn(
                    buttonVariants({ variant: "outline", size: "sm" }),
                    "mt-4",
                  )}
                >
                  Chase them
                  <ArrowRight className="size-3.5" aria-hidden="true" />
                </Link>
              </div>
            ) : (
              <p className="mt-5 text-sm text-status-delivered">
                Everyone has delivered.
              </p>
            )}
          </div>
        </section>
      ) : (
        <p className="mt-10 rounded-lg border border-dashed p-8 text-center text-muted-foreground">
          No assignments published yet.{" "}
          <Link href="/admin/assignments/new" className="underline">
            Create the first one
          </Link>
          .
        </p>
      )}

      {/* -- semester-wide trends ----------------------------------------------
          Different granularity from the per-assignment table below: this
          answers "how has delivery behavior trended", not "how is this one
          assignment doing". */}
      {weeklyTrend.length > 0 ? (
        <section className="mt-10">
          <h2 className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">
            Weekly delivery trend
          </h2>
          <div className="mt-3 rounded-lg border bg-card p-4">
            <WeeklyTrendChart data={weeklyTrend} />
          </div>
        </section>
      ) : null}

      {storageOverTime.length > 0 ? (
        <section className="mt-10">
          <h2 className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">
            Storage over time
          </h2>
          <div className="mt-3 rounded-lg border bg-card p-4">
            <StorageTrendChart data={storageOverTime} />
          </div>
        </section>
      ) : null}

      {/* -- per-assignment deliverables -------------------------------------- */}
      {summaries.length > 0 ? (
        <section className="mt-10">
          <h2 className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">
            Deliverables by assignment
          </h2>
          <div className="mt-3 overflow-x-auto rounded-lg border bg-card">
            <table className="w-full min-w-[46rem] text-sm">
              <thead>
                <tr className="border-b text-xs tracking-wide text-muted-foreground uppercase">
                  <th scope="col" className="px-4 py-2.5 text-left font-medium">
                    Assignment
                  </th>
                  <th scope="col" className="px-3 py-2.5 text-left font-medium">
                    Progress
                  </th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium">
                    In
                  </th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium">
                    Late
                  </th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium">
                    Rework
                  </th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium">
                    Teams
                  </th>
                  <th scope="col" className="px-4 py-2.5 text-right font-medium">
                    Files
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {summaries.map((s) => (
                  <tr key={s.assignment.id}>
                    <td className="px-4 py-3">
                      <Link
                        href={`/admin/assignments/${s.assignment.id}`}
                        className="font-medium hover:underline"
                      >
                        {s.assignment.weekNumber != null
                          ? `W${s.assignment.weekNumber} · `
                          : ""}
                        {s.assignment.title}
                      </Link>
                      <p className="text-xs text-muted-foreground">
                        Due {formatDeadline(s.assignment.dueAt)} ·{" "}
                        {s.assignment.mode === "team" ? "team" : "individual"}
                        {s.extensions > 0
                          ? ` · ${s.extensions} extended`
                          : ""}
                      </p>
                    </td>
                    <td className="px-3 py-3">
                      <ProgressBar summary={s} className="w-32 min-w-24" />
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">
                      <span className="inline-flex items-center gap-2">
                        {s.outstanding > 0 ? (
                          <StatusBadge
                            state={s.overdue ? "missing" : "pending"}
                            size="sm"
                          />
                        ) : (
                          <StatusBadge state="delivered" size="sm" />
                        )}
                        <span>
                          {s.delivered}
                          <span className="text-muted-foreground">
                            /{s.total}
                          </span>
                        </span>
                      </span>
                    </td>
                    <Cell value={s.late} tone="text-status-late" />
                    <Cell value={s.rework} tone="text-status-rework" />
                    <td className="px-3 py-3 text-right tabular-nums text-muted-foreground">
                      {s.teams}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                      {s.files}
                      <span className="block text-xs">
                        {formatBytes(s.bytes)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {summaries.some((s) => s.total === 0) ? (
            <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
              <AlertTriangle className="size-3.5" aria-hidden="true" />
              An assignment with no teams has nothing to deliver against yet.
            </p>
          ) : null}
        </section>
      ) : null}

      {studentMatrix.rows.length > 0 && studentMatrix.columns.length > 0 ? (
        <section className="mt-10">
          <h2 className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">
            Student delivery matrix
          </h2>
          <div className="mt-3">
            <StudentDeliveryMatrix matrix={studentMatrix} />
          </div>
        </section>
      ) : null}

      <section className="mt-10">
        <h2 className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">
          Recent activity
        </h2>
        {recent.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">Nothing yet.</p>
        ) : (
          <ul className="mt-3 divide-y rounded-lg border bg-card text-sm">
            {recent.map((entry) => {
              const isNew =
                (NOTIFY_ACTIONS as readonly string[]).includes(entry.action) &&
                entry.at > (seenAt ?? 0);
              return (
                <li
                  key={entry.id}
                  className="flex flex-wrap items-center gap-x-3 px-4 py-2.5"
                >
                  {isNew ? (
                    <span
                      className="size-1.5 shrink-0 rounded-full bg-status-late"
                      aria-label="New since your last visit"
                    />
                  ) : (
                    <span className="size-1.5 shrink-0" aria-hidden="true" />
                  )}
                  <span className="text-muted-foreground tabular-nums">
                    {formatDeadline(entry.at)}
                  </span>
                  <span className="font-medium">{entry.actorName ?? "—"}</span>
                  <span className="text-muted-foreground">
                    {describeAction(entry.action)}
                  </span>
                  {entry.detail ? (
                    <span className="min-w-0 truncate text-muted-foreground">
                      {entry.detail}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}

/** Turns a raw dotted action string into the phrase a person reads. Falls
 *  back to spacing out the dots for anything not worth a bespoke label. */
const ACTION_LABELS: Record<string, string> = {
  "submission.created": "delivered",
  "submission.replaced": "replaced their delivery",
  "submission.submitted": "reset for another look",
  "submission.approved": "approved a delivery",
  "submission.rework": "sent a delivery back",
  "submission.commented": "left feedback",
  "forum.posted": "posted in their team forum",
  "forum.edited": "edited a forum message",
  "forum.deleted": "deleted a forum message",
  "team.created": "formed a team",
  "team.created_by_admin": "created a team",
  "team.shuffled": "shuffled teams",
  "team.member_moved": "moved a team member",
  "team.member_removed": "removed a team member",
  "team.deleted": "deleted a team",
  "team.link_regenerated": "regenerated a team link",
  "teams.copied": "copied teams",
  "assignment.created": "created an assignment",
  "assignment.updated": "updated an assignment",
  "assignment.deleted": "deleted an assignment",
  "assignment.downloaded": "downloaded all deliveries",
  "extension.set": "granted an extension",
  "extension.cleared": "cleared an extension",
  "roster.imported": "imported the roster",
  "student.added": "added a student",
  "student.updated": "updated a student",
  "student.deleted": "deleted a student",
  "student.reactivated": "reactivated a student",
  "student.deactivated": "deactivated a student",
  "admin.email_changed": "changed their sign-in email",
  "admin.created": "added an admin",
  "admin.removed": "removed an admin",
  "admin.login": "signed in",
  "admin.login_failed": "tried to sign in",
  "file.deleted": "deleted a file",
};

function describeAction(action: string): string {
  return ACTION_LABELS[action] ?? action.replace(/\./g, " · ");
}

/**
 * The delivery split as one bar: on time, late, rework, and the rest of the
 * track standing for what is not in. The three segments come from `submitted`,
 * so a late delivery that was also sent back is drawn once, not twice.
 */
function ProgressBar({
  summary,
  className,
}: {
  summary: OverviewAssignment;
  className?: string;
}) {
  const { total, delivered, lateDelivered, rework } = summary;
  const pct = (n: number) => (total > 0 ? (n / total) * 100 : 0);
  const onTime = delivered - lateDelivered;

  return (
    <div
      className={`flex h-2 overflow-hidden rounded-full bg-muted ${className ?? ""}`}
      role="img"
      aria-label={
        total === 0
          ? "Nothing to deliver yet"
          : `${delivered} of ${total} delivered, ${lateDelivered} late, ${rework} needing rework`
      }
    >
      <div
        className="h-full bg-status-delivered transition-all"
        style={{ width: `${pct(onTime)}%` }}
      />
      <div
        className="h-full bg-status-late transition-all"
        style={{ width: `${pct(lateDelivered)}%` }}
      />
      <div
        className="h-full bg-status-rework transition-all"
        style={{ width: `${pct(rework)}%` }}
      />
    </div>
  );
}

function Breakdown({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | string;
  tone: string;
}) {
  return (
    <div>
      <dt className="text-xs tracking-wide text-muted-foreground uppercase">
        {label}
      </dt>
      <dd className={`font-medium tabular-nums ${tone}`}>{value}</dd>
    </div>
  );
}

/** A right-aligned count that greys out at zero, so only real work draws the eye. */
function Cell({ value, tone }: { value: number; tone: string }) {
  return (
    <td
      className={`px-3 py-3 text-right tabular-nums ${
        value > 0 ? tone : "text-muted-foreground"
      }`}
    >
      {value}
    </td>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  hint,
  href,
}: {
  icon: LucideIcon;
  label: string;
  value: number | string;
  hint?: string;
  href?: string;
}) {
  const body = (
    <>
      <p className="flex items-center gap-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">
        <Icon className="size-3.5" aria-hidden="true" />
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {hint ? (
        <p className="mt-0.5 truncate text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </>
  );

  // Only the cards that lead somewhere are links; a plain card must not look
  // clickable when there is nothing behind it.
  return href ? (
    <Link
      href={href}
      className="rounded-lg border bg-card p-4 transition-colors hover:border-aau-300"
    >
      {body}
    </Link>
  ) : (
    <div className="rounded-lg border bg-card p-4">{body}</div>
  );
}
