"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import type { Assignment, TeamGrouping } from "@/db/schema";
import { toDateTimeLocal } from "@/lib/format";

/**
 * Create or edit an assignment.
 *
 * The requirement toggles are the point of this screen: team or solo, files
 * and/or a video, which extensions, how large, and whether late deliveries are
 * still accepted. Everything a student's page does is driven from here.
 */
export function AssignmentForm({
  action,
  assignment,
  defaultMaxFileSizeMb,
  error,
}: {
  action: (formData: FormData) => void;
  assignment?: Assignment;
  defaultMaxFileSizeMb: number;
  error?: string | null;
}) {
  const [requiresFiles, setRequiresFiles] = useState(
    assignment?.requiresFiles ?? true,
  );
  const [requiresVideo, setRequiresVideo] = useState(
    assignment?.requiresVideo ?? false,
  );
  const [mode, setMode] = useState(assignment?.mode ?? "team");
  const [grouping, setGrouping] = useState<TeamGrouping>(
    assignment?.grouping ?? "copy",
  );

  // A sensible default deadline: next Friday at 23:59, which is what a weekly
  // assignment almost always wants.
  const defaultDue = assignment
    ? toDateTimeLocal(assignment.dueAt)
    : toDateTimeLocal(nextFridayLate());

  return (
    <form action={action} className="mt-6 max-w-2xl space-y-6">
      {assignment ? (
        <input type="hidden" name="id" value={assignment.id} />
      ) : null}

      {error ? (
        <p
          role="alert"
          className="rounded-lg bg-status-missing-bg p-4 text-sm font-medium text-status-missing"
        >
          {error}
        </p>
      ) : null}

      <div className="space-y-2">
        <Label htmlFor="title">Title</Label>
        <Input
          id="title"
          name="title"
          required
          maxLength={200}
          defaultValue={assignment?.title}
          placeholder="Week 5 — Model deployment"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="weekNumber">
            Week{" "}
            <span className="font-normal text-muted-foreground">
              (optional)
            </span>
          </Label>
          <Input
            id="weekNumber"
            name="weekNumber"
            type="number"
            min={1}
            max={52}
            defaultValue={assignment?.weekNumber ?? ""}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="mode">Delivered by</Label>
          <NativeSelect
            id="mode"
            name="mode"
            value={mode}
            onChange={(e) => setMode(e.target.value as "team" | "solo")}
          >
            <option value="team">The team — one delivery per group</option>
            <option value="solo">Each student individually</option>
          </NativeSelect>
          <p className="text-xs text-muted-foreground">
            {mode === "team"
              ? "Any member can deliver on behalf of the group."
              : "Every student delivers their own, from inside their team page."}
          </p>
        </div>

        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="grouping">Teams for this assignment</Label>
          <NativeSelect
            id="grouping"
            name="grouping"
            value={grouping}
            onChange={(e) => setGrouping(e.target.value as TeamGrouping)}
          >
            <option value="copy">
              Copy the previous assignment&rsquo;s groups
            </option>
            <option value="students">Students form their own</option>
            <option value="admin">I assign them</option>
          </NativeSelect>
          <p className="text-xs text-muted-foreground">
            {grouping === "copy"
              ? "Use Copy teams from… on the Teams screen to bring last week's groups across. They get new links and codes."
              : grouping === "students"
                ? "Students group themselves from the front page. Nobody can deliver until they have."
                : "Only you create and fill the teams, on the Teams screen."}{" "}
            Groups belong to this assignment, so a team&rsquo;s code opens this
            one and nothing else.
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="description">Requirements</Label>
        <Textarea
          id="description"
          name="description"
          rows={6}
          defaultValue={assignment?.description}
          placeholder={
            "What the students have to do.\n\nBlank lines become paragraphs."
          }
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="dueAt">Deadline</Label>
        <Input
          id="dueAt"
          name="dueAt"
          type="datetime-local"
          required
          defaultValue={defaultDue}
          className="w-auto"
        />
        <p className="text-xs text-muted-foreground">
          Danish time (Europe/Copenhagen).
        </p>
      </div>

      <fieldset className="space-y-4 rounded-lg border p-4">
        <legend className="px-1 text-sm font-medium">What to deliver</legend>

        <label className="flex items-start gap-3">
          <Checkbox
            name="requiresFiles"
            checked={requiresFiles}
            onCheckedChange={(c) => setRequiresFiles(Boolean(c))}
            className="mt-0.5"
          />
          <span className="text-sm">
            <span className="font-medium">Files</span>
            <span className="block text-muted-foreground">
              Code, a report, whatever the week calls for.
            </span>
          </span>
        </label>

        {requiresFiles ? (
          <div className="grid gap-4 pl-7 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="allowedExtensions">Accepted types</Label>
              <Input
                id="allowedExtensions"
                name="allowedExtensions"
                defaultValue={assignment?.allowedExtensions ?? "zip,pdf"}
                placeholder="zip,pdf"
              />
              <p className="text-xs text-muted-foreground">
                Comma-separated. Leave empty to accept anything.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="maxFileSizeMb">Max size per file (MB)</Label>
              <Input
                id="maxFileSizeMb"
                name="maxFileSizeMb"
                type="number"
                min={1}
                max={2000}
                defaultValue={
                  assignment?.maxFileSizeMb ?? defaultMaxFileSizeMb
                }
              />
            </div>
          </div>
        ) : null}

        <label className="flex items-start gap-3">
          <Checkbox
            name="requiresVideo"
            checked={requiresVideo}
            onCheckedChange={(c) => setRequiresVideo(Boolean(c))}
            className="mt-0.5"
          />
          <span className="text-sm">
            <span className="font-medium">A video link</span>
            <span className="block text-muted-foreground">
              A recording where they explain what they did. Students are pointed
              at Panopto and asked to confirm they have set sharing.
            </span>
          </span>
        </label>

        {!requiresFiles && !requiresVideo ? (
          <p className="text-sm font-medium text-status-missing">
            Pick at least one — otherwise there is nothing to deliver.
          </p>
        ) : null}
      </fieldset>

      <fieldset className="space-y-4 rounded-lg border p-4">
        <legend className="px-1 text-sm font-medium">Deadline handling</legend>

        <label className="flex items-start gap-3">
          <Checkbox
            name="acceptLate"
            defaultChecked={assignment?.acceptLate ?? true}
            className="mt-0.5"
          />
          <span className="text-sm">
            <span className="font-medium">Accept late deliveries</span>
            <span className="block text-muted-foreground">
              The form stays open after the deadline and anything arriving late
              is flagged. Untick to close it hard at the deadline.
            </span>
          </span>
        </label>
      </fieldset>

      <fieldset className="space-y-4 rounded-lg border p-4">
        <legend className="px-1 text-sm font-medium">Visibility</legend>

        <label className="flex items-start gap-3">
          <Checkbox
            name="published"
            defaultChecked={Boolean(assignment?.publishedAt)}
            className="mt-0.5"
          />
          <span className="text-sm">
            <span className="font-medium">Published to students</span>
            <span className="block text-muted-foreground">
              Unpublished assignments are invisible on the student pages, even by
              direct link. Leave this off while you are still writing it.
            </span>
          </span>
        </label>
      </fieldset>

      <div className="flex gap-3">
        <Button type="submit" size="lg">
          {assignment ? "Save changes" : "Create assignment"}
        </Button>
      </div>
    </form>
  );
}

/** Next Friday, 23:59 local. */
function nextFridayLate(): number {
  const d = new Date();
  const daysUntilFriday = (5 - d.getDay() + 7) % 7 || 7;
  d.setDate(d.getDate() + daysUntilFriday);
  d.setHours(23, 59, 0, 0);
  return d.getTime();
}
