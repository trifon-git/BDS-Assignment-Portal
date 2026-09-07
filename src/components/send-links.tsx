"use client";

import { useState } from "react";
import { Check, Copy, Mail } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import type { TeamWithMembers } from "@/lib/admin-data";
import { cn } from "@/lib/utils";

/**
 * Every team's link in one place, for when there are too many to email one at
 * a time by hand.
 *
 * `mailto:` cannot carry a different body per recipient, so "send everything"
 * is honestly two things: a paste-ready export for a spreadsheet or an LMS
 * announcement, and a row of one-click per-team mailto buttons to fire in
 * sequence. Neither pretends to be a single button that emails the class.
 */
export function SendLinks({
  teams,
  className,
}: {
  teams: TeamWithMembers[];
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const withLink = teams.map(({ team, members }) => ({
    team,
    members,
    link:
      typeof window === "undefined"
        ? `/t/${team.accessToken}`
        : `${window.location.origin}/t/${team.accessToken}`,
  }));

  async function copyAll() {
    const rows = withLink.map(({ team, members, link }) =>
      [team.name, team.shortCode, link, members.map((m) => m.email).join(", ")].join(
        "\t",
      ),
    );
    try {
      await navigator.clipboard.writeText(rows.join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  if (teams.length === 0) return null;

  if (!open) {
    return (
      <Button variant="outline" size="lg" onClick={() => setOpen(true)}>
        <Mail className="size-4" aria-hidden="true" />
        Send team links…
      </Button>
    );
  }

  return (
    <div className={cn("w-full rounded-lg border bg-card p-4", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">Send each team its link</p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={copyAll}>
            {copied ? (
              <>
                <Check className="size-3.5" aria-hidden="true" />
                Copied
              </>
            ) : (
              <>
                <Copy className="size-3.5" aria-hidden="true" />
                Copy all links
              </>
            )}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
            Close
          </Button>
        </div>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Copy all links as a paste-ready table (team, code, link, emails), or
        email one team at a time below.
      </p>
      <ul className="mt-3 divide-y rounded-md border">
        {withLink.map(({ team, members, link }) => {
          const mailto = `mailto:${members.map((m) => m.email).join(",")}?subject=${encodeURIComponent(
            `${team.name} — your group link`,
          )}&body=${encodeURIComponent(
            `Hi ${team.name},\n\nHere is your team's link for this assignment:\n${link}\n\nShort code: ${team.shortCode}`,
          )}`;
          return (
            <li
              key={team.id}
              className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
            >
              <span className="min-w-0">
                <span className="block text-sm font-medium">{team.name}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {members.length === 0
                    ? "No members yet"
                    : members.map((m) => m.name).join(", ")}
                </span>
              </span>
              {members.length > 0 ? (
                <a
                  href={mailto}
                  className={buttonVariants({ variant: "outline", size: "sm" })}
                >
                  <Mail className="size-3.5" aria-hidden="true" />
                  Email
                </a>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
