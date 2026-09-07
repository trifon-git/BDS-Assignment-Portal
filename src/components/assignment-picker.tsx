"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { CalendarClock } from "lucide-react";

import { NativeSelect } from "@/components/ui/native-select";
import type { Assignment } from "@/db/schema";
import { cn } from "@/lib/utils";

/**
 * "Which assignment am I looking at?" — the question every teams screen has to
 * answer first now that groups are per assignment.
 *
 * It navigates rather than filtering in place so the choice lives in the URL:
 * the page stays linkable, the back button works, and a reload does not throw
 * the admin back to a different assignment than the one they were editing.
 */
export function AssignmentPicker({
  assignments,
  selectedId,
  basePath,
  className,
}: {
  assignments: Assignment[];
  selectedId: number;
  basePath: string;
  className?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <div className={cn("flex flex-wrap items-center gap-3", className)}>
      <label
        htmlFor="assignment-picker"
        className="flex items-center gap-1.5 text-sm font-medium"
      >
        <CalendarClock className="size-4 text-aau-600" aria-hidden="true" />
        Assignment
      </label>
      <NativeSelect
        id="assignment-picker"
        value={String(selectedId)}
        disabled={pending}
        onChange={(event) => {
          const id = event.target.value;
          startTransition(() => router.push(`${basePath}?assignment=${id}`));
        }}
        className="max-w-md"
      >
        {assignments.map((assignment) => (
          <option key={assignment.id} value={assignment.id}>
            {assignment.title}
            {assignment.publishedAt ? "" : " (draft)"}
          </option>
        ))}
      </NativeSelect>
    </div>
  );
}
