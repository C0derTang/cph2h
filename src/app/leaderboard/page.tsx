import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Trophy } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  getLeaderboardPage,
  parsePositiveInt,
  type LeaderboardPage,
} from "@/lib/leaderboard";

const ROW_GRID =
  "grid grid-cols-[2.5rem_1fr_4.5rem_3.5rem] items-center gap-3 sm:grid-cols-[3rem_1fr_9rem_5rem_4rem] sm:gap-4";

function EmptyLeaderboard() {
  return (
    <div className="shell py-12">
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
        <Trophy className="h-12 w-12 text-muted-foreground" />
        <h1 className="font-display text-2xl font-semibold">No racers yet</h1>
        <p className="text-muted-foreground">
          Complete some races to appear on the leaderboard
        </p>
        <Button render={<Link href="/queue" />} nativeButton={false}>
          Start Racing
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
        <h1 className="font-display text-2xl font-semibold">
          Error loading leaderboard
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

  return (
    <div className="shell py-8">
      <div className="mb-8 flex items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">
            Leaderboard
          </h1>
          <p className="text-muted-foreground">
            Top racers ranked by Elo rating
          </p>
        </div>
      </div>

      <div className="panel overflow-hidden">
        <div className="overflow-x-auto">
          <div className="min-w-[32rem]">
            {/* Column header */}
            <div
              className={cn(
                ROW_GRID,
                "border-b border-border px-4 py-2.5 font-mono text-[11px] tracking-[0.18em] text-muted-foreground uppercase"
              )}
            >
              <span>Rank</span>
              <span>Player</span>
              <span className="hidden sm:inline">Codeforces</span>
              <span className="text-right">Elo</span>
              <span className="text-right">Races</span>
            </div>

            {/* Rows */}
            <div className="flex flex-col divide-y divide-border">
              {data.entries.map((entry) => {
                const isCurrentUser = entry.user.id === currentUserId;
                return (
                  <div
                    key={entry.user.id}
                    className={cn(
                      ROW_GRID,
                      "px-4 py-3 transition-colors",
                      isCurrentUser
                        ? "border-l-2 border-l-player-self bg-player-self/10"
                        : "hover:bg-muted/50"
                    )}
                  >
                    <span className="font-display text-lg font-semibold tabular-nums">
                      {entry.rank}
                      {entry.user.racesPlayed < 10 && (
                        <sup className="ml-0.5 font-mono text-[10px] font-normal text-muted-foreground">
                          P
                        </sup>
                      )}
                    </span>

                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate font-medium">
                        {entry.user.username}
                      </span>
                      {isCurrentUser && (
                        <Badge variant="secondary" className="shrink-0">
                          You
                        </Badge>
                      )}
                    </div>

                    <div className="hidden min-w-0 font-mono text-xs text-muted-foreground sm:block">
                      {entry.user.cfHandle ? (
                        <div className="truncate">
                          {entry.user.cfHandle}
                          {entry.user.cfRating && (
                            <span className="ml-1.5">
                              {entry.user.cfRating}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span>Not linked</span>
                      )}
                    </div>

                    <span className="text-right font-display font-semibold tabular-nums">
                      {entry.user.elo}
                    </span>
                    <span className="text-right font-mono text-xs text-muted-foreground tabular-nums">
                      {entry.user.racesPlayed}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Pagination */}
      {data.pages > 1 && (
        <div className="mt-6 flex items-center justify-between">
          <div className="text-sm text-muted-foreground">
            Page {data.page} of {data.pages} ({data.total} total)
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
