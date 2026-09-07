"use client";

import { useState } from "react";
import { Search, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Student } from "@/db/schema";

/**
 * Team creation from the roster.
 *
 * The list is checkboxes rather than a multi-select: on a class-sized list it
 * is faster to scan, it works on a phone, and — because each box is a real
 * form control — the whole thing still submits if the bundle never loads. The
 * filter box is the only part that needs JavaScript.
 */
export function JoinForm({
  action,
  students,
  assignmentId,
}: {
  action: (formData: FormData) => void;
  students: Student[];
  /** The assignment this team is being formed for; a team belongs to one. */
  assignmentId: number;
}) {
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<number[]>([]);

  const needle = filter.trim().toLowerCase();
  const visible = needle
    ? students.filter(
        (s) =>
          s.name.toLowerCase().includes(needle) ||
          s.email.toLowerCase().includes(needle),
      )
    : students;

  function toggle(id: number, checked: boolean) {
    setSelected((prev) =>
      checked ? [...prev, id] : prev.filter((x) => x !== id),
    );
  }

  return (
    <form action={action} className="mt-8 space-y-6">
      <input type="hidden" name="assignmentId" value={assignmentId} />
      <div className="space-y-2">
        <Label htmlFor="name">Team name</Label>
        <Input
          id="name"
          name="name"
          required
          maxLength={80}
          placeholder="Group 3 — Text Mining"
        />
        <p className="text-xs text-muted-foreground">
          Something you and the teacher will recognise in a list.
        </p>
      </div>

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">
          Members{" "}
          <span className="font-normal text-muted-foreground">
            (include yourself)
          </span>
        </legend>

        <div className="relative">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Find a name…"
            aria-label="Filter the class list"
            className="pl-9"
          />
        </div>

        <div className="max-h-80 divide-y overflow-y-auto rounded-lg border bg-card">
          {visible.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">
              No one on the list matches “{filter}”.
            </p>
          ) : (
            visible.map((s) => (
              <label
                key={s.id}
                className="flex cursor-pointer items-center gap-3 px-4 py-2.5 hover:bg-muted/60"
              >
                <Checkbox
                  name="members"
                  value={String(s.id)}
                  checked={selected.includes(s.id)}
                  onCheckedChange={(checked) => toggle(s.id, Boolean(checked))}
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm">{s.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {s.email}
                  </span>
                </span>
              </label>
            ))
          )}
        </div>

        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Users className="size-4" aria-hidden="true" />
          {selected.length === 0
            ? "Nobody selected yet"
            : `${selected.length} selected`}
        </p>
        <p className="text-xs text-muted-foreground">
          Anyone already in a team is not on this list. Ask the course
          responsible if someone is missing.
        </p>
      </fieldset>

      <Button type="submit" size="lg" disabled={selected.length === 0}>
        Create team
      </Button>
    </form>
  );
}
