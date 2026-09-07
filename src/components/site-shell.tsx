import Link from "next/link";

import { AauLogo } from "@/components/brand/aau-logo";
import { getSetting } from "@/lib/settings";

/**
 * The frame every student-facing page sits in: AAU blue band with the white
 * lockup, a centred content column, and a quiet footer.
 *
 * Deliberately no navigation. A student arriving from a bookmarked team link
 * has exactly one place to be, and offering them links to pages they cannot
 * open would only raise questions.
 */
export async function SiteShell({
  children,
  subtitle,
  right,
}: {
  children: React.ReactNode;
  subtitle?: string;
  right?: React.ReactNode;
}) {
  const supportEmail = await getSetting("support_email");

  return (
    <>
      <header className="aau-band text-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-5 sm:px-6">
          <Link href="/" className="shrink-0" aria-label="Front page">
            <AauLogo variant="white" height={30} priority />
          </Link>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-white/95">
              Assignment delivery
            </p>
            {subtitle ? (
              <p className="truncate text-xs text-white/70">{subtitle}</p>
            ) : null}
          </div>
          {right}
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
        {children}
      </main>

      <footer className="border-t bg-card">
        <div className="mx-auto flex max-w-5xl flex-col gap-1 px-4 py-6 text-xs text-muted-foreground sm:px-6">
          <p>Aalborg University — Business Data Science</p>
          <p>
            Lost your link, or something not working?{" "}
            <a
              href={`mailto:${supportEmail}`}
              className="font-medium text-aau-700 underline underline-offset-2"
            >
              {supportEmail}
            </a>{" "}
            — write before the deadline rather than after it.
          </p>
        </div>
      </footer>
    </>
  );
}
