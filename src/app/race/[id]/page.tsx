import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { races } from "@/lib/db/schema";
import { requireLinkedUser } from "@/lib/race/session";
import { isParticipant } from "@/lib/race/machine";
import { buildRaceSnapshot } from "@/lib/race/snapshot";
import { RaceRoom } from "@/components/race/RaceRoom";

/**
 * Race room (issue #17 — full assembly).
 *
 * Server component: resolve + participant-guard the race, build the initial
 * {@link buildRaceSnapshot} (the source of truth), then hand off to the client
 * {@link RaceRoom} orchestrator which handles every status (lobby / active /
 * result), LiveKit video + data-channel hints, verdict polling, and submit.
 * The viewer's saved `cppTemplate` is passed through so it preloads into the
 * editor at race start.
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
    <RaceRoom
      raceId={race.id}
      currentUserId={session.user.id}
      initialSnapshot={snapshot}
      cppTemplate={session.user.cppTemplate}
    />
  );
}
