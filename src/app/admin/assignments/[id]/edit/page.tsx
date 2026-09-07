import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { ArrowLeft, Trash2 } from "lucide-react";

import { AssignmentForm } from "@/components/assignment-form";
import { Button, buttonVariants } from "@/components/ui/button";
import { db } from "@/db";
import { assignments } from "@/db/schema";
import { deleteAssignment, saveAssignment } from "@/lib/admin-actions";
import { requireAdmin } from "@/lib/auth";
import { getSetting } from "@/lib/settings";

export const dynamic = "force-dynamic";

export default async function EditAssignment({
  params,
  searchParams,
}: PageProps<"/admin/assignments/[id]/edit">) {
  await requireAdmin();
  const { id } = await params;
  const query = await searchParams;

  const assignment = await db.query.assignments.findFirst({
    where: eq(assignments.id, Number(id)),
    with: { submissions: true },
  });
  if (!assignment) notFound();

  const defaultMax = Number(await getSetting("default_max_file_size_mb")) || 200;
  const count = assignment.submissions.length;

  return (
    <>
      <Link
        href={`/admin/assignments/${assignment.id}`}
        className={buttonVariants({ variant: "ghost", size: "lg" })}
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back to deliveries
      </Link>

      <h1 className="mt-4 text-2xl font-semibold tracking-tight">
        Edit assignment
      </h1>

      <AssignmentForm
        action={saveAssignment}
        assignment={assignment}
        defaultMaxFileSizeMb={defaultMax}
        error={typeof query.error === "string" ? query.error : null}
      />

      <section className="mt-12 max-w-2xl rounded-lg border border-destructive/30 p-4">
        <h2 className="text-sm font-medium">Delete this assignment</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {count > 0
            ? `This also permanently deletes ${count} submission(s) and their uploaded files. There is no undo.`
            : "No submissions yet, so nothing else is lost."}
        </p>
        <form action={deleteAssignment} className="mt-3">
          <input type="hidden" name="id" value={assignment.id} />
          <Button type="submit" variant="destructive" size="sm">
            <Trash2 className="size-3.5" aria-hidden="true" />
            Delete assignment
          </Button>
        </form>
      </section>
    </>
  );
}
