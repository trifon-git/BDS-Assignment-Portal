import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, KeyRound, LifeBuoy, Users } from "lucide-react";

import { SiteShell } from "@/components/site-shell";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { getTeamByShortCode } from "@/lib/team-access";
import { normalizeShortCode } from "@/lib/ids";
import { getSetting } from "@/lib/settings";

/** Reads the database on every request; nothing here is cacheable. */
export const dynamic = "force-dynamic";

export default async function LandingPage({
  searchParams,
}: PageProps<"/">) {
  const params = await searchParams;
  const error = typeof params.error === "string" ? params.error : null;
  const semester = await getSetting("semester_name");
  const supportEmail = await getSetting("support_email");

  /**
   * Look the code up and send the student to their team page. The redirect
   * carries the long token, so the code they typed never has to be remembered
   * again — the URL in their address bar is now bookmarkable.
   */
  async function openTeam(formData: FormData) {
    "use server";

    const raw = String(formData.get("code") ?? "");
    if (!raw.trim()) redirect("/?error=empty");

    const team = await getTeamByShortCode(normalizeShortCode(raw));
    if (!team) redirect("/?error=notfound");

    redirect(`/t/${team.accessToken}`);
  }

  return (
    <SiteShell subtitle={semester}>
      <div className="mx-auto max-w-xl">
        <h1 className="text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
          Deliver your weekly assignment
        </h1>
        <p className="mt-3 text-muted-foreground">
          Enter your team code to open your group&rsquo;s delivery page. There
          is no account and no password. Each assignment has its own teams, so
          you get a new code every time you group up — bookmark the page you
          land on until that assignment is handed in.
        </p>

        <form action={openTeam} className="mt-8 space-y-3">
          <Label htmlFor="code" className="text-base">
            Team code
          </Label>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Input
              id="code"
              name="code"
              placeholder="BDS-7K2P"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              aria-describedby={error ? "code-error" : "code-hint"}
              aria-invalid={error ? true : undefined}
              className="h-12 font-mono text-lg tracking-wider uppercase sm:flex-1"
            />
            <Button type="submit" size="lg" className="h-12 sm:w-40">
              Open
              <ArrowRight className="size-4" aria-hidden="true" />
            </Button>
          </div>

          {error ? (
            <p
              id="code-error"
              role="alert"
              className="text-sm font-medium text-status-missing"
            >
              {error === "empty"
                ? "Type your team code first."
                : "No team has that code. Check it with a teammate, or create a team below."}
            </p>
          ) : (
            <p id="code-hint" className="text-sm text-muted-foreground">
              Your code looks like <span className="font-mono">BDS-7K2P</span>.
              Any member of the team can use it, and it opens the one assignment
              the team was formed for.
            </p>
          )}
        </form>

        {/* The code is the whole security model, so say so plainly and early
            rather than burying it in a footnote nobody reads. */}
        <section className="mt-10 rounded-lg border border-aau-200 bg-aau-50/60 p-5">
          <h2 className="flex items-center gap-2 font-medium">
            <KeyRound className="size-5 shrink-0 text-aau-600" aria-hidden="true" />
            Your code is your key — look after it
          </h2>
          <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
            <li className="flex gap-2">
              <span aria-hidden="true" className="text-aau-600">&bull;</span>
              <span>
                There is no username, no password and no way to reset one.{" "}
                <strong className="font-medium text-foreground">
                  The code is the only thing that gets you in.
                </strong>
              </span>
            </li>
            <li className="flex gap-2">
              <span aria-hidden="true" className="text-aau-600">&bull;</span>
              <span>
                Anyone holding it can deliver, and replace files, as your team.
                Keep it inside your group — don&rsquo;t post it in a public
                channel or a shared document.
              </span>
            </li>
            <li className="flex gap-2">
              <span aria-hidden="true" className="text-aau-600">&bull;</span>
              <span>
                Make sure it is <em>your</em> team&rsquo;s code, and the one for{" "}
                <em>this</em> assignment. Deliver with someone else&rsquo;s and
                the work is filed under their group, not yours.
              </span>
            </li>
            <li className="flex gap-2">
              <span aria-hidden="true" className="text-aau-600">&bull;</span>
              <span>
                Every member should keep the code — then one person losing it
                is not the whole group&rsquo;s problem.
              </span>
            </li>
          </ul>

          <p className="mt-4 flex items-start gap-2 border-t border-aau-200 pt-3 text-sm">
            <LifeBuoy
              className="mt-0.5 size-4 shrink-0 text-aau-600"
              aria-hidden="true"
            />
            <span className="text-muted-foreground">
              Lost the code, or it doesn&rsquo;t work? Email{" "}
              <a
                href={`mailto:${supportEmail}?subject=BDS%20assignment%20delivery%20-%20team%20code`}
                className="font-medium text-aau-700 underline underline-offset-2"
              >
                {supportEmail}
              </a>{" "}
              <strong className="font-medium text-foreground">
                before the deadline
              </strong>
              . A new code takes a minute to issue; a missed deadline does not
              undo itself.
            </span>
          </p>
        </section>

        <div className="mt-6 rounded-lg border bg-card p-5">
          <div className="flex items-start gap-3">
            <Users
              className="mt-0.5 size-5 shrink-0 text-aau-600"
              aria-hidden="true"
            />
            <div>
              <h2 className="font-medium">
                Need a team for an assignment?
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Pick the assignment, add your group members from the class list,
                and share the link with them. You can work with different people
                each week.
              </p>
              <Link
                href="/join"
                className={cn(
                  buttonVariants({ variant: "outline", size: "lg" }),
                  "mt-4",
                )}
              >
                Create a team
              </Link>
            </div>
          </div>
        </div>
      </div>
    </SiteShell>
  );
}
