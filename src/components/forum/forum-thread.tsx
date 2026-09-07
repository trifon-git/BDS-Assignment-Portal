"use client";

import { useState } from "react";
import { Pencil, Reply as ReplyIcon, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { ForumMessage } from "@/db/schema";
import type { Student } from "@/db/schema";
import type { ForumNode } from "@/lib/forum";
import { formatDeadline } from "@/lib/format";
import { ForumComposer } from "./forum-composer";

/**
 * A team's whole board: one composer for a new thread, then every top-level
 * message with its (flattened, one-level) replies underneath.
 *
 * `readOnly` is what the admin view sets — same component, same rendering, so
 * an admin reading a team's board never sees something different from what
 * the team itself sees, deleted messages included (shown greyed out rather
 * than hidden, which is the point of a soft delete).
 */
export function ForumThread({
  nodes,
  token,
  teamId,
  members,
  postAction = () => {},
  editAction = () => {},
  deleteAction = () => {},
  readOnly = false,
}: {
  nodes: ForumNode[];
  token: string;
  teamId: number;
  members: Student[];
  /** Required unless readOnly — the admin view passes none of these. */
  postAction?: (formData: FormData) => void;
  editAction?: (formData: FormData) => void;
  deleteAction?: (formData: FormData) => void;
  readOnly?: boolean;
}) {
  const [replyingTo, setReplyingTo] = useState<number | null>(null);

  return (
    <div className="space-y-4">
      {readOnly ? null : (
        <ForumComposer
          action={postAction}
          token={token}
          teamId={teamId}
          members={members}
          placeholder="Start a new thread…"
        />
      )}

      {nodes.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No messages yet. Be the first to say something.
        </p>
      ) : (
        <ul className="space-y-3">
          {nodes.map((node) => (
            <li key={node.message.id} className="rounded-lg border bg-card p-3">
              <Message
                message={node.message}
                token={token}
                editAction={editAction}
                deleteAction={deleteAction}
                readOnly={readOnly}
              />

              {node.replies.length > 0 ? (
                <ul className="mt-3 ml-4 space-y-3 border-l pl-3">
                  {node.replies.map((reply) => (
                    <li key={reply.id}>
                      <Message
                        message={reply}
                        token={token}
                        editAction={editAction}
                        deleteAction={deleteAction}
                        readOnly={readOnly}
                      />
                    </li>
                  ))}
                </ul>
              ) : null}

              {readOnly ? null : (
                <div className="mt-2">
                  {replyingTo === node.message.id ? (
                    <div className="ml-4">
                      <ForumComposer
                        action={postAction}
                        token={token}
                        teamId={teamId}
                        members={members}
                        parentId={node.message.id}
                        placeholder="Reply…"
                        compact
                      />
                    </div>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-muted-foreground"
                      onClick={() => setReplyingTo(node.message.id)}
                    >
                      <ReplyIcon className="size-3.5" aria-hidden="true" />
                      Reply
                    </Button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Message({
  message,
  token,
  editAction,
  deleteAction,
  readOnly,
}: {
  message: ForumMessage;
  token: string;
  editAction: (formData: FormData) => void;
  deleteAction: (formData: FormData) => void;
  readOnly: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  if (message.deletedAt) {
    return (
      <p className="text-sm text-muted-foreground italic">
        Message deleted — {message.authorName}, {formatDeadline(message.createdAt)}
      </p>
    );
  }

  if (editing) {
    return (
      <form
        action={editAction}
        onSubmit={() => setEditing(false)}
        className="space-y-2"
      >
        <input type="hidden" name="token" value={token} />
        <Textarea
          name="body"
          defaultValue={message.body}
          rows={3}
          maxLength={4000}
          required
        />
        <input type="hidden" name="messageId" value={message.id} />
        <div className="flex gap-2">
          <Button type="submit" size="sm">
            Save
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setEditing(false)}
          >
            Cancel
          </Button>
        </div>
      </form>
    );
  }

  return (
    <div>
      <p className="flex flex-wrap items-baseline gap-x-2 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{message.authorName}</span>
        <span>{formatDeadline(message.createdAt)}</span>
        {message.editedAt ? <span>(edited)</span> : null}
      </p>
      <p className="mt-1 text-sm whitespace-pre-wrap">{message.body}</p>

      {readOnly ? null : (
        <div className="mt-1 flex gap-1">
          {confirmingDelete ? (
            <>
              <span className="text-xs text-status-missing">Delete this message?</span>
              <form action={deleteAction}>
                <input type="hidden" name="token" value={token} />
                <input type="hidden" name="messageId" value={message.id} />
                <Button type="submit" variant="destructive" size="sm">
                  Yes
                </Button>
              </form>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setConfirmingDelete(false)}
              >
                Cancel
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                onClick={() => setEditing(true)}
              >
                <Pencil className="size-3" aria-hidden="true" />
                Edit
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                onClick={() => setConfirmingDelete(true)}
              >
                <Trash2 className="size-3" aria-hidden="true" />
                Delete
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
