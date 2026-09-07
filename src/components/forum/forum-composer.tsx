"use client";

import { useState } from "react";
import { Send } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { Student } from "@/db/schema";
import { IdentityPicker } from "./identity-picker";

/**
 * The post/reply box. `parentId` is omitted for a new top-level thread and set
 * for a reply — the server flattens a reply-to-a-reply onto its root, so this
 * component never needs to know how deep it actually is.
 */
export function ForumComposer({
  action,
  token,
  teamId,
  members,
  parentId,
  placeholder = "Write a message…",
  compact = false,
}: {
  action: (formData: FormData) => void;
  token: string;
  teamId: number;
  members: Student[];
  parentId?: number;
  placeholder?: string;
  compact?: boolean;
}) {
  const [pending, setPending] = useState(false);

  return (
    <form
      action={action}
      onSubmit={() => setPending(true)}
      className="space-y-2"
    >
      <input type="hidden" name="token" value={token} />
      {parentId != null ? (
        <input type="hidden" name="parentId" value={parentId} />
      ) : null}

      <div className={compact ? "flex gap-2" : "space-y-2"}>
        <IdentityPicker
          teamId={teamId}
          members={members}
          id={`author-${parentId ?? "root"}`}
        />
        <Textarea
          name="body"
          required
          rows={compact ? 2 : 3}
          maxLength={4000}
          placeholder={placeholder}
          className="flex-1"
        />
      </div>

      <Button type="submit" size="sm" disabled={pending}>
        <Send className="size-3.5" aria-hidden="true" />
        {parentId != null ? "Reply" : "Post"}
      </Button>
    </form>
  );
}
