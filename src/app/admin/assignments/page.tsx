import Link from "next/link";
import { Plus } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { listAssignments } from "@/lib/admin-data";
import { requireAdmin } from "@/lib/auth";
import { formatDeadline } from "@/lib/format";
import { formatRelative } from "@/lib/deadline";

export const dynamic = "force-dynamic";

export const metadata = { title: "Assignments" };

export default async function AssignmentsList() {
  await requireAdmin();

  // `now` comes back with the rows so every countdown on the page describes the
  // same instant and the render stays a pure function of its inputs.
  const { assignments: all, now } = await listAssignments();

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Assignments</h1>
        <Link
          href="/admin/assignments/new"
          className={buttonVariants({ size: "lg" })}
        >
          <Plus className="size-4" aria-hidden="true" />
          New assignment
        </Link>
      </div>

      {all.length === 0 ? (
        <p className="mt-8 rounded-lg border border-dashed p-8 text-center text-muted-foreground">
          Nothing yet. Create the first assignment to get started.
        </p>
      ) : (
        <ul className="mt-6 divide-y rounded-lg border bg-card">
          {all.map((a) => (
            <li key={a.id} className="flex flex-wrap gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  {a.weekNumber != null ? (
                    <span className="rounded bg-aau-50 px-1.5 py-0.5 text-xs font-medium text-aau-700">
                      Week {a.weekNumber}
                    </span>
                  ) : null}
                  {!a.publishedAt ? (
                    <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
                      Draft
                    </span>
                  ) : null}
                  <span className="text-xs text-muted-foreground">
                    {a.mode === "team" ? "Team" : "Individual"}
                  </span>
                </div>
                <Link
                  href={`/admin/assignments/${a.id}`}
                  className="mt-1 block font-medium hover:underline"
                >
                  {a.title}
                </Link>
                <p className="text-xs text-muted-foreground">
                  Due {formatDeadline(a.dueAt)} (
                  {formatRelative(a.dueAt - now)})
                  {a.requiresVideo ? " · video required" : ""}
                  {a.acceptLate ? "" : " · closes at deadline"}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Link
                  href={`/admin/assignments/${a.id}/edit`}
                  className={buttonVariants({ variant: "outline", size: "sm" })}
                >
                  Edit
                </Link>
                <Link
                  href={`/admin/assignments/${a.id}`}
                  className={buttonVariants({ size: "sm" })}
                >
                  Deliveries
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
