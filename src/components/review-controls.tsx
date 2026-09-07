"use client";

import { useState } from "react";
import { CheckCircle2, Mail, MessageSquarePlus, RotateCcw } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { reviewSubmission } from "@/lib/admin-actions";
import type { Assignment, SubmissionStatus } from "@/db/schema";
import { feedbackEmail, mailtoHref } from "@/lib/mailto";

/**
 * Approve, send back, or just leave a comment on one submission.
 *
 * Approving is one click; asking for rework or adding a plain comment both
 * open the same box first, because feedback with no text is the version of
 * this feature that generates confused emails instead of preventing them.
 * The comment appears on the team's own dashboard regardless of status — it
 * used to be visible only alongside "needs rework", which quietly hid an
 * approved-with-a-note delivery from the team that received it.
 */
export function ReviewControls({
  submissionId,
  status,
  comment,
  assignment,
  teamName,
  emails,
  courseCode,
}: {
  submissionId: number;
  status: SubmissionStatus;
  comment: string;
  assignment: Pick<Assignment, "title" | "weekNumber">;
  teamName: string;
  emails: string[];
  courseCode: string;
}) {
  const [open, setOpen] = useState(Boolean(comment));
  const [draft, setDraft] = useState(comment);

  let mailto: string | null = null;
  if (draft.trim() && emails.length > 0) {
    const { subject, body } = feedbackEmail({
      courseCode,
      assignment,
      team: { name: teamName },
      comment: draft,
    });
    mailto = mailtoHref(emails, subject, body);
  }

  return (
    <div className="rounded-md border bg-muted/40 p-3">
      {status !== "submitted" ? (
        <p className="mb-3 text-xs font-medium text-muted-foreground">
          {status === "approved"
            ? "You approved this."
            : "You asked for rework."}
        </p>
      ) : null}

      <form action={reviewSubmission} className="space-y-3">
        <input type="hidden" name="submissionId" value={submissionId} />

        {open ? (
          <div className="space-y-2">
            <label
              htmlFor={`comment-${submissionId}`}
              className="text-xs font-medium"
            >
              Feedback — the team sees this, whatever the status.
            </label>
            <Textarea
              id={`comment-${submissionId}`}
              name="reviewComment"
              rows={2}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="The video doesn't cover the feature selection step — please re-record that part."
            />
          </div>
        ) : (
          <input type="hidden" name="reviewComment" value={comment} />
        )}

        <div className="flex flex-wrap gap-2">
          <Button
            type="submit"
            name="status"
            value="approved"
            variant={status === "approved" ? "secondary" : "outline"}
            size="sm"
          >
            <CheckCircle2 className="size-3.5" aria-hidden="true" />
            Approve
          </Button>

          {open ? (
            <Button type="submit" name="status" value="rework" size="sm">
              <RotateCcw className="size-3.5" aria-hidden="true" />
              Send back with this comment
            </Button>
          ) : (
            <Button
              type="button"
              variant={status === "rework" ? "secondary" : "outline"}
              size="sm"
              onClick={() => setOpen(true)}
            >
              <RotateCcw className="size-3.5" aria-hidden="true" />
              Needs rework
            </Button>
          )}

          {open ? (
            // No name="status" here — reviewSubmission leaves the status
            // untouched when none is submitted, so this saves the comment
            // alone, on a delivery that is otherwise fine as it stands.
            <Button type="submit" size="sm" variant="outline">
              <MessageSquarePlus className="size-3.5" aria-hidden="true" />
              Save feedback
            </Button>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setOpen(true)}
            >
              <MessageSquarePlus className="size-3.5" aria-hidden="true" />
              Add feedback
            </Button>
          )}

          {status !== "submitted" ? (
            <Button
              type="submit"
              name="status"
              value="submitted"
              variant="ghost"
              size="sm"
            >
              Clear
            </Button>
          ) : null}
        </div>
      </form>

      {open && mailto ? (
        <a
          href={mailto}
          className={buttonVariants({ variant: "ghost", size: "sm", className: "mt-2" })}
        >
          <Mail className="size-3.5" aria-hidden="true" />
          Email this to the team
        </a>
      ) : null}
    </div>
  );
}
