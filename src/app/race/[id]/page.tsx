import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { races } from "@/lib/db/schema";
import { requireLinkedUser } from "@/lib/race/session";
import { isParticipant } from "@/lib/race/machine";
import { buildRaceSnapshot } from "@/lib/race/snapshot";
import { Lobby } from "@/components/race/Lobby";

/**
 * Race room (issue #16 wiring for the standalone `Lobby`).
 *
 * This is intentionally minimal: it resolves the race server-side and drops
 * `Lobby` in for the pending/ready/countdown phases so create -> copy link ->
 * join -> "both land in the race room lobby" works end-to-end today. The full
 * race-room assembly (editor, problem pane, LiveKit) is issue #17's job and
 * can replace/extend this page without touching `Lobby` itself.
 */
export default async function RacePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const session = await requireLinkedUser();
  if (!session.ok) {
    redirect(session.error === "cf_not_linked" ? "/settings/cf" : "/sign-in");
  }

  const [race] = await db.select().from(races).where(eq(races.id, id)).limit(1);

  if (!race || !isParticipant(race, session.user.id)) {
    return (
      <main className="shell-narrow flex flex-1 flex-col py-16 md:py-24">
        <h1 className="font-heading text-2xl font-semibold tracking-tight md:text-3xl">
          Race not found
        </h1>
        <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground md:text-base">
          This race doesn&apos;t exist, or you aren&apos;t one of its players.
        </p>
      </main>
    );
  }

  const snapshot = await buildRaceSnapshot(race);

  return (
    <main className="shell-narrow flex flex-1 flex-col py-16 md:py-24">
      <p className="font-mono text-xs text-muted-foreground">
        <span className="text-primary">$</span> cd ~/cph2h/race/{id}
      </p>
      <div className="mt-8">
        <Lobby raceId={race.id} currentUserId={session.user.id} initialSnapshot={snapshot} />
      </div>
    </main>
  );
}
