"use client";

import { useMemo, useOptimistic, useState, useTransition } from "react";
import { GripVertical, Users } from "lucide-react";

import { TeamCard } from "@/components/team-card";
import type { RosterMember, TeamWithMembers } from "@/lib/admin-data";
import type { Student } from "@/db/schema";
import { moveStudent } from "@/lib/admin-actions";
import { cn } from "@/lib/utils";

/**
 * The teams screen as one draggable board.
 *
 * Re-cutting groups is the thing this page exists for, and doing it through a
 * dropdown means reading a name, finding it in a list, and pressing Add — three
 * steps for what is really one gesture. Dragging a member from one card to
 * another is that gesture.
 *
 * Two things this deliberately does not do:
 *
 * - It does not replace the dropdown. HTML5 drag-and-drop is mouse-only: it
 *   does not work on a touch screen and cannot be driven from the keyboard. The
 *   select-and-Add control on every card remains the accessible path, and the
 *   board is an enhancement layered on top of it.
 * - It does not pull in a drag-and-drop library. One student onto one card is
 *   what the native API is for, and the alternative is a dependency larger than
 *   this component.
 *
 * State is optimistic: the card moves the moment you let go, and the server
 * action revalidates behind it. If the write fails, revalidation puts the
 * student back where the database says they are.
 */

/** Where one student currently sits. `teamId: null` means no team. */
interface Placement {
  studentId: number;
  teamId: number | null;
}

export function TeamBoard({
  teams,
  unassigned,
  roster,
  assignmentId,
  forumCounts,
}: {
  teams: TeamWithMembers[];
  unassigned: Student[];
  roster: RosterMember[];
  /** Every team here belongs to this assignment, and so does every move. */
  assignmentId: number;
  /** Message count per team id, for the "Forum (n)" link on each card. */
  forumCounts?: Record<number, number>;
}) {
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<number | null | "none">("none");
  const [, startTransition] = useTransition();

  // Every student on this page, by id, so a placement can be rendered without
  // going back to the server for the name.
  const studentsById = useMemo(() => {
    const map = new Map<number, Student>();
    for (const s of unassigned) map.set(s.id, s);
    for (const { members } of teams) for (const m of members) map.set(m.id, m);
    return map;
  }, [teams, unassigned]);

  const serverPlacements = useMemo<Placement[]>(
    () => [
      ...teams.flatMap(({ team, members }) =>
        members.map((m) => ({ studentId: m.id, teamId: team.id })),
      ),
      ...unassigned.map((s) => ({ studentId: s.id, teamId: null })),
    ],
    [teams, unassigned],
  );

  const [placements, applyMove] = useOptimistic(
    serverPlacements,
    (state, move: Placement) =>
      state.map((p) =>
        p.studentId === move.studentId ? { ...p, teamId: move.teamId } : p,
      ),
  );

  const byName = (a: Student, b: Student) => a.name.localeCompare(b.name);
  const membersOf = (teamId: number | null) =>
    placements
      .filter((p) => p.teamId === teamId)
      .map((p) => studentsById.get(p.studentId))
      .filter((s): s is Student => Boolean(s))
      .sort(byName);

  function drop(event: React.DragEvent, teamId: number | null) {
    event.preventDefault();
    setOver("none");
    setDragging(null);

    const studentId = Number(event.dataTransfer.getData("text/plain"));
    if (!Number.isInteger(studentId) || !studentsById.has(studentId)) return;

    // Dropping someone back where they already are is not a change.
    const current =
      placements.find((p) => p.studentId === studentId)?.teamId ?? null;
    if (current === teamId) return;

    startTransition(async () => {
      applyMove({ studentId, teamId });
      await moveStudent(studentId, assignmentId, teamId);
    });
  }

  const zone = (teamId: number | null) => ({
    onDragOver: (event: React.DragEvent) => {
      if (dragging === null) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      setOver(teamId);
    },
    onDragLeave: () => setOver((o) => (o === teamId ? "none" : o)),
    onDrop: (event: React.DragEvent) => drop(event, teamId),
  });

  const dragHandlers = (studentId: number) => ({
    draggable: true,
    onDragStart: (event: React.DragEvent) => {
      event.dataTransfer.setData("text/plain", String(studentId));
      event.dataTransfer.effectAllowed = "move";
      setDragging(studentId);
    },
    onDragEnd: () => {
      setDragging(null);
      setOver("none");
    },
  });

  const free = membersOf(null);

  return (
    <>
      {/* -- not in a team: both a warning and a place to drop people ------- */}
      <div
        {...zone(null)}
        className={cn(
          "mt-6 rounded-lg border p-4 transition-colors",
          over === null
            ? "border-aau-500 border-dashed bg-aau-50"
            : "bg-status-late-bg/40",
        )}
      >
        <p className="flex items-center gap-2 text-sm font-medium">
          <Users className="size-4 text-status-late" aria-hidden="true" />
          {free.length} student{free.length === 1 ? "" : "s"} not in a team
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          {free.length > 0
            ? "They cannot deliver anything until they are in one — including solo assignments, which are handed in through a team page."
            : "Everyone is placed. Drop someone here to take them off their team."}
        </p>
        {free.length > 0 ? (
          <ul className="mt-3 flex flex-wrap gap-2">
            {free.map((student) => (
              <li
                key={student.id}
                {...dragHandlers(student.id)}
                title="Drag onto a team"
                className={cn(
                  "flex cursor-grab items-center gap-1 rounded-full border bg-card px-2.5 py-1 text-xs active:cursor-grabbing",
                  dragging === student.id && "opacity-40",
                )}
              >
                <GripVertical
                  className="size-3 text-muted-foreground"
                  aria-hidden="true"
                />
                {student.name}
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {teams.length === 0 ? (
        <p className="mt-8 rounded-lg border border-dashed p-8 text-center text-muted-foreground">
          No teams yet.
        </p>
      ) : (
        <ul className="mt-8 space-y-4">
          {teams.map(({ team }) => (
            <li key={team.id}>
              <TeamCard
                team={team}
                members={membersOf(team.id)}
                roster={roster}
                assignmentId={assignmentId}
                dropHandlers={zone(team.id)}
                isDropTarget={over === team.id}
                dragging={dragging}
                memberDragHandlers={dragHandlers}
                forumCount={forumCounts?.[team.id] ?? 0}
              />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
