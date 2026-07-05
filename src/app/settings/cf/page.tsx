import { Link2 } from "lucide-react";
import { EmptyStatePage } from "@/components/empty-state";

export default function CfSettingsPage() {
  return (
    <EmptyStatePage
      path="/settings/cf"
      icon={Link2}
      title="Codeforces account"
      description="Link your Codeforces handle so we can pull verdicts automatically during races."
      items={[
        "Handle verification flow",
        "Synced rating badge",
        "Unlink your handle anytime",
      ]}
    />
  );
}
