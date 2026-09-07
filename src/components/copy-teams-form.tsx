"use client";

import { useState } from "react";
import { Copy } from "lucide-react";

import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import type { Assignment } from "@/db/schema";

/**
 * Clone another assignment's groups onto this one.
 *
 * The common case is that groups barely change week to week, and without this
 * every new assignment would mean rebuilding the same four teams by hand.
 *
 * Anyone already grouped for this assignment is skipped rather than moved, so
 * running it twice, or after a few students have organised themselves, does not
 * undo what is already there.
 */
export function CopyTeamsForm({
  action,
  assignments,
  assignmentId,
  hasTeams,
}: {
  action: (formData: FormData) => void;
  assignments: Assignment[];
  assignmentId: number;
  hasTeams: boolean;
}) {
  const [open, setOpen] = useState(false);

  if (assignments.length === 0) return null;

  if (!open) {
    return (
      <Button variant="outline" size="lg" onClick={() => setOpen(true)}>
        <Copy className="size-4" aria-hidden="true" />
        Copy teams from…
      </Button>
    );
  }

  return (
    <form
      action={action}
      onSubmit={() => setOpen(false)}
      className="flex flex-wrap items-end gap-2 rounded-lg border bg-card p-4"
    >
      <input type="hidden" name="assignmentId" value={assignmentId} />
      <div className="space-y-1">
        <label htmlFor="copy-from" className="block text-sm font-medium">
          Copy the groups from
        </label>
        <NativeSelect id="copy-from" name="fromAssignmentId" required className="max-w-xs">
          {assignments.map((a) => (
            <option key={a.id} value={a.id}>
              {a.title}
            </option>
          ))}
        </NativeSelect>
      </div>
      <Button type="submit">Copy</Button>
      <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
        Cancel
      </Button>
      <p className="w-full text-xs text-muted-foreground">
        New teams with new links and codes — last week&rsquo;s code should not
        open this week&rsquo;s delivery.
        {hasTeams
          ? " Students already grouped here keep the team they are in."
          : ""}
      </p>
    </form>
  );
}
