import { Link2 } from "lucide-react";
import { ensureUser } from "@/lib/user";
import { HeroWord } from "@/components/hud/hero-word";
import { CfLinkForm } from "./cf-link-form";

export default async function CfSettingsPage() {
  // Provisions the `users` row on first authenticated access (issue #48) so
  // the linked-state read below works pre-link, not just after CF linking.
  const user = await ensureUser();

  const linkedHandle = user?.cfHandle ?? null;
  const linkedRating = user?.cfRating ?? null;
  const linkedAt = user?.cfLinkedAt ? user.cfLinkedAt.toISOString() : null;

  return (
    <main className="shell-narrow relative flex flex-1 flex-col py-16 md:py-24">
      {/* Decorative HUD layer — muted, static hero word (settings is quiet
          chrome, not a versus surface). Clipped against overflow. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
      >
        <div className="spotlight absolute inset-0" />
        <HeroWord
          word="link"
          tone="muted"
          glitch={false}
          className="absolute top-4 -left-1 opacity-30"
        />
      </div>

      <div className="flex items-start gap-5">
        <div className="flex size-14 shrink-0 items-center justify-center rounded-[var(--radius)] border border-border bg-muted/40 text-muted-foreground">
          <Link2 className="size-6" aria-hidden />
        </div>
        <div>
          <h1 className="font-display text-3xl tracking-tight uppercase md:text-4xl">
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
