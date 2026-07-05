import { FileCode2 } from "lucide-react";
import { EmptyStatePage } from "@/components/empty-state";

export default function TemplateSettingsPage() {
  return (
    <EmptyStatePage
      path="/settings/template"
      icon={FileCode2}
      title="Code template"
      description="Set the boilerplate that's preloaded into the editor at the start of every race."
      items={[
        "Editable per-language templates",
        "Defaults to a standard C++ template",
        "Changes apply to your next race",
      ]}
    />
  );
}
