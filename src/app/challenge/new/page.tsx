import { UserPlus } from "lucide-react";
import { EmptyStatePage } from "@/components/empty-state";

export default function NewChallengePage() {
  return (
    <EmptyStatePage
      path="/challenge/new"
      icon={UserPlus}
      title="Challenge a friend"
      description="Generate a private race link and send it to a specific opponent."
      items={[
        "Shareable challenge link",
        "Pick a rating range for the problem",
        "Link expires if it goes unused",
      ]}
    />
  );
}
