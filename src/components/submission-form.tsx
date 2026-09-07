"use client";

import { useState } from "react";
import { Loader2, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import type { Student } from "@/db/schema";
import { cn } from "@/lib/utils";

/**
 * The delivery form.
 *
 * It is a plain HTML form posting multipart data to a route handler, not a
 * Server Action — actions cap the body at a couple of megabytes. The only
 * JavaScript here is comfort: a file list, a size warning, and a pending state.
 * With the bundle blocked or still loading, the form still submits.
 */
export function SubmissionForm({
  action,
  members,
  studentId,
  requiresFiles,
  requiresVideo,
  allowedExtensions,
  maxFileSizeMb,
  hasExisting,
  existingVideoUrl,
  existingNote,
  willBeLate,
  className,
}: {
  action: string;
  members: Student[];
  studentId: number | null;
  requiresFiles: boolean;
  requiresVideo: boolean;
  allowedExtensions: string;
  maxFileSizeMb: number;
  hasExisting: boolean;
  existingVideoUrl: string;
  existingNote: string;
  willBeLate: boolean;
  className?: string;
}) {
  const [pending, setPending] = useState(false);
  const [chosen, setChosen] = useState<File[]>([]);

  const accept = allowedExtensions
    .split(",")
    .map((e) => `.${e.trim().replace(/^\./, "")}`)
    .filter((e) => e.length > 1)
    .join(",");

  const oversized = chosen.filter((f) => f.size > maxFileSizeMb * 1024 * 1024);

  return (
    <form
      action={action}
      method="post"
      encType="multipart/form-data"
      onSubmit={() => setPending(true)}
      className={cn("space-y-5 border-t pt-5", className)}
    >
      <p className="text-sm font-medium">
        {hasExisting ? "Replace this delivery" : "Deliver"}
      </p>

      {/* Solo assignments carry the member id; team assignments omit it. */}
      {studentId != null ? (
        <input type="hidden" name="studentId" value={studentId} />
      ) : null}

      {/* -- who ------------------------------------------------------------- */}
      <div className="space-y-2">
        <Label htmlFor={`submittedBy-${studentId ?? "team"}`}>
          Submitted by
        </Label>
        <NativeSelect
          id={`submittedBy-${studentId ?? "team"}`}
          name="submittedBy"
          required
          defaultValue={studentId ?? ""}
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
        <p className="text-xs text-muted-foreground">
          Recorded with the delivery so we know who handed it in.
        </p>
      </div>

      {/* -- files ------------------------------------------------------------ */}
      {requiresFiles ? (
        <div className="space-y-2">
          <Label htmlFor={`files-${studentId ?? "team"}`}>
            Files{" "}
            <span className="font-normal text-muted-foreground">
              ({allowedExtensions.replace(/,/g, ", ")} — max {maxFileSizeMb} MB
              each)
            </span>
          </Label>
          <Input
            id={`files-${studentId ?? "team"}`}
            name="files"
            type="file"
            multiple
            accept={accept || undefined}
            required={!hasExisting}
            onChange={(e) => setChosen(Array.from(e.target.files ?? []))}
            className="h-auto py-2 file:mr-3 file:rounded file:border-0 file:bg-secondary file:px-3 file:py-1.5 file:text-sm file:font-medium"
          />

          {chosen.length > 0 ? (
            <ul className="space-y-1 text-xs text-muted-foreground">
              {chosen.map((f) => (
                <li key={f.name} className="flex justify-between gap-3">
                  <span className="min-w-0 truncate font-mono">{f.name}</span>
                  <span
                    className={
                      f.size > maxFileSizeMb * 1024 * 1024
                        ? "font-medium text-status-missing"
                        : ""
                    }
                  >
                    {(f.size / 1024 / 1024).toFixed(1)} MB
                  </span>
                </li>
              ))}
            </ul>
          ) : null}

          {oversized.length > 0 ? (
            <p role="alert" className="text-xs font-medium text-status-missing">
              {oversized.length === 1 ? "That file is" : "Those files are"} over
              the {maxFileSizeMb} MB limit and will be rejected.
            </p>
          ) : null}

          {hasExisting ? (
            <label className="flex items-start gap-2 pt-1 text-sm">
              <Checkbox name="keepExistingFiles" className="mt-0.5" />
              <span className="text-muted-foreground">
                Keep the files already delivered and add these alongside them.
                Leave this unticked to replace them.
              </span>
            </label>
          ) : null}
        </div>
      ) : null}

      {/* -- video ------------------------------------------------------------ */}
      {requiresVideo ? (
        <div className="space-y-2">
          <Label htmlFor={`videoUrl-${studentId ?? "team"}`}>Video link</Label>
          <Input
            id={`videoUrl-${studentId ?? "team"}`}
            name="videoUrl"
            type="url"
            inputMode="url"
            required
            defaultValue={existingVideoUrl}
            placeholder="https://aaudk.cloud.panopto.eu/Panopto/Pages/Viewer.aspx?id=…"
          />
          <p className="text-xs text-muted-foreground">
            Record it in <strong>Panopto</strong> — that is the tool AAU
            supports. Open your recording, choose <em>Share</em>, and copy the
            link. A OneDrive or Teams link works too.
          </p>

          <label className="flex items-start gap-2 pt-1 text-sm">
            <Checkbox
              name="videoShareConfirmed"
              required
              className="mt-0.5"
            />
            <span className="text-muted-foreground">
              I have set the sharing so AAU staff can watch it. Panopto
              recordings are private by default, and a link nobody can open
              counts as not delivered.
            </span>
          </label>
        </div>
      ) : null}

      {/* -- note ------------------------------------------------------------- */}
      <div className="space-y-2">
        <Label htmlFor={`note-${studentId ?? "team"}`}>
          Note{" "}
          <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
        <Textarea
          id={`note-${studentId ?? "team"}`}
          name="note"
          rows={2}
          defaultValue={existingNote}
          placeholder="Anything the reviewer should know."
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              Uploading…
            </>
          ) : (
            <>
              <Upload className="size-4" aria-hidden="true" />
              {hasExisting ? "Replace delivery" : "Deliver"}
            </>
          )}
        </Button>
        {willBeLate ? (
          <span className="text-sm font-medium text-status-late">
            This will be recorded as late.
          </span>
        ) : null}
      </div>

      {pending ? (
        <p className="text-xs text-muted-foreground">
          Large files can take a while. Don&rsquo;t close this tab.
        </p>
      ) : null}
    </form>
  );
}
