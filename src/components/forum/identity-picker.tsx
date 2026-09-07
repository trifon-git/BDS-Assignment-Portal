"use client";

import { useCallback, useSyncExternalStore } from "react";

import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import type { Student } from "@/db/schema";

const storageKey = (teamId: number) => `aau_forum_identity:${teamId}`;

function readStored(teamId: number): string {
  try {
    return localStorage.getItem(storageKey(teamId)) ?? "";
  } catch {
    // Private mode / blocked storage: behaves as if nothing were remembered.
    return "";
  }
}

function writeStored(teamId: number, value: string): void {
  try {
    localStorage.setItem(storageKey(teamId), value);
  } catch {
    // Same fallback: the selection still works for this submission, it just
    // will not be remembered next time.
  }
}

const noopSubscribe = () => () => {};

/**
 * "Choose your name" for the forum, remembered in this browser.
 *
 * This is a convenience only — the server re-derives the team from the link
 * and re-checks membership on every post (see forum-actions.ts), so a value
 * read back from here can never name anyone outside the team it was saved
 * for. It is `localStorage`, not a cookie, so it never rides along on a
 * request and can never be mistaken for an auth token: nothing server-side
 * ever reads this key.
 *
 * `useSyncExternalStore` rather than an effect: this is exactly what it is
 * for (reading an external store on mount), and it is the one hook React
 * guarantees produces the server-matching value on the first client render
 * with no separate "did we hydrate yet" state to manage by hand.
 */
export function IdentityPicker({
  teamId,
  members,
  id,
}: {
  teamId: number;
  members: Student[];
  id: string;
}) {
  const getSnapshot = useCallback(() => readStored(teamId), [teamId]);
  const getServerSnapshot = useCallback(() => "", []);
  const stored = useSyncExternalStore(noopSubscribe, getSnapshot, getServerSnapshot);

  // Only trust a remembered id that still names a member of this team.
  const selected = members.some((m) => String(m.id) === stored) ? stored : "";

  return (
    <div className="space-y-1">
      <Label htmlFor={id}>Your name</Label>
      <NativeSelect
        id={id}
        name="authorStudentId"
        required
        defaultValue={selected}
        onChange={(e) => writeStored(teamId, e.target.value)}
        className="max-w-xs"
      >
        <option value="" disabled>
          Choose your name…
        </option>
        {members.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </NativeSelect>
    </div>
  );
}
