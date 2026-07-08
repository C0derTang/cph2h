import { redirect } from "next/navigation";
import Link from "next/link";
import { db } from "@/lib/db";
import { users, races, eloHistory } from "@/lib/db/schema";
import { eq, or, and, desc } from "drizzle-orm";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertTriangle,
  ExternalLink,
  Settings,
  Swords,
  Trophy,
  TrendingUp,
  TrendingDown,
} from "lucide-react";
import { formatOutcome, formatEloDelta } from "@/lib/format";
import { ensureUser } from "@/lib/user";
import { cn } from "@/lib/utils";
import { MenuRowLink } from "@/components/menu/menu-row";
import { ChallengeMenuRow } from "@/components/dashboard/challenge-menu-row";
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

/** Map a formatted race outcome to a shared Badge variant. Win/loss are judge
 * outcomes (verdict axis); a draw is a settled, neutral result — not
 * "pending" — so it gets the neutral outline treatment. */
function outcomeBadgeVariant(
  outcome: string
): "verdict-ok" | "verdict-fail" | "outline" {
  if (outcome === "Win") return "verdict-ok";
  if (outcome === "Loss") return "verdict-fail";
  return "outline";
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
        <h1 className="font-display text-2xl tracking-tight uppercase">
          Error loading the hub
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

/** The identity + stats plate that heads the side rail — the compact user chip
 *  the tetr.io menu wants top-right, carrying username, Elo, CF handle, record. */
function IdentityPlate({
  user,
  record,
  recentCount,
}: {
  user: {
    username: string;
    cfHandle: string | null;
    cfRating: number | null;
    elo: number;
    racesPlayed: number;
  };
  record: { wins: number; losses: number; draws: number };
  recentCount: number;
}) {
  const isProvisional = user.racesPlayed < 10;

  return (
    <div className="panel p-4">
      <p className="font-mono text-[10px] tracking-[0.18em] text-muted-foreground uppercase">
        Signed in
      </p>
      <p className="mt-1 truncate font-display text-2xl tracking-tight uppercase">
        {user.username}
      </p>
      {user.cfHandle ? (
        <a
          href={`https://codeforces.com/profile/${user.cfHandle}`}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1 inline-flex items-center gap-1 font-mono text-[11px] text-player-self hover:underline"
        >
          {user.cfHandle}
          <ExternalLink className="size-3" aria-hidden />
        </a>
      ) : (
        <p className="mt-1 font-mono text-[11px] text-verdict-fail">
          Codeforces not linked
        </p>
      )}

      <div className="mt-4 grid grid-cols-2 gap-2">
        <div className="stat-plate p-3">
          <p className="font-mono text-[10px] tracking-[0.18em] text-muted-foreground uppercase">
            Elo
          </p>
          <p className="mt-0.5 font-mono text-xl font-semibold tabular-nums">
            {user.elo}
          </p>
          <p className="font-mono text-[10px] text-muted-foreground">
            {isProvisional ? `Provisional ${user.racesPlayed}/10` : "Ranked"}
          </p>
        </div>
        <div className="stat-plate p-3">
          <p className="font-mono text-[10px] tracking-[0.18em] text-muted-foreground uppercase">
            Record
          </p>
          <p className="mt-0.5 font-display text-xl tracking-tight tabular-nums">
            {record.wins}&ndash;{record.losses}
          </p>
          <p className="font-mono text-[10px] text-muted-foreground">
            {record.draws > 0
              ? `last ${recentCount} · ${record.draws} draw${record.draws === 1 ? "" : "s"}`
              : `last ${recentCount}`}
          </p>
        </div>
        <div className="stat-plate p-3">
          <p className="font-mono text-[10px] tracking-[0.18em] text-muted-foreground uppercase">
            CF Rating
          </p>
          <p className="mt-0.5 font-mono text-xl font-semibold tabular-nums">
            {user.cfRating ?? "—"}
          </p>
        </div>
        <div className="stat-plate p-3">
          <p className="font-mono text-[10px] tracking-[0.18em] text-muted-foreground uppercase">
            Races
          </p>
          <p className="mt-0.5 font-mono text-xl font-semibold tabular-nums">
            {user.racesPlayed}
          </p>
        </div>
      </div>
    </div>
  );
}

function PlayHubContent({
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
  const record = computeRecord(recentRaces, user.id);
  const cfLinked = Boolean(user.cfHandle);

  return (
    <main className="relative flex-1">
      <div
        aria-hidden
        className="spotlight pointer-events-none absolute inset-0 -z-10"
      />
      <div className="shell grid gap-8 py-8 lg:grid-cols-[minmax(0,1fr)_20rem] lg:py-12">
        {/* The main menu: a stack of giant color-coded action slabs. */}
        <div>
          <p className="inline-flex items-center gap-2 font-mono text-[11px] font-semibold tracking-[0.18em] text-muted-foreground uppercase">
            <span className="size-2 rounded-full bg-player-self motion-safe:animate-pulse" />
            Main menu
          </p>

          <div className="mt-5 flex flex-col gap-3">
            <MenuRowLink
              href="/queue"
              accent="var(--player-self)"
              icon={Swords}
              label="Quick match"
              tagline="Matched by rating — usually in seconds"
            />
            <ChallengeMenuRow />
            <MenuRowLink
              href="/leaderboard"
              accent="var(--verdict-pending)"
              icon={Trophy}
              label="Leaderboard"
              tagline="Where you stand on the ranked ladder"
            />
            <MenuRowLink
              href="/settings/cf"
              accent={cfLinked ? "var(--muted-foreground)" : "var(--verdict-fail)"}
              icon={cfLinked ? Settings : AlertTriangle}
              label="Settings"
              tagline={
                cfLinked
                  ? "Codeforces link and race preferences"
                  : "Link Codeforces to start racing — required"
              }
            />
          </div>
        </div>

        {/* Side rail: identity chip, Elo trend, recent races — demoted. */}
        <aside className="flex flex-col gap-4">
          <IdentityPlate
            user={user}
            record={record}
            recentCount={recentRaces.length}
          />

          {/* Elo history */}
          <div className="panel p-4">
            <p className="font-mono text-[11px] tracking-[0.18em] text-muted-foreground uppercase">
              Elo history
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
              <div className="flex h-20 items-center justify-center text-center text-sm text-muted-foreground">
                Complete your first race to see your Elo progression
              </div>
            )}
          </div>

          {/* Recent races */}
          <div>
            <p className="mb-3 font-mono text-[11px] tracking-[0.18em] text-muted-foreground uppercase">
              Recent races
            </p>

            {recentRaces.length > 0 ? (
              <ul className="flex flex-col gap-2">
                {recentRaces.map((race) => {
                  const isP1 = race.p1Id === user.id;
                  const opponent = isP1 ? race.p2User : race.p1User;
                  const eloDelta = isP1 ? race.eloDeltaP1 : race.eloDeltaP2;
                  const outcome = formatOutcome(race.outcome, isP1);
                  const isGain = eloDelta != null && eloDelta > 0;
                  const deltaTone = isGain
                    ? "text-verdict-ok"
                    : "text-verdict-fail";

                  return (
                    <li
                      key={race.id}
                      className="panel flex items-center justify-between gap-3 px-3 py-2.5"
                    >
                      <div className="flex min-w-0 items-center gap-2.5">
                        <span className="flex size-8 shrink-0 items-center justify-center rounded-[var(--radius)] bg-player-opponent font-display text-xs font-bold text-player-opponent-foreground">
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

                      <div className="flex shrink-0 items-center gap-2">
                        <Badge variant={outcomeBadgeVariant(outcome)}>
                          {outcome}
                        </Badge>
                        <span
                          className={cn(
                            "flex items-center gap-1 font-display text-sm font-semibold tabular-nums",
                            deltaTone,
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
              <div className="panel flex items-center justify-center px-4 py-8 text-center text-sm text-muted-foreground">
                Complete your first race to see your history
              </div>
            )}
          </div>
        </aside>
      </div>
    </main>
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
    console.error("Error loading the play hub:", error);
    errorOccurred = true;
  }

  if (errorOccurred) {
    return <ErrorDisplay />;
  }

  return (
    <PlayHubContent
      user={user}
      recentRaces={recentRaces}
      eloHistoryData={eloHistoryData}
    />
  );
}
