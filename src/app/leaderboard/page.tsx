import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Swords, Trophy } from "lucide-react";
import { cn } from "@/lib/utils";
import { HeroWord } from "@/components/hud/hero-word";
import {
  getLeaderboardPage,
  parsePositiveInt,
  type LeaderboardPage,
} from "@/lib/leaderboard";

function EmptyLeaderboard() {
  return (
    <div className="shell relative py-12">
      <HeroWord
        word="ladder"
        className="pointer-events-none absolute -left-2 top-4 -z-10"
      />
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
        <Trophy className="h-12 w-12 text-player-self" />
        <h1 className="font-display text-2xl tracking-tight uppercase">
          Nobody&rsquo;s stepped up.
        </h1>
        <p className="text-muted-foreground">
          Complete a race to claim the top spot on the Ladder.
        </p>
        <Button render={<Link href="/queue" />} nativeButton={false}>
          <Swords aria-hidden />
          Find a race
        </Button>
      </div>
    </div>
  );
}

function ErrorLeaderboard() {
  return (
    <div className="shell py-12">
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
        <Trophy className="h-12 w-12 text-destructive" />
        <h1 className="font-display text-2xl tracking-tight uppercase">
          Error loading the Ladder
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

function LeaderboardTable({
  data,
  currentUserId,
}: {
  data: LeaderboardPage;
  currentUserId: string | null | undefined;
}) {
  const currentPage = data.page;
  const currentEntry = currentUserId
    ? data.entries.find((entry) => entry.user.id === currentUserId)
    : undefined;

  const heading = (
    <div>
      <h1 className="font-display text-4xl tracking-tight uppercase md:text-5xl">
        The Ladder
      </h1>
      <p className="text-muted-foreground">
        Ranked by Elo. Climb it or get climbed.
      </p>
    </div>
  );

  return (
    <div className="shell relative py-8">
      <HeroWord
        word="ladder"
        className="pointer-events-none absolute -left-2 -top-4 -z-10"
      />
      <span
        aria-hidden
        className="hud-meta pointer-events-none absolute bottom-2 right-8 hidden sm:block"
      >
        {"// elo.desc"}
      </span>
      <div
        className={cn(
          "mb-8 flex flex-wrap gap-4",
          currentEntry ? "items-end justify-between" : "items-start"
        )}
      >
        {heading}
        {currentEntry && (
          <div className="stat-plate flex items-center gap-3 px-4 py-2.5">
            <span className="eyebrow text-muted-foreground">Your rank</span>
            <span className="font-mono text-2xl font-semibold tabular-nums text-player-self">
              #{currentEntry.rank}
            </span>
          </div>
        )}
      </div>

      <div className="panel bracket-frame overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[32rem] text-sm">
            <thead>
              <tr className="border-b border-border eyebrow text-muted-foreground">
                <th className="px-4 py-2.5 text-left font-medium">Rank</th>
                <th className="px-4 py-2.5 text-left font-medium">Player</th>
                <th className="hidden px-4 py-2.5 text-left font-medium sm:table-cell">
                  Codeforces
                </th>
                <th className="px-4 py-2.5 text-right font-medium">Elo</th>
                <th className="px-4 py-2.5 text-right font-medium">Races</th>
              </tr>
            </thead>
            <tbody>
              {data.entries.map((entry) => {
                const isCurrentUser = entry.user.id === currentUserId;
                return (
                  <tr
                    key={entry.user.id}
                    className={cn(
                      "border-b border-border transition-colors last:border-b-0",
                      isCurrentUser
                        ? "border-l-2 border-l-player-self bg-player-self/10"
                        : "hover:bg-muted/50"
                    )}
                  >
                    <td className="px-4 py-3 font-mono text-sm font-semibold tabular-nums">
                      {entry.rank}
                      {entry.user.racesPlayed < 10 && (
                        <sup className="ml-0.5 font-mono text-[10px] font-normal text-muted-foreground">
                          P
                        </sup>
                      )}
                    </td>

                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">
                          {entry.user.username}
                        </span>
                        {isCurrentUser && (
                          <Badge variant="secondary" className="shrink-0">
                            You
                          </Badge>
                        )}
                      </div>
                    </td>

                    <td className="hidden px-4 py-3 font-mono text-xs tabular-nums text-muted-foreground sm:table-cell">
                      {entry.user.cfHandle ? (
                        <>
                          {entry.user.cfHandle}
                          {entry.user.cfRating && (
                            <span className="ml-1.5">
                              {entry.user.cfRating}
                            </span>
                          )}
                        </>
                      ) : (
                        <span>Not linked</span>
                      )}
                    </td>

                    <td className="px-4 py-3 text-right font-mono text-sm font-semibold tabular-nums">
                      {entry.user.elo}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs text-muted-foreground tabular-nums">
                      {entry.user.racesPlayed}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      {data.pages > 1 && (
        <div className="mt-6 flex items-center justify-between">
          <div className="text-sm text-muted-foreground">
            Page{" "}
            <span className="font-mono tabular-nums">{data.page}</span> of{" "}
            <span className="font-mono tabular-nums">{data.pages}</span> (
            <span className="font-mono tabular-nums">{data.total}</span>{" "}
            total)
          </div>
          <div className="flex gap-2">
            {currentPage > 1 && (
              <Button
                render={<Link href={`/leaderboard?page=${currentPage - 1}`} />}
                nativeButton={false}
                variant="outline"
                size="sm"
              >
                Previous
              </Button>
            )}
            {currentPage < data.pages && (
              <Button
                render={<Link href={`/leaderboard?page=${currentPage + 1}`} />}
                nativeButton={false}
                variant="outline"
                size="sm"
              >
                Next
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default async function LeaderboardPage(props: {
  searchParams: Promise<{ page?: string }>;
}) {
  let data: LeaderboardPage | null = null;
  let currentUserDbId: string | null = null;
  let errorOccurred = false;

  const searchParams = await props.searchParams;
  const currentPage = parsePositiveInt(searchParams.page, 1);

  try {
    data = await getLeaderboardPage(currentPage, 50);

    // Resolve the signed-in user's DB id (uuid) from their Clerk id so we
    // can highlight their row. auth().userId is the Clerk id, not the DB id.
    const { userId } = await auth();
    if (userId) {
      const rows = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.clerkId, userId))
        .limit(1);
      currentUserDbId = rows[0]?.id ?? null;
    }
  } catch (error) {
    console.error("Error loading leaderboard:", error);
    errorOccurred = true;
  }

  if (errorOccurred) {
    return <ErrorLeaderboard />;
  }

  if (!data || data.entries.length === 0) {
    return <EmptyLeaderboard />;
  }

  return <LeaderboardTable data={data} currentUserId={currentUserDbId} />;
}
