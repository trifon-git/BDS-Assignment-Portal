import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { AssignmentForm } from "@/components/assignment-form";
import { buttonVariants } from "@/components/ui/button";
import { saveAssignment } from "@/lib/admin-actions";
import { requireAdmin } from "@/lib/auth";
import { getSetting } from "@/lib/settings";

export const dynamic = "force-dynamic";

export const metadata = { title: "New assignment" };

export default async function NewAssignment({
  searchParams,
}: PageProps<"/admin/assignments/new">) {
  await requireAdmin();
  const query = await searchParams;
  const defaultMax = Number(await getSetting("default_max_file_size_mb")) || 200;

  return (
    <>
      <Link
        href="/admin/assignments"
        className={buttonVariants({ variant: "ghost", size: "lg" })}
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Assignments
      </Link>

      <h1 className="mt-4 text-2xl font-semibold tracking-tight">
        New assignment
      </h1>

      <AssignmentForm
        action={saveAssignment}
        defaultMaxFileSizeMb={defaultMax}
        error={typeof query.error === "string" ? query.error : null}
      />
    </>
  );
}
