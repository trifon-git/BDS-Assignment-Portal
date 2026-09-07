"use client";

import { useMemo, useState } from "react";
import { Check, Pencil, Search, Trash2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { RosterRow } from "@/lib/admin-data";
import {
  deleteStudent,
  setStudentActive,
  updateStudent,
} from "@/lib/admin-actions";

/**
 * The class list, with the three things an admin actually needs to do to it:
 * correct a row, put someone aside for the rest of term, or remove them.
 *
 * Deactivate and delete are deliberately different actions rather than one
 * "remove" button. Deactivating keeps every delivery the student has made and
 * only takes them out of dropdowns and the delivery counts — which is what you
 * want when somebody drops the course in week six. Deleting is for the row that
 * should never have existed, and it says out loud what it will destroy.
 */
export function StudentList({ roster }: { roster: RosterRow[] }) {
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<number | null>(null);
  const [confirming, setConfirming] = useState<number | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return roster;
    return roster.filter(
      (r) =>
        r.student.name.toLowerCase().includes(q) ||
        r.student.email.toLowerCase().includes(q),
    );
  }, [roster, query]);

  if (roster.length === 0) {
    return (
      <p className="mt-3 rounded-lg border border-dashed p-8 text-center text-muted-foreground">
        Nobody yet. Paste the class list above, or add someone individually.
      </p>
    );
  }

  return (
    <>
      <div className="relative mt-3 max-w-sm">
        <Search
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter by name or email"
          aria-label="Filter the class list"
          className="pl-9"
        />
      </div>

      {filtered.length === 0 ? (
        <p className="mt-3 rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          Nobody matches “{query}”.
        </p>
      ) : (
        <ul className="mt-3 divide-y rounded-lg border bg-card">
          {filtered.map(
            ({
              student,
              groupedFor,
              publishedAssignments,
              soloSubmissions,
              submittedByThem,
            }) => (
              <li key={student.id} className="px-4 py-2.5">
                {editing === student.id ? (
                  <form
                    action={updateStudent}
                    onSubmit={() => setEditing(null)}
                    className="flex flex-wrap items-center gap-2"
                  >
                    <input type="hidden" name="studentId" value={student.id} />
                    <Input
                      name="name"
                      defaultValue={student.name}
                      aria-label="Name"
                      required
                      className="min-w-40 flex-1"
                    />
                    <Input
                      name="email"
                      type="email"
                      defaultValue={student.email}
                      aria-label="Email"
                      required
                      className="min-w-56 flex-1"
                    />
                    <Button type="submit" size="sm">
                      <Check className="size-3.5" aria-hidden="true" />
                      Save
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setEditing(null)}
                    >
                      <X className="size-3.5" aria-hidden="true" />
                    </Button>
                  </form>
                ) : (
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm">
                        {student.name}
                        {!student.active ? (
                          <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                            inactive
                          </span>
                        ) : null}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {student.email}
                      </p>
                    </div>

                    <div className="flex items-center gap-1">
                      {/* A student has one team per assignment now, so the
                          class list reports coverage rather than a single
                          team name. The Teams screen has the detail. */}
                      <span className="mr-2 text-xs text-muted-foreground">
                        {publishedAssignments === 0 ? null : groupedFor === 0 ? (
                          <span className="text-status-late">In no groups</span>
                        ) : (
                          <span
                            className={
                              groupedFor < publishedAssignments
                                ? "text-status-late"
                                : undefined
                            }
                          >
                            In {groupedFor} of {publishedAssignments} groups
                          </span>
                        )}
                      </span>

                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditing(student.id)}
                        title="Correct the name or email"
                      >
                        <Pencil className="size-3.5" aria-hidden="true" />
                        Edit
                      </Button>

                      <form action={setStudentActive}>
                        <input
                          type="hidden"
                          name="studentId"
                          value={student.id}
                        />
                        {student.active ? null : (
                          <input type="hidden" name="active" value="on" />
                        )}
                        <Button type="submit" variant="ghost" size="sm">
                          {student.active ? "Deactivate" : "Reactivate"}
                        </Button>
                      </form>

                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setConfirming(student.id)}
                        className="text-muted-foreground"
                        title="Remove from the class list"
                      >
                        <Trash2 className="size-3.5" aria-hidden="true" />
                      </Button>
                    </div>
                  </div>
                )}

                {confirming === student.id ? (
                  <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-status-missing/40 bg-status-missing-bg/40 p-3">
                    <p className="flex-1 text-sm">
                      Remove <strong>{student.name}</strong> from the class list?
                      {soloSubmissions > 0 ? (
                        <>
                          {" "}
                          This also deletes{" "}
                          <strong>
                            {soloSubmissions} individual deliver
                            {soloSubmissions === 1 ? "y" : "ies"}
                          </strong>{" "}
                          and the uploaded files.
                        </>
                      ) : null}
                      {submittedByThem > 0 ? (
                        <>
                          {" "}
                          {submittedByThem} team deliver
                          {submittedByThem === 1 ? "y" : "ies"} they handed in
                          stay with the team; only their name is cleared.
                        </>
                      ) : null}{" "}
                      To keep their work, use{" "}
                      <em>Deactivate</em> instead.
                    </p>
                    <form
                      action={deleteStudent}
                      onSubmit={() => setConfirming(null)}
                    >
                      <input
                        type="hidden"
                        name="studentId"
                        value={student.id}
                      />
                      <Button type="submit" variant="destructive" size="sm">
                        Yes, remove
                      </Button>
                    </form>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setConfirming(null)}
                    >
                      Cancel
                    </Button>
                  </div>
                ) : null}
              </li>
            ),
          )}
        </ul>
      )}
    </>
  );
}
