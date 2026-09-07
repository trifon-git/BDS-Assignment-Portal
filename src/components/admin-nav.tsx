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

export function AdminNav() {
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
                  "-mb-px inline-block border-b-2 px-3 py-2.5 text-sm font-medium whitespace-nowrap transition-colors",
                  active
                    ? "border-white text-white"
                    : "border-transparent text-white/70 hover:border-white/40 hover:text-white",
                )}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
