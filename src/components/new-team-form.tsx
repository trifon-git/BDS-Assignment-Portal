"use client";

import { useMemo, useState } from "react";
import { Plus, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { RosterMember } from "@/lib/admin-data";
import { cn } from "@/lib/utils";

/**
 * Create a team from anyone in the class.
 *
 * This deliberately offers the whole roster rather than only the students who
 * happen to be unassigned. Groups get re-cut mid-semester, and the earlier
 * "unassigned only" list meant re-forming a group was a chore: remove three
 * people from their old teams one at a time, then come back here. Picking
 * someone who is already placed simply moves them, and the row says where
 * they are moving from so it is never a surprise.
 */
export function NewTeamForm({
  action,
  roster,
  assignmentId,
  className,
}: {
  action: (formData: FormData) => void;
  roster: RosterMember[];
  /** The assignment this team is being created for. */
  assignmentId: number;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Set<number>>(new Set());

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return roster;
    return roster.filter(
      (r) =>
        r.student.name.toLowerCase().includes(q) ||
        r.student.email.toLowerCase().includes(q) ||
        (r.team?.name.toLowerCase().includes(q) ?? false),
    );
  }, [roster, query]);

  // Warn only about people who are actually being taken from somewhere.
  const moving = useMemo(
    () =>
      roster.filter((r) => picked.has(r.student.id) && r.team !== null),
    [roster, picked],
  );

  function toggle(id: number, checked: boolean) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function reset() {
    setOpen(false);
    setQuery("");
    setPicked(new Set());
  }

  if (!open) {
    return (
      <div className={className}>
        <Button variant="outline" size="lg" onClick={() => setOpen(true)}>
          <Plus className="size-4" aria-hidden="true" />
          New team
        </Button>
      </div>
    );
  }

  return (
    <form
      action={action}
      onSubmit={() => setTimeout(reset, 0)}
      className={cn(
        "max-w-2xl space-y-4 rounded-lg border bg-card p-4",
        className,
      )}
    >
      <input type="hidden" name="assignmentId" value={assignmentId} />

      <div className="space-y-2">
        <Label htmlFor="new-team-name">Team name</Label>
        <Input
          id="new-team-name"
          name="name"
          required
          maxLength={80}
          placeholder="Group 5 — Time Series"
        />
      </div>

      {roster.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No students on the roster yet. Import the class list first, or create
          the team now and add people later.
        </p>
      ) : (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">
            Members{" "}
            <span className="font-normal text-muted-foreground">
              ({picked.size} selected)
            </span>
          </legend>

          <div className="relative">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter by name, email or current team"
              aria-label="Filter the class list"
              className="pl-9"
            />
          </div>

          <div className="max-h-64 divide-y overflow-y-auto rounded-md border">
            {filtered.length === 0 ? (
              <p className="px-3 py-4 text-sm text-muted-foreground">
                Nobody matches “{query}”.
              </p>
            ) : (
              filtered.map(({ student, team }) => (
                <label
                  key={student.id}
                  className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-muted/60"
                >
                  <Checkbox
                    name="members"
                    value={String(student.id)}
                    checked={picked.has(student.id)}
                    onCheckedChange={(checked) => toggle(student.id, checked)}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm">{student.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {student.email}
                    </span>
                  </span>
                  {team ? (
                    <span className="shrink-0 rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
                      {team.name}
                    </span>
                  ) : (
                    <span className="shrink-0 rounded-full border border-status-late/40 bg-status-late-bg/50 px-2 py-0.5 text-xs">
                      No team
                    </span>
                  )}
                </label>
              ))
            )}
          </div>
        </fieldset>
      )}

      {moving.length > 0 ? (
        <p className="rounded-md border border-status-late/40 bg-status-late-bg/40 p-3 text-sm">
          {moving.length === 1 ? (
            <>
              <strong className="font-medium">{moving[0].student.name}</strong>{" "}
              will be moved out of {moving[0].team?.name}.
            </>
          ) : (
            <>
              <strong className="font-medium">{moving.length} students</strong>{" "}
              will be moved out of their current teams:{" "}
              {moving.map((m) => m.student.name).join(", ")}.
            </>
          )}{" "}
          Anything they have already delivered stays with the team they
          delivered it from.
        </p>
      ) : null}

      <div className="flex gap-2">
        <Button type="submit" size="lg">
          Create team
        </Button>
        <Button type="button" variant="ghost" size="lg" onClick={reset}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
