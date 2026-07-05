"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { Check, RotateCcw, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CppEditor, type CppEditorHandle } from "@/components/editor/CppEditor";
import { buildDraftKey, clearDraft } from "@/lib/editor/draft";
import { DEFAULT_CPP_TEMPLATE } from "@/lib/types";

interface TemplateEditorProps {
  initialTemplate: string;
  /** Scopes the local draft to this account so a shared browser can't leak
   *  one user's in-progress template into another's editor. */
  userId: string;
}

export function TemplateEditor({ initialTemplate, userId }: TemplateEditorProps) {
  const editorRef = useRef<CppEditorHandle>(null);
  const [value, setValue] = useState(initialTemplate);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const draftScope = `settings:template:${userId}`;

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const response = await fetch("/api/settings/template", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ template: value }),
      });
      const data = (await response.json()) as { template?: string; error?: string };
      if (!response.ok) {
        const message = data.error ?? "Could not save your template. Try again.";
        setError(message);
        toast.error(message);
        return;
      }
      setSaved(true);
      // The saved value is now the source of truth — drop the local draft so
      // a later visit doesn't restore stale in-progress edits over it.
      clearDraft(buildDraftKey(draftScope));
      toast.success("Template saved.");
      setTimeout(() => setSaved(false), 2000);
    } catch {
      setError("Network error — please try again.");
      toast.error("Network error — please try again.");
    } finally {
      setSaving(false);
    }
  }

  function handleReset() {
    editorRef.current?.reset(DEFAULT_CPP_TEMPLATE);
    setValue(DEFAULT_CPP_TEMPLATE);
    setSaved(false);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-hidden rounded-xl border border-border">
        <CppEditor
          ref={editorRef}
          value={value}
          onChange={setValue}
          height={420}
          draftKey={draftScope}
        />
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="flex items-center gap-2">
        <Button type="button" size="sm" onClick={handleSave} disabled={saving}>
          {saved ? <Check aria-hidden /> : <Save aria-hidden />}
          {saving ? "Saving…" : saved ? "Saved" : "Save"}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleReset}
          disabled={saving}
        >
          <RotateCcw aria-hidden />
          Reset to default
        </Button>
      </div>
    </div>
  );
}
