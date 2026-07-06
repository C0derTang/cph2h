import { Link2 } from "lucide-react";
import { ensureUser } from "@/lib/user";
import { CfLinkForm } from "./cf-link-form";

export default async function CfSettingsPage() {
  // Provisions the `users` row on first authenticated access (issue #48) so
  // the linked-state read below works pre-link, not just after CF linking.
  const user = await ensureUser();

  const linkedHandle = user?.cfHandle ?? null;
  const linkedRating = user?.cfRating ?? null;
  const linkedAt = user?.cfLinkedAt ? user.cfLinkedAt.toISOString() : null;

  return (
    <main className="shell-narrow flex flex-1 flex-col py-16 md:py-24">
      <p className="font-mono text-xs text-muted-foreground">
        <span className="text-player-self">$</span> cd ~/cph2h/settings/cf
      </p>

      <div className="mt-6 flex items-start gap-4">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-[var(--radius)] border border-player-self/40 bg-player-self/10 text-player-self">
          <Link2 className="size-5" aria-hidden />
        </div>
        <div>
          <h1 className="font-display text-2xl tracking-tight uppercase md:text-3xl">
            Codeforces account
          </h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground md:text-base">
            Link your Codeforces handle so we can pull your race verdicts
            automatically. No password needed — you prove ownership with a
            one-time compile-error submission.
          </p>
        </div>
      </div>

      <div className="mt-10">
        <CfLinkForm
          linkedHandle={linkedHandle}
          linkedRating={linkedRating}
          linkedAt={linkedAt}
        />
      </div>
    </main>
  );
}
