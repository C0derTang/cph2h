import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Trophy } from "lucide-react";

interface LeaderboardEntry {
  rank: number;
  user: {
    id: string;
    username: string;
    cfHandle: string | null;
    cfRating: number | null;
    elo: number;
    racesPlayed: number;
  };
}

interface LeaderboardResponse {
  entries: LeaderboardEntry[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

function EmptyLeaderboard() {
  return (
    <div className="shell py-12">
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
        <Trophy className="h-12 w-12 text-muted-foreground" />
        <h1 className="font-heading text-2xl font-semibold">No racers yet</h1>
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
        <h1 className="font-heading text-2xl font-semibold">
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
  data: LeaderboardResponse;
  currentUserId: string | null | undefined;
}) {
  const currentPage = data.page;

  return (
    <div className="shell py-8">
      <div className="mb-8 flex items-center justify-between gap-4">
        <div>
          <h1 className="font-heading text-3xl font-semibold">Leaderboard</h1>
          <p className="text-muted-foreground">
            Top racers ranked by Elo rating
          </p>
        </div>
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/50">
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                  Rank
                </th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                  Player
                </th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                  Codeforces
                </th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">
                  Elo
                </th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">
                  Races
                </th>
              </tr>
            </thead>
            <tbody>
              {data.entries.map((entry) => {
                const isCurrentUser = entry.user.id === currentUserId;
                return (
                  <tr
                    key={entry.user.id}
                    className={`border-b border-border/30 transition-colors last:border-b-0 ${
                      isCurrentUser ? "bg-primary/5" : "hover:bg-muted/50"
                    }`}
                  >
                    <td className="px-4 py-3 font-medium">
                      {entry.user.racesPlayed < 10 && (
                        <span className="text-xs text-muted-foreground">
                          P
                        </span>
                      )}
                      {entry.rank}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{entry.user.username}</span>
                        {isCurrentUser && (
                          <Badge variant="secondary" className="ml-2">
                            You
                          </Badge>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {entry.user.cfHandle ? (
                        <div>
                          <div>{entry.user.cfHandle}</div>
                          {entry.user.cfRating && (
                            <div className="text-xs text-muted-foreground">
                              {entry.user.cfRating}
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          Not linked
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold">
                      {entry.user.elo}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {entry.user.racesPlayed}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

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
  let data: LeaderboardResponse | null = null;
  let errorOccurred = false;

  const searchParams = await props.searchParams;
  const currentPage = Math.max(1, parseInt(searchParams.page || "1"));

  try {
    // Fetch leaderboard data
    const baseUrl =
      process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    const response = await fetch(
      `${baseUrl}/api/leaderboard?page=${currentPage}&limit=50`,
      { cache: "no-store" }
    );

    if (!response.ok) {
      throw new Error("Failed to fetch leaderboard");
    }

    data = await response.json();
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

  const { userId } = await auth();

  return <LeaderboardTable data={data} currentUserId={userId} />;
}
