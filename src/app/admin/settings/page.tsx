import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { saveSettings } from "@/lib/admin-actions";
import { requireAdmin } from "@/lib/auth";
import { getAllSettings } from "@/lib/settings";
import { MAX_UPLOAD_BYTES, TIMEZONE } from "@/lib/config";

export const dynamic = "force-dynamic";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  await requireAdmin();
  const settings = await getAllSettings();

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>

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
