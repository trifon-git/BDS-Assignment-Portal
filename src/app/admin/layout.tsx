import Link from "next/link";

import { AdminNav } from "@/components/admin-nav";
import { AauLogo } from "@/components/brand/aau-logo";
import { Button } from "@/components/ui/button";
import { destroySession, getCurrentAdmin } from "@/lib/auth";
import { getNotificationCount } from "@/lib/admin-data";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * Admin chrome. The login page renders its own standalone layout, so this
 * intentionally does not guard — a redirect here would trap the sign-in page in
 * a loop. Every admin page and action calls `requireAdmin()` for itself, which
 * is also what protects them from direct POSTs.
 */
export default async function AdminLayout({
  children,
}: LayoutProps<"/admin">) {
  const admin = await getCurrentAdmin();

  async function signOut() {
    "use server";
    await destroySession();
    redirect("/admin/login");
  }

  if (!admin) return <>{children}</>;

  const notificationCount = await getNotificationCount(admin.notificationsSeenAt);

  return (
    <div className="flex min-h-full flex-col">
      <header className="aau-band text-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-4 sm:px-6">
          <Link href="/admin" className="shrink-0" aria-label="Admin home">
            <AauLogo variant="white" height={26} priority />
          </Link>
          <p className="flex-1 text-sm font-medium">Assignment delivery</p>
          <div className="flex items-center gap-3 text-sm">
            <span className="hidden text-white/70 sm:inline">{admin.name}</span>
            <form action={signOut}>
              <Button
                type="submit"
                variant="ghost"
                size="sm"
                className="text-white hover:bg-white/15 hover:text-white"
              >
                Sign out
              </Button>
            </form>
          </div>
        </div>
        <AdminNav notificationCount={notificationCount} />
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6">
        {children}
      </main>
    </div>
  );
}
