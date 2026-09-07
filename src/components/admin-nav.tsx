"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

const TABS = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/assignments", label: "Assignments" },
  { href: "/admin/teams", label: "Teams" },
  { href: "/admin/students", label: "Students" },
  { href: "/admin/settings", label: "Settings" },
] as const;

/** `notificationCount` badges the Overview tab — the only one with a feed. */
export function AdminNav({ notificationCount = 0 }: { notificationCount?: number }) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Admin sections"
      className="mx-auto max-w-7xl overflow-x-auto px-4 sm:px-6"
    >
      <ul className="flex gap-1">
        {TABS.map((tab) => {
          // "/admin" would otherwise match every child route.
          const active =
            tab.href === "/admin"
              ? pathname === "/admin"
              : pathname.startsWith(tab.href);

          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-medium whitespace-nowrap transition-colors",
                  active
                    ? "border-white text-white"
                    : "border-transparent text-white/70 hover:border-white/40 hover:text-white",
                )}
              >
                {tab.label}
                {tab.href === "/admin" && notificationCount > 0 ? (
                  <span
                    className="inline-flex min-w-4.5 items-center justify-center rounded-full bg-status-late px-1 text-[0.65rem] leading-4 font-semibold text-white tabular-nums"
                    aria-label={`${notificationCount} new since your last visit`}
                  >
                    {notificationCount > 99 ? "99+" : notificationCount}
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
