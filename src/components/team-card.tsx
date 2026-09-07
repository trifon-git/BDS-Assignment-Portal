"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Check,
  Copy,
  GripVertical,
  Mail,
  MessageSquare,
  RefreshCw,
  Trash2,
  UserMinus,
  UserPlus,
} from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import type { Student, Team } from "@/db/schema";
import type { RosterMember } from "@/lib/admin-data";
import {
  addTeamMember,
  deleteTeam,
  regenerateTeamLink,
  removeTeamMember,
  renameTeam,
} from "@/lib/admin-actions";

/**
 * One team's admin card: rename it, copy or rotate its link, and move people in
 * and out.
 *
 * The destructive actions ask for confirmation through a two-step reveal rather
 * than a `confirm()` dialog — deleting a team takes its submissions and files
 * with it, and that is not something to do by mis-click.
 */
export function TeamCard({
  team,
  members,
  roster,
  assignmentId,
  dropHandlers,
  isDropTarget = false,
  dragging = null,
  memberDragHandlers,
  forumCount = 0,
}: {
  team: Team;
  members: Student[];
  roster: RosterMember[];
  assignmentId: number;
  /** Drag-and-drop wiring from TeamBoard. Absent when the card is rendered on
   *  its own, in which case it behaves exactly as it always did. */
  dropHandlers?: React.HTMLAttributes<HTMLDivElement>;
  isDropTarget?: boolean;
  dragging?: number | null;
  memberDragHandlers?: (studentId: number) => React.HTMLAttributes<HTMLLIElement>;
  forumCount?: number;
}) {
  const [copied, setCopied] = useState<"link" | "code" | null>(null);
  const [confirming, setConfirming] = useState(false);

  // Anyone in the class who is not already here can be added; picking someone
  // from another team moves them, which is what re-cutting groups needs.
  const addable = roster.filter((r) => r.team?.id !== team.id);

  const link =
    typeof window === "undefined"
      ? `/t/${team.accessToken}`
      : `${window.location.origin}/t/${team.accessToken}`;

  // To, not Bcc — unlike the chase list, these recipients are teammates who
  // are about to work together, so seeing each other's addresses (and being
  // able to reply-all) is the point rather than something to avoid.
  const mailto = `mailto:${members.map((m) => m.email).join(",")}?subject=${encodeURIComponent(
    `${team.name} — your group link`,
  )}&body=${encodeURIComponent(
    `Hi ${team.name},\n\nHere is your team's link for this assignment:\n${link}\n\nShort code: ${team.shortCode}`,
  )}`;

  async function copy(what: "link" | "code") {
    try {
      await navigator.clipboard.writeText(
        what === "link" ? link : team.shortCode,
      );
      setCopied(what);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setCopied(null);
    }
  }

  return (
    <div
      {...dropHandlers}
      className={cn(
        "rounded-lg border bg-card p-4 transition-colors",
        isDropTarget && "border-aau-500 border-dashed bg-aau-50",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <form action={renameTeam} className="flex min-w-0 flex-1 gap-2">
          <input type="hidden" name="teamId" value={team.id} />
          <Input
            name="name"
            defaultValue={team.name}
            aria-label="Team name"
            className="max-w-sm font-medium"
          />
          <Button type="submit" variant="outline" size="sm">
            Rename
          </Button>
        </form>

        <span className="rounded-full border px-2.5 py-1 font-mono text-xs">
          {team.shortCode}
        </span>
        <Link
          href={`/admin/teams/${team.id}/forum`}
          className={buttonVariants({ variant: "ghost", size: "sm" })}
        >
          <MessageSquare className="size-3.5" aria-hidden="true" />
          Forum ({forumCount})
        </Link>
      </div>

      {/* -- access ---------------------------------------------------------- */}
      <div className="mt-4 flex flex-wrap items-center gap-2 rounded-md bg-muted/50 p-3">
        <code className="min-w-0 flex-1 truncate text-xs">{link}</code>
        <Button variant="outline" size="sm" onClick={() => copy("link")}>
          {copied === "link" ? (
            <>
              <Check className="size-3.5" aria-hidden="true" />
              Copied
            </>
          ) : (
            <>
              <Copy className="size-3.5" aria-hidden="true" />
              Copy link
            </>
          )}
        </Button>
        <Button variant="outline" size="sm" onClick={() => copy("code")}>
          {copied === "code" ? "Copied" : "Copy code"}
        </Button>
        {members.length > 0 ? (
          <a
            href={mailto}
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            <Mail className="size-3.5" aria-hidden="true" />
            Email link
          </a>
        ) : null}
        <form action={regenerateTeamLink}>
          <input type="hidden" name="teamId" value={team.id} />
          <Button
            type="submit"
            variant="ghost"
            size="sm"
            title="Issue a new link and code. The old ones stop working immediately."
          >
            <RefreshCw className="size-3.5" aria-hidden="true" />
            Regenerate
          </Button>
        </form>
      </div>

      {/* -- members --------------------------------------------------------- */}
      <div className="mt-4">
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Members ({members.length})
        </p>
        {members.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            Nobody yet — this team cannot deliver anything.
          </p>
        ) : (
          <ul className="mt-2 divide-y rounded-md border">
            {members.map((m) => (
              <li
                key={m.id}
                {...memberDragHandlers?.(m.id)}
                title={memberDragHandlers ? "Drag onto another team" : undefined}
                className={cn(
                  "flex flex-wrap items-center justify-between gap-2 px-3 py-2",
                  memberDragHandlers && "cursor-grab active:cursor-grabbing",
                  dragging === m.id && "opacity-40",
                )}
              >
                <span className="flex min-w-0 items-center gap-2">
                  {memberDragHandlers ? (
                    <GripVertical
                      className="size-3.5 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                  ) : null}
                  <span className="min-w-0">
                    <span className="block text-sm">{m.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {m.email}
                    </span>
                  </span>
                </span>
                <form action={removeTeamMember}>
                  <input type="hidden" name="studentId" value={m.id} />
                  <input
                    type="hidden"
                    name="assignmentId"
                    value={assignmentId}
                  />
                  <Button type="submit" variant="ghost" size="sm">
                    <UserMinus className="size-3.5" aria-hidden="true" />
                    Remove
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        )}

        {addable.length > 0 ? (
          <form action={addTeamMember} className="mt-3 flex flex-wrap gap-2">
            <input type="hidden" name="teamId" value={team.id} />
            <NativeSelect
              name="studentId"
              required
              defaultValue=""
              aria-label={`Add a student to ${team.name}`}
              className="max-w-sm"
            >
              <option value="" disabled>
                Add a student…
              </option>
              {/* Free first, since adding one of those moves nobody. */}
              <optgroup label="Not in a team">
                {addable
                  .filter((r) => r.team === null)
                  .map((r) => (
                    <option key={r.student.id} value={r.student.id}>
                      {r.student.name}
                    </option>
                  ))}
              </optgroup>
              <optgroup label="Move from another team">
                {addable
                  .filter((r) => r.team !== null)
                  .map((r) => (
                    <option key={r.student.id} value={r.student.id}>
                      {r.student.name} — {r.team?.name}
                    </option>
                  ))}
              </optgroup>
            </NativeSelect>
            <Button type="submit" variant="outline" size="sm">
              <UserPlus className="size-3.5" aria-hidden="true" />
              Add
            </Button>
          </form>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">
            Everyone on the roster is already in this team.
          </p>
        )}
      </div>

      {/* -- delete ---------------------------------------------------------- */}
      <div className="mt-4 border-t pt-3">
        {confirming ? (
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm text-status-missing">
              Delete <strong>{team.name}</strong> and all of its submissions and
              files? This cannot be undone.
            </p>
            <form action={deleteTeam}>
              <input type="hidden" name="teamId" value={team.id} />
              <Button type="submit" variant="destructive" size="sm">
                Yes, delete
              </Button>
            </form>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConfirming(false)}
            >
              Cancel
            </Button>
          </div>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setConfirming(true)}
            className="text-muted-foreground"
          >
            <Trash2 className="size-3.5" aria-hidden="true" />
            Delete team
          </Button>
        )}
      </div>
    </div>
  );
}
