import Link from "next/link";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { Link2Off, Swords } from "lucide-react";
import { db } from "@/lib/db";
import { races, users } from "@/lib/db/schema";
import { requireLinkedUser } from "@/lib/race/session";
import { toPublicUser } from "@/lib/race/snapshot";
import { Button } from "@/components/ui/button";
import { JoinChallengeForm } from "./join-challenge-form";

/**
 * Resolve-and-join page for a challenge link (issue #16).
 *
 * This is the canonical join route: `POST /api/races` (issue #7) builds
 * `joinUrl` as `/challenge/{token}` (see `src/app/api/races/route.ts`), so
 * this path is what a shared link actually points at. Gated on a linked
 * Codeforces account like the race routes; the actual join call goes through
 * `POST /api/races/join` (issue #7) via `JoinChallengeForm` — this page only
 * resolves the token server-side to preview the challenger.
 */
export default async function JoinChallengePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const session = await requireLinkedUser();
  if (!session.ok) {
    redirect(session.error === "cf_not_linked" ? "/settings/cf" : "/sign-in");
  }

  const [race] = await db
    .select()
    .from(races)
    .where(eq(races.challengeToken, token))
    .limit(1);

  if (!race) {
    return (
      <ChallengeMessage
        title="Challenge not found"
        description="This link is invalid or has already been used."
      />
    );
  }

  // Already joined (e.g. revisiting the link) — go straight to the room.
  if (race.p2Id === session.user.id) {
    redirect(`/race/${race.id}`);
  }

  if (race.p1Id === session.user.id) {
    return (
      <ChallengeMessage
        title="This is your challenge"
        description="Share the link with an opponent, or head to the race room to wait for them."
        raceId={race.id}
      />
    );
  }

  if (race.status !== "pending" || race.p2Id !== null) {
    return (
      <ChallengeMessage
        title="Challenge unavailable"
        description={
          race.status === "aborted"
            ? "This challenge was cancelled."
            : "This challenge already has two players."
        }
      />
    );
  }

  const [challenger] = await db
    .select()
    .from(users)
    .where(eq(users.id, race.p1Id))
    .limit(1);

  if (!challenger) {
    return (
      <ChallengeMessage
        title="Challenge not found"
        description="This link is invalid or has already been used."
      />
    );
  }

  return (
    <main className="shell-narrow flex flex-1 flex-col py-16 md:py-24">
      <p className="font-mono text-xs text-muted-foreground">
        <span className="text-primary">$</span> cd ~/cph2h/challenge/{token}
      </p>

      <div className="mt-6 flex items-start gap-4">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/40 text-primary">
          <Swords className="size-5" aria-hidden />
        </div>
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight md:text-3xl">
            You&apos;ve been challenged
          </h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground md:text-base">
            Accept to join a private 1v1 race.
          </p>
        </div>
      </div>

      <div className="mt-10">
        <JoinChallengeForm
          token={token}
          challenger={toPublicUser(challenger)}
          timeLimitSec={race.timeLimitSec}
        />
      </div>
    </main>
  );
}

function ChallengeMessage({
  title,
  description,
  raceId,
}: {
  title: string;
  description: string;
  raceId?: string;
}) {
  return (
    <main className="shell-narrow flex flex-1 flex-col py-16 md:py-24">
      <div className="mt-6 flex items-start gap-4">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/40 text-destructive">
          <Link2Off className="size-5" aria-hidden />
        </div>
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight md:text-3xl">
            {title}
          </h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground md:text-base">
            {description}
          </p>
          {raceId && (
            <Button
              render={<Link href={`/race/${raceId}`} />}
              nativeButton={false}
              size="sm"
              className="mt-4"
            >
              Go to race room
            </Button>
          )}
        </div>
      </div>
    </main>
  );
}
