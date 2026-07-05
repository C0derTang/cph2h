import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { desc, gte, sql } from "drizzle-orm";
import { type LeaderboardEntry } from "@/lib/types";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get("page") || "1"));
    const limit = Math.max(1, Math.min(100, parseInt(searchParams.get("limit") || "50")));

    const offset = (page - 1) * limit;

    // Fetch total count of eligible users (racesPlayed >= 1)
    const countResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(users)
      .where(gte(users.racesPlayed, 1));

    const total = countResult[0]?.count || 0;

    // Fetch paginated users ordered by elo (descending)
    const rows = await db
      .select()
      .from(users)
      .where(gte(users.racesPlayed, 1))
      .orderBy(desc(users.elo))
      .limit(limit)
      .offset(offset);

    // Map to LeaderboardEntry with rank
    const entries: LeaderboardEntry[] = rows.map((user, index) => ({
      rank: offset + index + 1,
      user: {
        id: user.id,
        username: user.username,
        cfHandle: user.cfHandle,
        cfRating: user.cfRating,
        elo: user.elo,
        racesPlayed: user.racesPlayed,
      },
    }));

    return Response.json({
      entries,
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    });
  } catch (error) {
    console.error("Error fetching leaderboard:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
