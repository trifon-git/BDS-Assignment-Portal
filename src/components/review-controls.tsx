"use client";

import { useState } from "react";
import { CheckCircle2, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { reviewSubmission } from "@/lib/admin-actions";
import type { SubmissionStatus } from "@/db/schema";

/**
 * Approve or send back one submission.
 *
 * Approving is one click; asking for rework opens a comment box first, because
 * "needs rework" with no explanation is the version of this feature that
 * generates emails instead of preventing them. The comment appears on the
 * team's own dashboard.
 */
export function ReviewControls({
  submissionId,
  status,
  comment,
}: {
  submissionId: number;
  status: SubmissionStatus;
  comment: string;
}) {
  const [open, setOpen] = useState(status === "rework" && Boolean(comment));

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
              What needs fixing? The team sees this.
            </label>
            <Textarea
              id={`comment-${submissionId}`}
              name="reviewComment"
              rows={2}
              defaultValue={comment}
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
    </div>
  );
}
