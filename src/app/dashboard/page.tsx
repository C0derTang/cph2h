import { Gauge } from "lucide-react";
import { EmptyStatePage } from "@/components/empty-state";

export default function DashboardPage() {
  return (
    <EmptyStatePage
      path="/dashboard"
      icon={Gauge}
      title="Dashboard"
      description="Your race history, Elo trend, and current rating will live here."
      items={[
        "Elo history over time",
        "Recent races with verdicts and time-to-solve",
        "Win/loss record against your rating band",
      ]}
    />
  );
}
