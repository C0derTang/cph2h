import { redirect } from "next/navigation";
import Link from "next/link";
import { db } from "@/lib/db";
import { users, races, eloHistory } from "@/lib/db/schema";
import { eq, or, and, desc } from "drizzle-orm";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ExternalLink, Link2, TrendingUp, TrendingDown } from "lucide-react";
import { formatOutcome, formatEloDelta } from "@/lib/format";
import { ensureUser } from "@/lib/user";
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

function EloSparkline({ history }: { history: { eloAfter: number }[] }) {
  if (history.length === 0) {
    return <div className="h-16 w-full flex items-center justify-center text-muted-foreground text-sm">No Elo data yet</div>;
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

  return (
    <svg viewBox="0 0 100 40" className="h-16 w-full">
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        className="text-primary"
        vectorEffect="non-scaling-stroke"
      />
      <circle cx={points.split(" ").pop()?.split(",")[0]} cy={points.split(" ").pop()?.split(",")[1]} r="1.5" className="text-primary fill-primary" />
    </svg>
  );
}

function ErrorDisplay() {
  return (
    <div className="shell py-12">
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
        <h1 className="font-heading text-2xl font-semibold">
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
    <Card className="mb-8 border-primary/40 bg-primary/5">
      <CardContent className="flex flex-col items-start gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-primary">
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
      </CardContent>
    </Card>
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
  recentRaces: Array<{
    id: string;
    p1Id: string;
    p2Id: string | null;
    outcome: RaceOutcome | null;
    eloDeltaP1: number | null;
    eloDeltaP2: number | null;
    finishedAt: Date | null;
    p1User?: { username: string };
    p2User?: { username: string } | null;
  }>;
  eloHistoryData: Array<{
    eloAfter: number;
  }>;
}) {
  const isProvisional = user.racesPlayed < 10;

  return (
    <div className="shell py-8">
      <h1 className="font-heading text-3xl font-semibold mb-8">Dashboard</h1>

      {!user.cfHandle && <LinkCfBanner />}

      {/* Profile Card */}
      <div className="grid gap-6 md:grid-cols-2 mb-8">
        <Card>
          <CardHeader>
            <CardTitle>Profile</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase">Username</p>
              <p className="font-semibold">{user.username}</p>
            </div>

            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase">Codeforces</p>
              {user.cfHandle ? (
                <div className="flex items-center gap-2">
                  <a
                    href={`https://codeforces.com/profile/${user.cfHandle}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-semibold text-primary hover:underline flex items-center gap-1"
                  >
                    {user.cfHandle}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                  {user.cfRating && (
                    <span className="text-xs text-muted-foreground">
                      {user.cfRating}
                    </span>
                  )}
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">Not linked</span>
                  <Button
                    size="sm"
                    variant="outline"
                    render={<Link href="/settings/cf" />}
                    nativeButton={false}
                    className="h-6 text-xs"
                  >
                    Link Account
                  </Button>
                </div>
              )}
            </div>

            <Separator />

            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase">
                  Current Elo
                </p>
                <p className="text-2xl font-bold">{user.elo}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase">
                  Races Played
                </p>
                <p className="text-2xl font-bold">{user.racesPlayed}</p>
              </div>
            </div>

            {isProvisional && (
              <Badge variant="secondary" className="w-full justify-center">
                Provisional ({user.racesPlayed}/10)
              </Badge>
            )}
          </CardContent>
        </Card>

        {/* Elo History Sparkline */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Elo History</CardTitle>
            <CardDescription>
              {eloHistoryData.length > 0
                ? `Last ${eloHistoryData.length} races`
                : "No races yet"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {eloHistoryData.length > 0 ? (
              <div className="space-y-2">
                <EloSparkline history={eloHistoryData} />
                <div className="text-xs text-muted-foreground">
                  {eloHistoryData[0].eloAfter} (current) →{" "}
                  {eloHistoryData[eloHistoryData.length - 1].eloAfter} (oldest)
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center h-24 text-muted-foreground text-sm">
                Complete your first race to see your Elo progression
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent Races */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent Races</CardTitle>
          <CardDescription>
            {recentRaces.length > 0
              ? `Last ${recentRaces.length} races`
              : "No completed races yet"}
          </CardDescription>
        </CardHeader>
        {recentRaces.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/50">
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                    Opponent
                  </th>
                  <th className="px-4 py-3 text-center font-medium text-muted-foreground">
                    Outcome
                  </th>
                  <th className="px-4 py-3 text-right font-medium text-muted-foreground">
                    Elo Delta
                  </th>
                  <th className="px-4 py-3 text-right font-medium text-muted-foreground">
                    Date
                  </th>
                </tr>
              </thead>
              <tbody>
                {recentRaces.map((race) => {
                  const isP1 = race.p1Id === user.id;
                  const opponent = isP1 ? race.p2User : race.p1User;
                  const eloDelta = isP1 ? race.eloDeltaP1 : race.eloDeltaP2;
                  const outcome = formatOutcome(race.outcome, isP1);
                  const isDelta = eloDelta && eloDelta > 0;

                  return (
                    <tr key={race.id} className="border-b border-border/30 hover:bg-muted/50 last:border-b-0">
                      <td className="px-4 py-3 font-medium">
                        {opponent?.username || "Unknown"}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <Badge
                          variant={
                            outcome === "Win"
                              ? "default"
                              : outcome === "Loss"
                                ? "destructive"
                                : "outline"
                          }
                        >
                          {outcome}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span
                          className={`flex items-center justify-end gap-1 ${
                            isDelta
                              ? "text-green-600 dark:text-green-400"
                              : "text-red-600 dark:text-red-400"
                          }`}
                        >
                          {isDelta ? (
                            <TrendingUp className="h-3 w-3" />
                          ) : (
                            <TrendingDown className="h-3 w-3" />
                          )}
                          {formatEloDelta(eloDelta)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right text-muted-foreground text-xs">
                        {race.finishedAt
                          ? new Date(race.finishedAt).toLocaleDateString()
                          : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <CardContent className="flex items-center justify-center py-8 text-muted-foreground">
            Complete your first race to see your history
          </CardContent>
        )}
      </Card>

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

  let recentRaces: Array<{
    id: string;
    p1Id: string;
    p2Id: string | null;
    outcome: RaceOutcome | null;
    eloDeltaP1: number | null;
    eloDeltaP2: number | null;
    finishedAt: Date | null;
    p1User?: { username: string };
    p2User?: { username: string } | null;
  }> = [];
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
