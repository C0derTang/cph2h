import { redirect } from "next/navigation";
import Link from "next/link";
import { db } from "@/lib/db";
import { users, races, eloHistory } from "@/lib/db/schema";
import { eq, or, and, desc } from "drizzle-orm";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Stat } from "@/components/ui/stat";
import { ExternalLink, Link2, TrendingUp, TrendingDown } from "lucide-react";
import { formatOutcome, formatEloDelta } from "@/lib/format";
import { ensureUser } from "@/lib/user";
import { cn } from "@/lib/utils";
import type { RaceOutcome } from "@/lib/types";

async function getRecentRaces(userId: string) {
  const recentRaces = await db
    .select()
    .from(races)
    .where(
      and(
        or(eq(races.p1Id, userId), eq(races.p2Id, userId)),
        or(
          eq(races.outcome, "p1_win"),
          eq(races.outcome, "p2_win"),
          eq(races.outcome, "draw")
        )
      )
    )
    .orderBy(desc(races.finishedAt))
    .limit(10);

  // Fetch user details for participants
  const enrichedRaces = await Promise.all(
    recentRaces.map(async (race) => {
      const p1User = await db.select().from(users).where(eq(users.id, race.p1Id)).limit(1);
      const p2User = race.p2Id ? await db.select().from(users).where(eq(users.id, race.p2Id)).limit(1) : null;

      return {
        ...race,
        p1User: p1User[0],
        p2User: p2User?.[0] || null,
      };
    })
  );

  return enrichedRaces;
}

async function getEloHistory(userId: string) {
  const history = await db
    .select()
    .from(eloHistory)
    .where(eq(eloHistory.userId, userId))
    .orderBy(desc(eloHistory.createdAt))
    .limit(20);

  return history;
}

type RecentRace = {
  id: string;
  p1Id: string;
  p2Id: string | null;
  outcome: RaceOutcome | null;
  eloDeltaP1: number | null;
  eloDeltaP2: number | null;
  finishedAt: Date | null;
  p1User?: { username: string };
  p2User?: { username: string } | null;
};

/** Wins/losses/draws over the fetched race-history window (visual convenience,
 * not a lifetime record — the schema has no running W/L counters). */
function computeRecord(recentRaces: RecentRace[], userId: string) {
  let wins = 0;
  let losses = 0;
  let draws = 0;
  for (const race of recentRaces) {
    const outcome = formatOutcome(race.outcome, race.p1Id === userId);
    if (outcome === "Win") wins += 1;
    else if (outcome === "Loss") losses += 1;
    else if (outcome === "Draw") draws += 1;
  }
  return { wins, losses, draws };
}

/** Verdict-token classes for a race outcome badge — win/loss/draw read as
 * outcomes, so they use the verdict axis, never the player identity axis. */
function outcomeBadgeClasses(outcome: string) {
  if (outcome === "Win") return "border-verdict-ok/40 bg-verdict-ok/10 text-verdict-ok";
  if (outcome === "Loss") return "border-verdict-fail/40 bg-verdict-fail/10 text-verdict-fail";
  return "border-verdict-pending/40 bg-verdict-pending/10 text-verdict-pending";
}

function EloSparkline({ history }: { history: { eloAfter: number }[] }) {
  if (history.length === 0) {
    return (
      <div className="flex h-16 w-full items-center justify-center text-sm text-muted-foreground">
        No Elo data yet
      </div>
    );
  }

  const values = history.map((h) => h.eloAfter).reverse();
  const minElo = Math.min(...values);
  const maxElo = Math.max(...values);
  const range = maxElo - minElo || 1;

  const points = values
    .map((elo, i) => {
      const x = (i / (values.length - 1)) * 100;
      const y = 100 - ((elo - minElo) / range) * 100;
      return `${x},${y}`;
    })
    .join(" ");
  const [lastX, lastY] = points.split(" ").pop()?.split(",") ?? ["0", "0"];

  return (
    <svg viewBox="0 0 100 40" className="h-16 w-full overflow-visible">
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        className="text-player-self"
        vectorEffect="non-scaling-stroke"
      />
      <circle cx={lastX} cy={lastY} r="1.75" className="fill-player-self" />
    </svg>
  );
}

function ErrorDisplay() {
  return (
    <div className="shell py-12">
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
        <h1 className="font-display text-2xl font-semibold">
          Error loading dashboard
        </h1>
        <p className="text-muted-foreground">Please try again later</p>
        <Button
          render={<Link href="/" />}
          nativeButton={false}
          variant="outline"
        >
          Go home
        </Button>
      </div>
    </div>
  );
}

function LinkCfBanner() {
  return (
    <div className="panel mb-8 flex flex-col items-start gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-md border border-player-self/40 bg-player-self/10 text-player-self">
          <Link2 className="size-4" aria-hidden />
        </div>
        <div>
          <p className="font-medium">Link your Codeforces account</p>
          <p className="text-sm text-muted-foreground">
            Connect Codeforces to start racing and track your rating.
          </p>
        </div>
      </div>
      <Button render={<Link href="/settings/cf" />} nativeButton={false}>
        Link Account
      </Button>
    </div>
  );
}

function DashboardContent({
  user,
  recentRaces,
  eloHistoryData,
}: {
  user: {
    id: string;
    username: string;
    cfHandle: string | null;
    cfRating: number | null;
    elo: number;
    racesPlayed: number;
  };
  recentRaces: RecentRace[];
  eloHistoryData: Array<{
    eloAfter: number;
  }>;
}) {
  const isProvisional = user.racesPlayed < 10;
  const record = computeRecord(recentRaces, user.id);

  return (
    <div className="shell py-8">
      <div className="mb-8">
        <h1 className="font-display text-3xl font-semibold tracking-tight">
          Dashboard
        </h1>
        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-xs text-muted-foreground">
          <span>{user.username}</span>
          {user.cfHandle ? (
            <>
              <span aria-hidden>&middot;</span>
              <a
                href={`https://codeforces.com/profile/${user.cfHandle}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-player-self hover:underline"
              >
                {user.cfHandle}
                <ExternalLink className="size-3" />
              </a>
            </>
          ) : (
            <>
              <span aria-hidden>&middot;</span>
              <span>Codeforces not linked</span>
            </>
          )}
        </p>
      </div>

      {!user.cfHandle && <LinkCfBanner />}

      {/* Scoreboard tiles */}
      <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat
          label="Elo"
          value={user.elo}
          hint={isProvisional ? `Provisional ${user.racesPlayed}/10` : "Ranked"}
        />
        <Stat
          label="CF Rating"
          value={user.cfRating ?? "—"}
          hint={user.cfHandle ?? "not linked"}
        />
        <Stat label="Races Played" value={user.racesPlayed} />
        <Stat
          label="Record"
          value={`${record.wins}-${record.losses}`}
          hint={
            record.draws > 0
              ? `${record.draws} draw${record.draws === 1 ? "" : "s"}`
              : `last ${recentRaces.length || 0}`
          }
        />
      </div>

      {/* Elo History */}
      <div className="panel mb-8 p-5">
        <p className="font-mono text-[11px] tracking-[0.18em] text-muted-foreground uppercase">
          Elo History
        </p>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {eloHistoryData.length > 0
            ? `Last ${eloHistoryData.length} races`
            : "No races yet"}
        </p>
        {eloHistoryData.length > 0 ? (
          <div className="mt-3 space-y-2">
            <EloSparkline history={eloHistoryData} />
            <div className="font-mono text-[11px] text-muted-foreground">
              <span className="font-semibold text-foreground tabular-nums">
                {eloHistoryData[0].eloAfter}
              </span>{" "}
              (current) &rarr;{" "}
              <span className="tabular-nums">
                {eloHistoryData[eloHistoryData.length - 1].eloAfter}
              </span>{" "}
              (oldest)
            </div>
          </div>
        ) : (
          <div className="flex h-24 items-center justify-center text-sm text-muted-foreground">
            Complete your first race to see your Elo progression
          </div>
        )}
      </div>

      {/* Recent Races */}
      <div>
        <p className="mb-3 font-mono text-[11px] tracking-[0.18em] text-muted-foreground uppercase">
          Race History
        </p>

        {recentRaces.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {recentRaces.map((race) => {
              const isP1 = race.p1Id === user.id;
              const opponent = isP1 ? race.p2User : race.p1User;
              const eloDelta = isP1 ? race.eloDeltaP1 : race.eloDeltaP2;
              const outcome = formatOutcome(race.outcome, isP1);
              const isGain = eloDelta != null && eloDelta > 0;
              const deltaTone = isGain ? "text-verdict-ok" : "text-verdict-fail";

              return (
                <li
                  key={race.id}
                  className="panel flex items-center justify-between gap-4 px-4 py-3"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-player-opponent font-display text-xs font-bold text-player-opponent-foreground">
                      {(opponent?.username ?? "?").charAt(0).toUpperCase()}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate font-medium">
                        {opponent?.username ?? "Unknown"}
                      </p>
                      <p className="font-mono text-[11px] text-muted-foreground">
                        {race.finishedAt
                          ? new Date(race.finishedAt).toLocaleDateString()
                          : "—"}
                      </p>
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-3">
                    <Badge
                      variant="outline"
                      className={outcomeBadgeClasses(outcome)}
                    >
                      {outcome}
                    </Badge>
                    <span
                      className={cn(
                        "flex items-center gap-1 font-display text-sm font-semibold tabular-nums",
                        deltaTone
                      )}
                    >
                      {isGain ? (
                        <TrendingUp className="size-3" />
                      ) : (
                        <TrendingDown className="size-3" />
                      )}
                      {formatEloDelta(eloDelta)}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="panel flex items-center justify-center py-8 text-muted-foreground">
            Complete your first race to see your history
          </div>
        )}
      </div>

      {recentRaces.length === 0 && (
        <div className="mt-6 text-center">
          <Button
            render={<Link href="/queue" />}
            nativeButton={false}
          >
            Start Your First Race
          </Button>
        </div>
      )}
    </div>
  );
}

export default async function DashboardPage() {
  // Provisions the `users` row on first authenticated access (issue #48);
  // only a genuinely-signed-out visitor gets sent to sign-in.
  const dbUser = await ensureUser();
  if (!dbUser) {
    redirect("/sign-in");
  }

  const user = {
    id: dbUser.id,
    username: dbUser.username,
    cfHandle: dbUser.cfHandle,
    cfRating: dbUser.cfRating,
    elo: dbUser.elo,
    racesPlayed: dbUser.racesPlayed,
  };

  let recentRaces: RecentRace[] = [];
  let eloHistoryData: Array<{ eloAfter: number }> = [];
  let errorOccurred = false;

  try {
    recentRaces = await getRecentRaces(user.id);
    const historyData = await getEloHistory(user.id);
    eloHistoryData = historyData.map((h) => ({ eloAfter: h.eloAfter }));
  } catch (error) {
    console.error("Error loading dashboard:", error);
    errorOccurred = true;
  }

  if (errorOccurred) {
    return <ErrorDisplay />;
  }

  return (
    <DashboardContent
      user={user}
      recentRaces={recentRaces}
      eloHistoryData={eloHistoryData}
    />
  );
}
