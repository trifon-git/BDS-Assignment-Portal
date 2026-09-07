import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { db } from "@/db";
import { admins } from "@/db/schema";
import {
  createAdmin,
  deleteAdmin,
  saveSettings,
  updateAdminEmail,
} from "@/lib/admin-actions";
import { requireAdmin } from "@/lib/auth";
import { formatDeadline } from "@/lib/format";
import { getAllSettings } from "@/lib/settings";
import { MAX_UPLOAD_BYTES, TIMEZONE } from "@/lib/config";
import { asc } from "drizzle-orm";

export const dynamic = "force-dynamic";

export const metadata = { title: "Settings" };

export default async function SettingsPage({
  searchParams,
}: PageProps<"/admin/settings">) {
  const admin = await requireAdmin();
  const settings = await getAllSettings();
  const allAdmins = await db
    .select()
    .from(admins)
    .orderBy(asc(admins.createdAt));
  const query = await searchParams;
  const emailChanged = query.emailChanged === "1";
  const emailError =
    typeof query.emailError === "string" ? query.emailError : null;
  const adminAdded = query.adminAdded === "1";
  const adminError =
    typeof query.adminError === "string" ? query.adminError : null;

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>

      <section className="mt-6 max-w-2xl space-y-3 rounded-lg border bg-card p-4">
        <h2 className="text-sm font-medium">Your account</h2>
        <p className="text-xs text-muted-foreground">
          The address you sign in with. There is no password reset flow, so if
          you change this, make sure you can still receive mail at the new
          address.
        </p>
        {emailChanged ? (
          <p className="rounded-md bg-status-delivered-bg px-3 py-2 text-sm text-status-delivered">
            Sign-in email updated. Use it next time you log in.
          </p>
        ) : null}
        {emailError ? (
          <p className="rounded-md bg-status-missing-bg px-3 py-2 text-sm text-status-missing">
            {emailError}
          </p>
        ) : null}
        <form action={updateAdminEmail} className="flex flex-wrap items-end gap-2">
          <div className="space-y-2">
            <Label htmlFor="admin-email">Sign-in email</Label>
            <Input
              id="admin-email"
              name="email"
              type="email"
              required
              defaultValue={admin.email}
              className="max-w-sm"
            />
          </div>
          <Button type="submit" variant="outline">
            Update email
          </Button>
        </form>
      </section>

      <section className="mt-6 max-w-2xl space-y-3 rounded-lg border bg-card p-4">
        <h2 className="text-sm font-medium">Admin accounts</h2>
        <p className="text-xs text-muted-foreground">
          Anyone added here can see every submission in the course. There is no
          invite email — set a password below and tell them what it is
          yourself.
        </p>
        {adminAdded ? (
          <p className="rounded-md bg-status-delivered-bg px-3 py-2 text-sm text-status-delivered">
            Admin account created.
          </p>
        ) : null}
        {adminError ? (
          <p className="rounded-md bg-status-missing-bg px-3 py-2 text-sm text-status-missing">
            {adminError}
          </p>
        ) : null}

        <ul className="divide-y rounded-md border text-sm">
          {allAdmins.map((a) => (
            <li
              key={a.id}
              className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
            >
              <span className="min-w-0">
                <span className="block font-medium">
                  {a.name}
                  {a.id === admin.id ? (
                    <span className="ml-1.5 text-xs text-muted-foreground">
                      (you)
                    </span>
                  ) : null}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {a.email} · since {formatDeadline(a.createdAt)}
                </span>
              </span>
              {a.id !== admin.id && allAdmins.length > 1 ? (
                <form action={deleteAdmin}>
                  <input type="hidden" name="id" value={a.id} />
                  <Button type="submit" variant="ghost" size="sm">
                    Remove
                  </Button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>

        <form action={createAdmin} className="grid gap-2 sm:grid-cols-3">
          <div className="space-y-1">
            <Label htmlFor="new-admin-name" className="text-xs">
              Name
            </Label>
            <Input id="new-admin-name" name="name" required />
          </div>
          <div className="space-y-1">
            <Label htmlFor="new-admin-email" className="text-xs">
              Email
            </Label>
            <Input id="new-admin-email" name="email" type="email" required />
          </div>
          <div className="space-y-1">
            <Label htmlFor="new-admin-password" className="text-xs">
              Password
            </Label>
            <Input
              id="new-admin-password"
              name="password"
              type="password"
              minLength={12}
              required
            />
          </div>
          <Button type="submit" variant="outline" className="sm:col-span-3">
            Add admin
          </Button>
        </form>
      </section>

      <form action={saveSettings} className="mt-6 max-w-2xl space-y-6">
        <div className="space-y-2">
          <Label htmlFor="semester_name">Semester name</Label>
          <Input
            id="semester_name"
            name="semester_name"
            defaultValue={settings.semester_name}
            maxLength={80}
          />
          <p className="text-xs text-muted-foreground">
            Shown under the logo on the student pages.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="support_email">Contact address for students</Label>
          <Input
            id="support_email"
            name="support_email"
            type="email"
            defaultValue={settings.support_email}
            maxLength={120}
            className="max-w-md"
          />
          <p className="text-xs text-muted-foreground">
            Shown on every student page, and it is the only recovery path there
            is — a student who loses their team link has no password to reset
            and nobody else to ask.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="video_hosts">Recognised video hosts</Label>
          <Textarea
            id="video_hosts"
            name="video_hosts"
            rows={3}
            defaultValue={settings.video_hosts}
            className="font-mono text-xs"
          />
          <p className="text-xs text-muted-foreground">
            Comma-separated domains. A link from anywhere else still goes
            through, but the student is warned to double-check it. Panopto is
            what the student form recommends by name.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="default_max_file_size_mb">
            Default max file size (MB)
          </Label>
          <Input
            id="default_max_file_size_mb"
            name="default_max_file_size_mb"
            type="number"
            min={1}
            max={2000}
            defaultValue={settings.default_max_file_size_mb}
            className="w-40"
          />
          <p className="text-xs text-muted-foreground">
            The starting value for a new assignment. Each assignment can set its
            own. The server refuses anything over{" "}
            {Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB regardless — raise
            <code className="mx-1 rounded bg-muted px-1">MAX_UPLOAD_MB</code>
            in the environment to change that ceiling.
          </p>
        </div>

        <Button type="submit" size="lg">
          Save settings
        </Button>
      </form>

      <section className="mt-12 max-w-2xl rounded-lg border bg-muted/40 p-4">
        <h2 className="text-sm font-medium">Fixed at deployment</h2>
        <dl className="mt-3 space-y-2 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Timezone</dt>
            <dd className="font-mono text-xs">{TIMEZONE}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Hard upload ceiling</dt>
            <dd className="font-mono text-xs">
              {Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB
            </dd>
          </div>
        </dl>
        <p className="mt-3 text-xs text-muted-foreground">
          These come from environment variables and need a restart to change.
          See DEPLOYMENT.md.
        </p>
      </section>
    </>
  );
}
