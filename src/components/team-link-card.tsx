"use client";

import { useState } from "react";
import { Bookmark, Check, Copy, ShieldAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The "this page is your key, keep it" card.
 *
 * Since there is no login, a student who loses this URL has to ask a teammate
 * or the course responsible, so the page says plainly what it is and makes it
 * one click to copy.
 */
export function TeamLinkCard({
  shortCode,
  supportEmail,
  className,
}: {
  shortCode: string;
  supportEmail: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be blocked; the URL is visible in the bar anyway.
      setCopied(false);
    }
  }

  return (
    <div
      className={cn(
        "rounded-lg border border-aau-200 bg-aau-50/60 p-4",
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <Bookmark
          className="size-5 shrink-0 text-aau-600"
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">
            Bookmark this page — it is how your team gets back in
          </p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Or enter the code{" "}
            <span className="font-mono font-medium text-foreground">
              {shortCode}
            </span>{" "}
            on the front page.{" "}
            <strong className="font-medium text-foreground">
              Every member should save it
            </strong>{" "}
            — not just whoever opened it first.
          </p>
        </div>
        <Button variant="outline" size="lg" onClick={copy}>
          {copied ? (
            <>
              <Check className="size-4" aria-hidden="true" />
              Copied
            </>
          ) : (
            <>
              <Copy className="size-4" aria-hidden="true" />
              Copy link
            </>
          )}
        </Button>
      </div>

      {/* The link is the credential. Students who understand that keep it out
          of public channels; students who don't, don't. */}
      <p className="mt-3 flex items-start gap-2 border-t border-aau-200 pt-3 text-xs text-muted-foreground">
        <ShieldAlert
          className="mt-0.5 size-4 shrink-0 text-aau-600"
          aria-hidden="true"
        />
        <span>
          Treat this link like a password: anyone who has it can deliver and
          replace files as your team. Keep it within your group. If it stops
          working or you think someone else has it, email{" "}
          <a
            href={`mailto:${supportEmail}?subject=BDS%20assignment%20delivery%20-%20team%20link`}
            className="font-medium text-aau-700 underline underline-offset-2"
          >
            {supportEmail}
          </a>{" "}
          before the deadline and a new one will be issued.
        </span>
      </p>
    </div>
  );
}
