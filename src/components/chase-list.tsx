"use client";

import { useState } from "react";
import { Check, Copy, Mail } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The chase list: every address behind an outstanding delivery, ready to paste
 * into an email. This is the thing a teacher actually wants at 09:00 on Monday,
 * and it is two clicks from the overview.
 */
export function ChaseList({
  emails,
  className,
}: {
  emails: string[];
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const joined = emails.join(", ");

  async function copy() {
    try {
      await navigator.clipboard.writeText(joined);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-4 gap-y-3 rounded-lg border bg-status-late-bg/40 p-4",
        className,
      )}
    >
      <Mail className="size-5 shrink-0 text-status-late" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">
          {emails.length} {emails.length === 1 ? "person" : "people"} to chase
        </p>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {joined}
        </p>
      </div>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={copy}>
          {copied ? (
            <>
              <Check className="size-3.5" aria-hidden="true" />
              Copied
            </>
          ) : (
            <>
              <Copy className="size-3.5" aria-hidden="true" />
              Copy addresses
            </>
          )}
        </Button>
        {/* BCC rather than To: the class should not see each other's misses. */}
        <a
          href={`mailto:?bcc=${encodeURIComponent(joined)}`}
          className={buttonVariants({ size: "sm" })}
        >
          Open in email
        </a>
      </div>
    </div>
  );
}
