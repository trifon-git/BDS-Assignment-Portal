import { AddStudentForm } from "@/components/add-student-form";
import { RosterImport } from "@/components/roster-import";
import { StudentList } from "@/components/student-list";
import { getRoster } from "@/lib/admin-data";
import { addStudent, importRoster } from "@/lib/admin-actions";
import { requireAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

export const metadata = { title: "Students" };

export default async function StudentsPage({
  searchParams,
}: PageProps<"/admin/students">) {
  await requireAdmin();
  const query = await searchParams;
  const roster = await getRoster();

  const added = Number(query.added ?? 0);
  const skipped = Number(query.skipped ?? 0);
  const single = query.single === "1";
  const error = typeof query.error === "string" ? query.error : null;

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Students</h1>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
        The class list. Every name dropdown in the app reads from here, so a
        student who is not on this list cannot be added to a team or credited
        with a delivery.
      </p>

      {added > 0 || skipped > 0 ? (
        <p className="mt-6 rounded-lg bg-status-delivered-bg p-4 text-sm font-medium text-status-delivered">
          {single
            ? "Student added."
            : `Imported ${added} new student${added === 1 ? "" : "s"}.`}
          {skipped > 0
            ? ` ${skipped} ${skipped === 1 ? "was" : "were"} already on the list and left unchanged.`
            : ""}
        </p>
      ) : null}
      {error ? (
        <p className="mt-6 rounded-lg bg-status-missing-bg p-4 text-sm font-medium text-status-missing">
          {error}
        </p>
      ) : null}

      <RosterImport action={importRoster} className="mt-6" />

      <AddStudentForm action={addStudent} className="mt-4" />

      <h2 className="mt-10 text-sm font-semibold tracking-wide text-muted-foreground uppercase">
        Class list ({roster.length})
      </h2>

      <StudentList roster={roster} />
    </>
  );
}
