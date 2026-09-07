import { redirect } from "next/navigation";

import { AauLogo } from "@/components/brand/aau-logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  authenticate,
  createSession,
  getCurrentAdmin,
  pruneSessions,
  recordAudit,
} from "@/lib/auth";

export const dynamic = "force-dynamic";

export const metadata = { title: "Sign in" };

export default async function AdminLogin({
  searchParams,
}: PageProps<"/admin/login">) {
  if (await getCurrentAdmin()) redirect("/admin");

  const query = await searchParams;
  const failed = query.error === "1";

  async function signIn(formData: FormData) {
    "use server";

    const email = String(formData.get("email") ?? "");
    const password = String(formData.get("password") ?? "");

    const admin = await authenticate(email, password);
    if (!admin) {
      // One message for both a wrong password and an unknown address, so the
      // form can't be used to find out who has an account.
      await recordAudit({
        action: "admin.login_failed",
        detail: email.slice(0, 120),
      });
      redirect("/admin/login?error=1");
    }

    await pruneSessions();
    await createSession(admin.id);
    await recordAudit({
      action: "admin.login",
      actorName: `admin:${admin.email}`,
    });
    redirect("/admin");
  }

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="w-full max-w-sm">
        <div className="flex justify-center">
          <AauLogo height={34} priority />
        </div>

        <h1 className="mt-8 text-center text-xl font-semibold tracking-tight">
          Assignment delivery — admin
        </h1>
        <p className="mt-2 text-center text-sm text-muted-foreground">
          For the course responsible and teaching assistants.
        </p>

        <form action={signIn} className="mt-8 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              required
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </div>

          {failed ? (
            <p
              role="alert"
              className="rounded-md bg-status-missing-bg p-3 text-sm font-medium text-status-missing"
            >
              That email and password combination is not correct.
            </p>
          ) : null}

          <Button type="submit" size="lg" className="w-full">
            Sign in
          </Button>
        </form>

        <p className="mt-8 text-center text-xs text-muted-foreground">
          Students do not sign in — they use their team link.
        </p>
      </div>
    </main>
  );
}
