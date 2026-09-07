"use client";

import { useState } from "react";
import { Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { parseRoster } from "@/lib/roster";
import { cn } from "@/lib/utils";

/**
 * Paste-in roster import with a live preview.
 *
 * The preview runs the same parser the server will, so what the teacher sees
 * before pressing the button is exactly what gets stored — including the names
 * guessed from bare email addresses, which they can then fix in the text box
 * rather than discovering afterwards.
 */
export function RosterImport({
  action,
  className,
}: {
  action: (formData: FormData) => void;
  className?: string;
}) {
  const [text, setText] = useState("");
  const parsed = text.trim() ? parseRoster(text) : [];

  async function handleFile(file: File | undefined) {
    if (!file) return;
    const contents = await file.text();
    setText((prev) => (prev.trim() ? `${prev.trimEnd()}\n${contents}` : contents));
  }

  return (
    <form
      action={action}
      className={cn("max-w-2xl space-y-3 rounded-lg border bg-card p-4", className)}
    >
      <Label htmlFor="roster">Import the class list</Label>
      <div className="space-y-1">
        <Label htmlFor="roster-file" className="text-xs font-normal text-muted-foreground">
          Upload a .csv or .txt file, or paste below
        </Label>
        <input
          id="roster-file"
          type="file"
          accept=".csv,.txt,text/csv,text/plain"
          onChange={(e) => {
            void handleFile(e.target.files?.[0]);
            e.target.value = "";
          }}
          className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border file:bg-background file:px-3 file:py-1.5 file:text-sm file:font-medium hover:file:bg-muted"
        />
      </div>
      <Textarea
        id="roster"
        name="roster"
        rows={6}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={
          "Amalie Sørensen,amalie.soerensen@student.aau.dk\n" +
          "Mikkel Jensen;mikkel.jensen@student.aau.dk\n" +
          '"Sofia Rossi" <sofia.rossi@student.aau.dk>'
        }
        className="font-mono text-xs"
      />
      <p className="text-xs text-muted-foreground">
        One student per line. Commas, semicolons, or angle brackets all work, and
        an address on its own is fine. Re-importing the same list is safe —
        anyone already on it is left alone.
      </p>

      {parsed.length > 0 ? (
        <div className="rounded-md border">
          <p className="border-b px-3 py-2 text-xs font-medium">
            {parsed.length} student{parsed.length === 1 ? "" : "s"} found
          </p>
          <ul className="max-h-48 divide-y overflow-y-auto text-sm">
            {parsed.slice(0, 50).map((p) => (
              <li key={p.email} className="flex justify-between gap-3 px-3 py-1.5">
                <span>{p.name}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {p.email}
                </span>
              </li>
            ))}
          </ul>
          {parsed.length > 50 ? (
            <p className="border-t px-3 py-1.5 text-xs text-muted-foreground">
              +{parsed.length - 50} more
            </p>
          ) : null}
        </div>
      ) : text.trim() ? (
        <p className="text-sm font-medium text-status-late">
          No email addresses found in that text.
        </p>
      ) : null}

      <Button type="submit" size="lg" disabled={parsed.length === 0}>
        <Upload className="size-4" aria-hidden="true" />
        Import {parsed.length > 0 ? `${parsed.length} student(s)` : ""}
      </Button>
    </form>
  );
}
