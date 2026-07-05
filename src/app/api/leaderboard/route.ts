import {
  getLeaderboardPage,
  parsePositiveInt,
  LEADERBOARD_DEFAULT_LIMIT,
} from "@/lib/leaderboard";

export async function GET(request: Request) {
  try {
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
