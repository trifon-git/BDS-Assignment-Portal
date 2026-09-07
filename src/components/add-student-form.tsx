"use client";

import { useState } from "react";
import { UserPlus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * Add a single student.
 *
 * The bulk paste handles the start of term. This is for the one person who
 * turns up afterwards, where opening a spreadsheet to re-paste the whole class
 * would be absurd.
 */
export function AddStudentForm({
  action,
  className,
}: {
  action: (formData: FormData) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <div className={className}>
        <Button variant="outline" onClick={() => setOpen(true)}>
          <UserPlus className="size-4" aria-hidden="true" />
          Add one student
        </Button>
      </div>
    );
  }

  return (
    <form
      action={action}
      className={cn(
        "flex max-w-2xl flex-wrap items-end gap-3 rounded-lg border bg-card p-4",
        className,
      )}
    >
      <div className="min-w-48 flex-1 space-y-2">
        <Label htmlFor="student-name">Name</Label>
        <Input id="student-name" name="name" required maxLength={120} />
      </div>
      <div className="min-w-56 flex-1 space-y-2">
        <Label htmlFor="student-email">Email</Label>
        <Input
          id="student-email"
          name="email"
          type="email"
          required
          maxLength={160}
          placeholder="name@student.aau.dk"
        />
      </div>
      <div className="flex gap-2">
        <Button type="submit">Add</Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
