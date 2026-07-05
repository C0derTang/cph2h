import { Swords } from "lucide-react";
import { EmptyStatePage } from "@/components/empty-state";

export default function QueuePage() {
  return (
    <EmptyStatePage
      path="/queue"
      icon={Swords}
      title="Find a race"
      description="Queue up and we'll match you with an opponent near your rating for a live 1v1."
      items={[
        "Matchmaking by rating band",
        "Countdown once an opponent is found",
        "Auto-cancel if you leave the queue",
      ]}
    />
  );
}
