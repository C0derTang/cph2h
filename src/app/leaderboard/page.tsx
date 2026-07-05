import { Trophy } from "lucide-react";
import { EmptyStatePage } from "@/components/empty-state";

export default function LeaderboardPage() {
  return (
    <EmptyStatePage
      path="/leaderboard"
      icon={Trophy}
      title="Leaderboard"
      description="Every racer, ranked by Elo. See where you stand."
      items={[
        "Global Elo rankings",
        "Search by Codeforces handle",
        "Provisional vs. ranked badges",
      ]}
    />
  );
}
