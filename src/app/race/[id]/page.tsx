import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { races } from "@/lib/db/schema";
import { requireAdmin, requireLinkedUser } from "@/lib/race/session";
import { isParticipant } from "@/lib/race/machine";
import { buildRaceSnapshot } from "@/lib/race/snapshot";
import { RaceRoom } from "@/components/race/RaceRoom";
import { AdminRaceView } from "@/components/admin/AdminRaceView";

/**
 * Race room (issue #17 — full assembly; admin spectate added in #296).
 *
 * Server component: resolve the viewer, then branch:
 *   - a linked participant → the full {@link RaceRoom} (unchanged).
 *   - a non-participant admin → the read-only {@link AdminRaceView} spectator.
 *   - anyone else → the existing "Race not found" UI.
 *
 * The initial {@link buildRaceSnapshot} is the source of truth; it already gates
 * the problem before `startedAt`, so the admin spectator can never peek at an
 * in-flight countdown problem.
 */
export default async function RacePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const session = await requireLinkedUser();
  const linkedUser = session.ok ? session.user : null;

  let viewer = linkedUser;
  if (!viewer) {
    const admin = await requireAdmin();
    if (!admin.ok) {
      // `session` is necessarily the failed variant here (linkedUser is null).
      const failedError = session.ok ? null : session.error;
      redirect(failedError === "cf_not_linked" ? "/settings/cf" : "/sign-in");
    }
    viewer = admin.user;
  }

  const [race] = await db.select().from(races).where(eq(races.id, id)).limit(1);

  // A linked participant plays in the full room.
  if (race && linkedUser && isParticipant(race, linkedUser.id)) {
    const snapshot = await buildRaceSnapshot(race);
    return (
      <RaceRoom
        raceId={race.id}
        currentUserId={linkedUser.id}
        initialSnapshot={snapshot}
      />
    );
  }

  // A non-participant admin spectates read-only.
  if (race && viewer.isAdmin && !isParticipant(race, viewer.id)) {
    return (
      <AdminRaceView
        raceId={race.id}
        initialSnapshot={await buildRaceSnapshot(race)}
      />
    );
  }

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
