"use client";

import { useState } from "react";
import { CalendarPlus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { setExtension } from "@/lib/admin-actions";
import { toDateTimeLocal } from "@/lib/format";

/**
 * Give one team a different deadline for one assignment.
 *
 * Collapsed by default: extensions are the exception, and a date field on every
 * row of a thirty-row matrix would bury the thing the page is actually for.
 * Saving an empty date clears the extension.
 */
export function ExtensionControl({
  assignmentId,
  teamId,
  currentDueAt,
  extended,
}: {
  assignmentId: number;
  teamId: number;
  currentDueAt: number;
  extended: boolean;
}) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
        className="text-muted-foreground"
      >
        <CalendarPlus className="size-3.5" aria-hidden="true" />
        {extended ? "Change extension" : "Give an extension"}
      </Button>
    );
  }

  return (
    <form
      action={setExtension}
      className="flex flex-wrap items-end gap-2 rounded-md border bg-muted/40 p-3"
    >
      <input type="hidden" name="assignmentId" value={assignmentId} />
      <input type="hidden" name="teamId" value={teamId} />

      <div className="space-y-1">
        <label
          htmlFor={`ext-${teamId}`}
          className="block text-xs font-medium"
        >
          New deadline for this team
        </label>
        <Input
          id={`ext-${teamId}`}
          name="newDueAt"
          type="datetime-local"
          defaultValue={toDateTimeLocal(currentDueAt)}
          className="w-auto"
        />
      </div>

      <div className="space-y-1">
        <label
          htmlFor={`ext-reason-${teamId}`}
          className="block text-xs font-medium"
        >
          Reason (for your own records)
        </label>
        <Input
          id={`ext-reason-${teamId}`}
          name="reason"
          placeholder="Two members ill"
          className="w-56"
        />
      </div>

      <Button type="submit" size="sm">
        Save
      </Button>
      {extended ? (
        // Submitting with the date cleared removes the extension.
        <Button
          type="submit"
          name="newDueAt"
          value=""
          variant="outline"
          size="sm"
        >
          Remove extension
        </Button>
      ) : null}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setOpen(false)}
      >
        Cancel
      </Button>
    </form>
  );
}
