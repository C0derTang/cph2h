import {
  getLeaderboardPage,
  parsePositiveInt,
  LEADERBOARD_DEFAULT_LIMIT,
} from "@/lib/leaderboard";
import { enforcePolicy } from "@/lib/ratelimit/policies";

export async function GET(request: Request) {
  try {
    // Public route — no auth, so this is always per-IP.
    const limited = await enforcePolicy(request, "leaderboard", null);
    if (limited) return limited;

    const { searchParams } = new URL(request.url);
    const page = parsePositiveInt(searchParams.get("page"), 1);
    const limit = parsePositiveInt(
      searchParams.get("limit"),
      LEADERBOARD_DEFAULT_LIMIT,
    );

    const result = await getLeaderboardPage(page, limit);

    return Response.json(result);
  } catch (error) {
    console.error("Error fetching leaderboard:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
