import { redirect } from "next/navigation";
import { UserPlus } from "lucide-react";
import { requireLinkedUser } from "@/lib/race/session";
import { NewChallengeForm } from "@/components/challenge/new-challenge-form";

/**
 * Create-a-challenge page (issue #16). Gated on a linked Codeforces account —
 * `requireLinkedUser` (issue #7) is the same guard the race routes use, so an
 * unlinked visitor is bounced to /settings/cf before ever seeing the form.
 * Clerk's proxy (`src/proxy.ts`) already requires sign-in for this route, so
 * the `unauthorized` branch below is just a defensive fallback.
 *
 * Issue #89 makes the Play hub (`/dashboard`) the primary way to challenge a
 * friend — this route stays a slim standalone page rendering the same shared
 * form so existing links (including the rematch CTA on the result card) keep
 * working unchanged.
 */
export default async function NewChallengePage() {
  const session = await requireLinkedUser();
  if (!session.ok) {
    redirect(session.error === "cf_not_linked" ? "/settings/cf" : "/sign-in");
  }

  return (
    <main className="shell-narrow flex flex-1 flex-col py-16 md:py-24">
      <p className="eyebrow text-muted-foreground">New challenge</p>

      <div className="mt-6 flex items-start gap-4">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-[var(--radius)] border border-player-self/40 bg-player-self/10 text-player-self">
          <UserPlus className="size-5" aria-hidden />
        </div>
        <div>
          <h1 className="font-display text-2xl tracking-tight uppercase md:text-3xl">
            Challenge a friend
          </h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground md:text-base">
            Generate a private race link and send it to a specific opponent.
          </p>
        </div>
      </div>

      <div className="mt-10">
        <NewChallengeForm />
      </div>
    </main>
  );
}
