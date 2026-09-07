"use client";

import { useState } from "react";
import { Shuffle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";

/**
 * Auto-group students into teams of 3-4.
 *
 * "Shuffle unassigned students" is safe to press any time — it only places
 * students who have no team yet, so it cannot undo hand-made groups. The
 * destructive option re-cuts everyone and needs its own confirm, since a team
 * that already has a submission would otherwise be deleted along with it —
 * though the server refuses that regardless of what this form sends.
 */
export function ShuffleForm({
  action,
  assignmentId,
  hasTeams,
  protectedTeamCount,
}: {
  action: (formData: FormData) => void;
  assignmentId: number;
  hasTeams: boolean;
  protectedTeamCount: number;
}) {
  const [confirmingReshuffle, setConfirmingReshuffle] = useState(false);

  return (
    <form
      action={action}
      onSubmit={() => setConfirmingReshuffle(false)}
      className="flex flex-wrap items-end gap-2 rounded-lg border bg-card p-4"
    >
      <input type="hidden" name="assignmentId" value={assignmentId} />
      <div className="space-y-1">
        <label htmlFor="shuffle-size" className="block text-sm font-medium">
          Group size
        </label>
        <NativeSelect
          id="shuffle-size"
          name="preferred"
          defaultValue="4"
          className="max-w-28"
        >
          <option value="4">3-4</option>
          <option value="3">3</option>
        </NativeSelect>
      </div>

      <Button
        type="submit"
        name="mode"
        value="fill"
        variant="outline"
        onClick={() => setConfirmingReshuffle(false)}
      >
        <Shuffle className="size-4" aria-hidden="true" />
        Shuffle unassigned students
      </Button>

      {hasTeams ? (
        confirmingReshuffle ? (
          <div className="flex flex-wrap items-center gap-2 rounded-md bg-status-missing-bg px-3 py-2">
            <p className="text-sm text-status-missing">
              Delete and re-cut every group for this assignment?
              {protectedTeamCount > 0
                ? ` ${protectedTeamCount} group${
                    protectedTeamCount === 1 ? "" : "s"
                  } with a submission already in will be kept.`
                : " This cannot be undone."}
            </p>
            <Button type="submit" name="mode" value="reshuffle" variant="destructive" size="sm">
              Yes, re-shuffle everyone
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setConfirmingReshuffle(false)}
            >
              Cancel
            </Button>
          </div>
        ) : (
          <Button
            type="button"
            variant="ghost"
            className="text-muted-foreground"
            onClick={() => setConfirmingReshuffle(true)}
          >
            Re-shuffle everyone…
          </Button>
        )
      ) : null}
    </form>
  );
}
